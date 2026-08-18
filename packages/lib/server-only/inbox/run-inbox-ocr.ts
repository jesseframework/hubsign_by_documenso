/**
 * Runs a signature-inbox item's PDF through the BMS ML OCR engine, stores the
 * extracted data on the item, and fires the INBOX_OCR_COMPLETED workflow event.
 *
 * Always advances the item out of OCR_PROCESSING (to READY / OCR_FAILED) and
 * always fires the workflow event (success, failure, or "not configured") so
 * downstream automations can react — the payload carries `ocrProcessed`/`status`.
 */

import { Prisma } from '@prisma/client';

import { assertOcrQuotaOrQueue, recordOcrPagesProcessed } from '@documenso/ee/server-only/limits/ocr-quota';
import { getPdfPageCount } from '@documenso/lib/server-only/pdf/get-pdf-page-count';
import { prisma } from '@documenso/prisma';

import { buildOcrCanonicalFields } from '../../universal/ocr-fields';
import { getFileServerSide } from '../../universal/upload/get-file.server';
import { bmsMlUploadDocument, isBmsMlConfigured } from '../bms-ml/client';
import { triggerWorkflows } from '../workflow/trigger-workflows';
import { flagDuplicateInboxItem } from './flag-duplicate';
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
        },
      },
    },
  });
  if (!item) return;

  // Push the finished OCR result to any open inbox views in realtime.
  publishInboxEvent(item.organizationId, { type: 'ocr', inboxItemId: item.id, status: item.status });

  // Duplicate check runs here because this is the first moment the vendor and
  // invoice number are known. It stores its verdict on the item (so the queue can
  // show it) and fires its own event, so a workflow can notify the vendor and the
  // AP team without every OCR completion having to branch.
  await flagDuplicateInboxItem(item.id);

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
  existingUsageId,
}: {
  inboxItemId: string;
  /** Explicit template chosen by a user re-running OCR; beats vendor routing. */
  templateId?: number;
  /**
   * Set by the drain-queue job when re-attempting a previously QUEUED item —
   * skips the quota check (the drain job already confirmed room) and
   * updates that row in place instead of creating a new one.
   */
  existingUsageId?: string;
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

    // Compute page count and check quota BEFORE calling BMS ML — cheap,
    // local work first, the expensive network call only if there's room.
    // Skipped when the drain job already confirmed room for this exact item.
    const pageCount = await getPdfPageCount(buffer, fileName);
    const decision = existingUsageId
      ? ({ allowed: true } as const)
      : await assertOcrQuotaOrQueue({
          organizationId: item.organizationId,
          pageCount,
          source: 'INBOX',
          sourceId: item.id,
        });

    if (!decision.allowed) {
      // Soft-stop: over quota, not an error. The item stays usable — it
      // just hasn't been enriched yet, and will drain automatically once
      // the org's Smart OCR quota has room again.
      await prisma.signatureInboxItem.update({
        where: { id: item.id },
        data: { status: 'OCR_QUEUED' },
      });
      // Push the state to any open inbox view so the spinner stops — but
      // deliberately skip fireOcrCompleted: it drives duplicate-detection
      // and INBOX_OCR_COMPLETED workflow dispatch, both keyed on finished
      // extractedData, which doesn't exist yet for a queued item.
      publishInboxEvent(item.organizationId, { type: 'ocr', inboxItemId: item.id, status: 'OCR_QUEUED' });
      return;
    }

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

    await recordOcrPagesProcessed({
      organizationId: item.organizationId,
      pageCount,
      source: 'INBOX',
      sourceId: item.id,
      existingUsageId,
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
