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

import { getFileServerSide } from '../../universal/upload/get-file.server';
import { bmsMlUploadDocument, isBmsMlConfigured } from '../bms-ml/client';
import { triggerWorkflows } from '../workflow/trigger-workflows';
import { publishInboxEvent } from './inbox-events';

const fireOcrCompleted = async (inboxItemId: string): Promise<void> => {
  const item = await prisma.signatureInboxItem.findUnique({
    where: { id: inboxItemId },
    include: { document: { select: { id: true, title: true, status: true, userId: true } } },
  });
  if (!item) return;

  // Push the finished OCR result to any open inbox views in realtime.
  publishInboxEvent(item.organizationId, { type: 'ocr', inboxItemId: item.id, status: item.status });

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

export const runInboxOcr = async ({ inboxItemId }: { inboxItemId: string }): Promise<void> => {
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

    const result = await bmsMlUploadDocument(buffer, fileName, {
      orgConfig,
      templateId: org?.ocrDefaultTemplateId ?? undefined,
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
