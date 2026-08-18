import { Prisma } from '@prisma/client';

import { assertOcrQuotaOrQueue, recordOcrPagesProcessed } from '@documenso/ee/server-only/limits/ocr-quota';
import { getPdfPageCount } from '@documenso/lib/server-only/pdf/get-pdf-page-count';
import { prisma } from '@documenso/prisma';

import { readOcrField } from '../../universal/ocr-fields';
import { stripFieldLabel } from '../../universal/reference-number';
import { looksLikePoNumber } from '../rules/providers/ocr';
import { getFileServerSide } from '../../universal/upload/get-file.server';
import { bmsMlUploadDocument, isBmsMlConfigured } from '../bms-ml/client';

/**
 * Read a supporting attachment with OCR — typically the purchase order a signer
 * attached alongside the invoice.
 *
 * Deliberately NOT `runInboxOcr`. That runner is welded to the inbox item: it
 * loads bytes from the parent document, writes the result over the item's own
 * `extractedData`, drives `InboxItemStatus`, and fires INBOX_OCR_COMPLETED plus
 * duplicate detection. Pointing it at an attachment would destroy the invoice
 * extraction you need the PO in order to compare against.
 *
 * Called from two places. The signer's own upload runs it inline, because the
 * point of attaching the PO is to clear a rule that is blocking them and asking
 * an external counterparty to wait for someone in the office to press a button
 * would defeat that. A member of the organization can also run it by hand from
 * the review screen.
 *
 * The bytes come from whoever holds a signing token, so the egress is bounded
 * rather than open: only PDFs and images are sent, only after the upload's
 * magic-byte validation has passed, and only when the organization has already
 * configured an extraction service of its own.
 */

/** Formats the extractor can actually read. The upload allow-list is wider. */
const READABLE = /\.(pdf|png|jpe?g|tiff?)$/i;

export type AttachmentOcrResult = {
  ok: boolean;
  /**
   * True when the org was over its Smart OCR page quota — the BMS ML call
   * was skipped, not attempted. Distinct from a genuine failure (`ok:
   * false, queued: false`): a queued attachment isn't broken, it's paused,
   * and will drain automatically once quota frees up.
   */
  queued: boolean;
  fileName: string;
  documentType: string | null;
  /** Number of fields extracted. Zero is a real answer, not a failure. */
  fieldCount: number;
  /**
   * The headline values, echoed back so the signer can be shown what was read
   * rather than being told "done" and left to guess whether it worked.
   */
  poNumber: string | null;
  vendorName: string | null;
  total: string | null;
  /**
   * Whether the PO number was copied onto the invoice's own extracted data,
   * and if not, why not. Null when there was no PO number to copy.
   */
  appliedToInvoice: 'applied' | 'already-present' | 'document-closed' | 'not-an-inbox-item' | null;
  error: string | null;
};

/**
 * Copy a PO number read from an attachment onto the invoice it belongs to.
 *
 * Only fills a gap. If the invoice already carries a usable PO number of its
 * own, that number stays — a PO that disagrees with the invoice is a mismatch
 * for a rule to catch, not something to quietly overwrite so the two agree.
 * Implausible extractor noise ("Box", "licy") does not count as usable.
 */
const applyPoNumberToInvoice = async (
  documentId: number,
  poNumber: string,
  fileName: string,
): Promise<'applied' | 'already-present' | 'document-closed' | 'not-an-inbox-item'> => {
  const item = await prisma.signatureInboxItem.findFirst({
    where: { documentId },
    select: { id: true, extractedData: true, document: { select: { status: true } } },
  });

  if (!item) return 'not-an-inbox-item';

  // A completed document was signed against its data as it stood.
  if (item.document.status === 'COMPLETED') return 'document-closed';

  const current =
    item.extractedData && typeof item.extractedData === 'object' && !Array.isArray(item.extractedData)
      ? { ...(item.extractedData as Record<string, unknown>) }
      : {};

  const existing = readOcrField(current, 'poNumber');
  if (looksLikePoNumber(existing)) return 'already-present';

  const previousValue = current.po_number === undefined ? null : String(current.po_number);
  current.po_number = poNumber;

  await prisma.$transaction([
    prisma.signatureInboxItem.update({
      where: { id: item.id },
      data: { extractedData: current as Prisma.InputJsonValue },
    }),
    prisma.inboxFieldEdit.create({
      data: {
        inboxItemId: item.id,
        field: 'po_number',
        previousValue,
        newValue: poNumber,
        // No user: the signer's attachment produced this, and they have a
        // token rather than an account.
        editedById: null,
        source: 'ATTACHMENT_OCR',
        sourceDetail: fileName,
      },
    }),
  ]);

  return 'applied';
};

export const runAttachmentOcr = async ({
  supportingFileId,
  organizationId,
  userId,
  templateId,
  existingUsageId,
}: {
  supportingFileId: string;
  organizationId: number;
  /**
   * Who asked for the read. Null when the signer's own upload triggered it —
   * they hold a signing token, not an account, so there is no user to record.
   */
  userId?: number | null;
  templateId?: number;
  /**
   * Set by the drain-queue job when re-attempting a previously QUEUED
   * attachment — skips the quota check and updates that row in place.
   */
  existingUsageId?: string;
}): Promise<AttachmentOcrResult> => {
  const file = await prisma.documentSupportingFile.findFirst({
    // Scoped through the document's organization — an id alone must not reach
    // another tenant's attachment.
    where: { id: supportingFileId, document: { organizationId } },
    select: {
      id: true,
      fileName: true,
      type: true,
      data: true,
      document: { select: { id: true, organizationId: true } },
    },
  });

  if (!file) {
    throw new Error('Attachment not found.');
  }

  const base: Omit<AttachmentOcrResult, 'ok' | 'error'> = {
    queued: false,
    fileName: file.fileName,
    documentType: null,
    fieldCount: 0,
    poNumber: null,
    vendorName: null,
    total: null,
    appliedToInvoice: null,
  };

  if (!READABLE.test(file.fileName)) {
    const error = `OCR can only read PDF and image attachments. "${file.fileName}" is neither.`;
    await prisma.documentSupportingFile.update({
      where: { id: file.id },
      data: { ocrRanAt: new Date(), ocrRanById: userId ?? null, ocrError: error },
    });

    return { ...base, ok: false, error };
  }

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
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

  if (!isBmsMlConfigured(orgConfig)) {
    const error = 'OCR is not configured for this organization.';
    await prisma.documentSupportingFile.update({
      where: { id: file.id },
      data: { ocrRanAt: new Date(), ocrRanById: userId ?? null, ocrError: error },
    });

    return { ...base, ok: false, error };
  }

  try {
    const bytes = await getFileServerSide({ type: file.type, data: file.data });
    const buffer = Buffer.from(bytes);

    // Compute page count and check quota BEFORE calling BMS ML — cheap,
    // local work first, the expensive network call only if there's room.
    // Skipped when the drain job already confirmed room for this exact file.
    const pageCount = await getPdfPageCount(buffer, file.fileName);
    const decision = existingUsageId
      ? ({ allowed: true } as const)
      : await assertOcrQuotaOrQueue({
          organizationId,
          pageCount,
          source: 'ATTACHMENT',
          sourceId: file.id,
        });

    if (!decision.allowed) {
      // Soft-stop: over quota, not an error — the upload already succeeded
      // and stays usable, just unenriched until quota frees up.
      await prisma.documentSupportingFile.update({
        where: { id: file.id },
        data: { ocrQueuedAt: new Date() },
      });

      return { ...base, ok: false, queued: true, error: null };
    }

    const result = await bmsMlUploadDocument(buffer, file.fileName, {
      orgConfig,
      // No sender-based routing here: an attachment has no sender of its own.
      // A caller that knows this is a purchase order can force the right
      // template explicitly.
      templateId,
    });

    await recordOcrPagesProcessed({
      organizationId,
      pageCount,
      source: 'ATTACHMENT',
      sourceId: file.id,
      triggeredById: userId,
      existingUsageId,
    });

    const extracted: Record<string, unknown> = {};
    for (const field of result.invoice.field_extractions ?? []) {
      extracted[field.field_name] = field.extracted_value;
    }

    await prisma.documentSupportingFile.update({
      where: { id: file.id },
      data: {
        ocrRanAt: new Date(),
        ocrRanById: userId ?? null,
        ocrError: null,
        // Recorded verbatim. The service is an invoice extractor and has never
        // returned "purchase_order" in this deployment, so this is evidence
        // about the classifier, not a fact about the document.
        ocrDocumentType: result.invoice.document_type ?? null,
        extractedData: extracted as Prisma.InputJsonValue,
        ocrMeta: {
          completeness: result.processing_details?.completeness ?? null,
          fieldExtractions: result.invoice.field_extractions ?? [],
          bmsMlInvoiceId: result.invoice.id,
          ocrConfidence: result.invoice.ocr_confidence ?? null,
          mlConfidence: result.invoice.ml_confidence ?? null,
          templateId: templateId ?? null,
        } as Prisma.InputJsonValue,
      },
    });

    // The extractor sometimes returns the caption with the value
    // ("PO Number: MER-PO-5023"); strip it so what is shown and what is
    // compared are both the bare reference.
    const text = (value: string | null) => {
      if (value === null) return null;
      const cleaned = stripFieldLabel(String(value));

      return cleaned === '' ? null : cleaned;
    };

    const poNumber = text(readOcrField(extracted, 'poNumber'));

    // Carry the PO number back onto the invoice itself.
    //
    // Without this the number lives only on the attachment, and the invoice's
    // own extracted data — the thing everyone reads, and the thing `ocr.*`
    // rules evaluate — still shows nothing. Recorded as an edit sourced from
    // the attachment rather than written silently, so the review screen can
    // say where it came from instead of implying the extractor found it on the
    // invoice.
    const appliedTo = poNumber ? await applyPoNumberToInvoice(file.document.id, poNumber, file.fileName) : null;

    return {
      ...base,
      ok: true,
      appliedToInvoice: appliedTo,
      documentType: result.invoice.document_type ?? null,
      fieldCount: Object.keys(extracted).length,
      poNumber,
      vendorName: text(readOcrField(extracted, 'vendorName')),
      total: text(readOcrField(extracted, 'totalAmount')),
      error: null,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'OCR failed.';

    console.error(`[attachment-ocr] Failed to read supporting file ${file.id}:`, err);

    await prisma.documentSupportingFile.update({
      where: { id: file.id },
      data: { ocrRanAt: new Date(), ocrRanById: userId ?? null, ocrError: error },
    });

    return { ...base, ok: false, error };
  }
};
