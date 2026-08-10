/**
 * Runs a signature-inbox item's PDF through the BMS ML OCR engine, stores the
 * extracted data on the item, and fires the INBOX_OCR_COMPLETED workflow event.
 *
 * Always advances the item out of OCR_PROCESSING (to READY / OCR_FAILED) and
 * always fires the workflow event (success, failure, or "not configured") so
 * downstream automations can react — the payload carries `ocrProcessed`/`status`.
 */

import { Prisma } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { buildOcrCanonicalFields } from '../../universal/ocr-fields';
import { getFileServerSide } from '../../universal/upload/get-file.server';
import { bmsMlUploadDocument, isBmsMlConfigured } from '../bms-ml/client';
import { triggerWorkflows } from '../workflow/trigger-workflows';
import { publishInboxEvent } from './inbox-events';
import { resolveOcrTemplate } from './resolve-ocr-template';

const fireOcrCompleted = async (inboxItemId: string): Promise<void> => {
  const item = await prisma.signatureInboxItem.findUnique({
    where: { id: inboxItemId },
    include: {
      document: {
        select: {
          id: true,
          title: true,
          status: true,
          userId: true,
          // Who is actually operating this queue. An internal alert needs a
          // person's address: sending it to the organization's inbound mailbox
          // would deliver the warning into the very inbox being warned about.
          user: { select: { id: true, email: true, name: true } },
        },
      },
    },
  });
  if (!item) return;

  // Push the finished OCR result to any open inbox views in realtime.
  publishInboxEvent(item.organizationId, { type: 'ocr', inboxItemId: item.id, status: item.status });

  // Duplicate check runs here because this is the first moment the vendor and
  // invoice number are known. Fired as its own event so a workflow can notify
  // the vendor and the AP team without every OCR completion having to branch.
  try {
    const { findDuplicateInboxItems } = await import('../rules/providers/duplicate');

    const duplicate = await findDuplicateInboxItems({
      organizationId: item.organizationId,
      inboxItemId: item.id,
      extractedData: item.extractedData,
    });

    if (duplicate.isDuplicate) {
      console.warn(
        `[inbox] duplicate invoice: item ${item.id} matches ${duplicate.originalInboxItemId} ` +
          `on ${duplicate.matchedOn}${duplicate.originalAlreadySent ? ' (original ALREADY SENT)' : ''}`,
      );

      await triggerWorkflows({
        event: 'INBOX_DUPLICATE_DETECTED',
        organizationId: item.organizationId,
        data: {
          inboxItemId: item.id,
          duplicate,
          sender: item.senderEmail,
          extractedData: item.extractedData,
          ...buildOcrCanonicalFields(item.extractedData),
          owner: item.document.user
            ? {
                id: item.document.user.id,
                email: item.document.user.email,
                name: item.document.user.name,
              }
            : null,
          document: {
            id: item.document.id,
            title: item.document.title,
            status: item.document.status,
            userId: item.document.userId,
          },
        },
      });
    }
  } catch (err) {
    // Detection is advisory; it must never stop OCR completing.
    console.error('[inbox] duplicate detection failed:', err);
  }

  await triggerWorkflows({
    event: 'INBOX_OCR_COMPLETED',
    organizationId: item.organizationId,
    data: {
      inboxItemId: item.id,
      status: item.status,
      ocrProcessed: item.ocrProcessed,
      documentType: item.documentType,
      ocrConfidence: item.ocrConfidence,
      needsReview: item.needsReview,
      extractedData: item.extractedData,
      // Template-independent aliases ({{payload.vendorName}}, …). Workflows key
      // off these so a document routed to a different OCR template — which
      // names its fields differently — doesn't silently stop matching.
      ...buildOcrCanonicalFields(item.extractedData),
      sender: item.senderEmail,
      document: {
        id: item.document.id,
        title: item.document.title,
        status: item.document.status,
        userId: item.document.userId,
      },
    },
  }).catch((err) => console.error('[inbox-ocr] workflow dispatch failed:', err));
};

export const runInboxOcr = async ({
  inboxItemId,
  templateId: overrideTemplateId,
}: {
  inboxItemId: string;
  /** Explicit template chosen by a user re-running OCR; beats vendor routing. */
  templateId?: number;
}): Promise<void> => {
  const item = await prisma.signatureInboxItem.findUnique({
    where: { id: inboxItemId },
    include: { document: { include: { documentData: true } } },
  });
  if (!item) return;

  const org = await prisma.organization.findUnique({ where: { id: item.organizationId } });
  const orgConfig = org
    ? {
        apiUrl: org.ocrApiUrl,
        apiKey: org.ocrApiKey,
        apiUsername: org.ocrApiUsername,
        apiPassword: org.ocrApiPassword,
        defaultTemplateId: org.ocrDefaultTemplateId,
        defaultEngine: org.ocrDefaultEngine,
      }
    : null;

  // OCR not configured for the org — the item is still usable, just unenriched.
  if (!isBmsMlConfigured(orgConfig)) {
    await prisma.signatureInboxItem.update({
      where: { id: item.id },
      data: { status: 'READY' },
    });
    await fireOcrCompleted(item.id);
    return;
  }

  await prisma.signatureInboxItem.update({
    where: { id: item.id },
    data: { status: 'OCR_PROCESSING' },
  });

  try {
    const data = item.document.documentData;
    const bytes = await getFileServerSide({ type: data.type, data: data.data });
    const buffer = Buffer.from(bytes);

    // ML keys off the filename extension; the document title may have none
    // (it's the email subject), so guarantee a .pdf name.
    const baseName = item.document.title?.trim() || 'document';
    const fileName = /\.pdf$/i.test(baseName) ? baseName : `${baseName}.pdf`;

    // Route to a vendor's extraction template via the sender address. Without
    // one the service extracts generically and confidence sits far lower.
    const template = await resolveOcrTemplate({
      organizationId: item.organizationId,
      senderEmail: item.senderEmail,
      overrideTemplateId,
      orgDefaultTemplateId: org?.ocrDefaultTemplateId,
    });

    const result = await bmsMlUploadDocument(buffer, fileName, {
      orgConfig,
      templateId: template.templateId ?? undefined,
    });

    const extracted: Record<string, unknown> = {};
    for (const field of result.invoice.field_extractions ?? []) {
      extracted[field.field_name] = field.extracted_value;
    }

    await prisma.signatureInboxItem.update({
      where: { id: item.id },
      data: {
        status: 'READY',
        ocrProcessed: true,
        ocrText: result.invoice.raw_ocr_text ?? null,
        ocrConfidence: result.invoice.ocr_confidence ?? null,
        mlConfidence: result.invoice.ml_confidence ?? null,
        documentType: result.invoice.document_type ?? null,
        ocrEngine: result.invoice.ocr_engine ?? null,
        needsReview: result.invoice.needs_human_review ?? false,
        extractedData: extracted as Prisma.InputJsonValue,
        ocrMeta: {
          completeness: result.processing_details?.completeness ?? null,
          fieldExtractions: result.invoice.field_extractions ?? [],
          bmsMlInvoiceId: result.invoice.id,
          // Which template was applied and why — drives the "Extracted using…"
          // line on the item and makes a bad routing decision diagnosable.
          template: {
            id: template.templateId,
            // Prefer the name the service echoes back; it confirms the
            // template actually matched rather than just being requested.
            name:
              (result.invoice as { template_name?: unknown }).template_name ??
              template.templateName ??
              null,
            source: template.source,
            vendor: template.vendorLabel ?? null,
            matched: (result.invoice as { template_matched?: unknown }).template_matched ?? null,
          },
        } as Prisma.InputJsonValue,
        error: null,
      },
    });
  } catch (err) {
    await prisma.signatureInboxItem.update({
      where: { id: item.id },
      data: {
        status: 'OCR_FAILED',
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }

  await fireOcrCompleted(item.id);
};
