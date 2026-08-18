import { assertOcrQuotaOrQueue, recordOcrPagesProcessed } from '@documenso/ee/server-only/limits/ocr-quota';
import { getPdfPageCount } from '@documenso/lib/server-only/pdf/get-pdf-page-count';
import { bmsMlUploadDocument, isBmsMlConfigured } from '@documenso/lib/server-only/bms-ml/client';
import type { BmsMlUploadResult } from '@documenso/lib/server-only/bms-ml/client';
import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { prisma } from '@documenso/prisma';

export type DmsOcrConfig = {
  apiUrl: string | null;
  apiKey: string | null;
  apiUsername: string | null;
  apiPassword: string | null;
  defaultTemplateId?: number | null;
  defaultEngine?: string | null;
};

export type DmsOcrResult =
  | { status: 'not_configured' }
  | { status: 'queued' }
  | { status: 'processed'; pageCount: number; result: BmsMlUploadResult }
  | { status: 'error'; error: string };

/**
 * Single OCR runner for DMS documents — extracted from what were previously
 * two independent inline implementations (`createDocument`'s auto-OCR and
 * `triggerOcr`'s manual re-run in `dms-router.ts`), so quota metering only
 * has to be written once and both paths behave identically.
 *
 * Standardizes both callers on `getFileServerSide`, which handles every
 * storage backend (inline BYTES/BYTES_64 and S3_PATH) — `createDocument`'s
 * old inline version only read `BYTES_64` and silently skipped OCR for
 * S3-backed documents; `triggerOcr`'s already did this correctly. Fixed as
 * a side effect of the extraction, not a separate change.
 *
 * Deliberately does not write `DmsAuditLog` entries or format a tRPC
 * response — those are caller-specific (the manual `triggerOcr` mutation
 * wants both, the fire-and-forget auto-OCR path wants neither).
 */
export const runDmsOcr = async ({
  documentId,
  organizationId,
  orgConfig,
  templateId,
  ocrEngine,
  triggeredById,
  existingUsageId,
}: {
  documentId: string;
  organizationId: number;
  orgConfig: DmsOcrConfig;
  templateId?: number;
  ocrEngine?: string;
  /** Null = an automatic trigger (auto-OCR on upload) — no user to record. */
  triggeredById?: number | null;
  /**
   * Set by the drain-queue job when re-attempting a previously QUEUED
   * document — skips the quota check and updates that row in place.
   */
  existingUsageId?: string;
}): Promise<DmsOcrResult> => {
  if (!isBmsMlConfigured(orgConfig)) {
    return { status: 'not_configured' };
  }

  const document = await prisma.dmsDocument.findUniqueOrThrow({ where: { id: documentId } });

  const documentData = await prisma.documentData.findUnique({ where: { id: document.fileUrl } });

  if (!documentData) {
    return { status: 'error', error: 'Document data not found' };
  }

  try {
    const bytes = await getFileServerSide({ type: documentData.type, data: documentData.data });
    const buffer = Buffer.from(bytes);

    // Compute page count and check quota BEFORE calling BMS ML — cheap,
    // local work first, the expensive network call only if there's room.
    // Skipped when the drain job already confirmed room for this document.
    const pageCount = await getPdfPageCount(buffer, document.fileName);
    const decision = existingUsageId
      ? ({ allowed: true } as const)
      : await assertOcrQuotaOrQueue({
          organizationId,
          pageCount,
          source: 'DMS',
          sourceId: documentId,
        });

    if (!decision.allowed) {
      // Soft-stop: over quota, not an error — the filed document stays
      // usable, just unenriched until quota frees up.
      await prisma.dmsDocument.update({
        where: { id: documentId },
        data: { ocrQueuedAt: new Date() },
      });

      return { status: 'queued' };
    }

    const result = await bmsMlUploadDocument(buffer, document.fileName, {
      templateId,
      ocrEngine,
      orgConfig,
    });

    await recordOcrPagesProcessed({
      organizationId,
      pageCount,
      source: 'DMS',
      sourceId: documentId,
      triggeredById,
      existingUsageId,
    });

    return { status: 'processed', pageCount, result };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : 'OCR processing failed' };
  }
};
