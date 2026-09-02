import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';

import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import { APP_DOCUMENT_UPLOAD_SIZE_LIMIT } from '@documenso/lib/constants/app';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { createDocumentData } from '@documenso/lib/server-only/document-data/create-document-data';
import { getDocumentWhereInput } from '@documenso/lib/server-only/document/get-document-by-id';
import { getDocumentAndRecipientByToken } from '@documenso/lib/server-only/document/get-document-by-token';
import {
  MAX_SUPPORTING_FILES_PER_RECIPIENT,
  sanitizeSupportingFileName,
  validateSupportingFile,
} from '@documenso/lib/server-only/document/supporting-file-types';
import { runAttachmentOcr } from '@documenso/lib/server-only/inbox/run-attachment-ocr';
import { decryptPdf } from '@documenso/lib/server-only/pdf/decrypt-pdf';
import { getApiTokenByToken } from '@documenso/lib/server-only/public-api/get-api-token-by-token';
import { readOcrField } from '@documenso/lib/universal/ocr-fields';
import {
  PDF_PASSWORD_REQUIRED_CODE,
  PdfPasswordRequiredError,
} from '@documenso/lib/universal/pdf-errors';
import { stripFieldLabel } from '@documenso/lib/universal/reference-number';
import { getFileServerSide } from '@documenso/lib/universal/upload/get-file.server';
import { putFileServerSide } from '@documenso/lib/universal/upload/put-file.server';
import {
  getPresignGetUrl,
  getPresignPostUrl,
} from '@documenso/lib/universal/upload/server-actions';
import { prisma } from '@documenso/prisma';

import type { HonoEnv } from '../router';
import { buildSignedResponse } from './files.helpers';
import {
  type TGetPresignedGetUrlResponse,
  type TGetPresignedPostUrlResponse,
  ZGetPresignedGetUrlRequestSchema,
  ZGetPresignedPostUrlRequestSchema,
  ZUploadPdfRequestSchema,
} from './files.types';

/** The headline values from an attachment's extraction, for the signer's eyes. */
const summariseAttachment = (extractedData: unknown) => {
  const text = (value: string | null) => {
    if (value === null) return null;
    const cleaned = stripFieldLabel(String(value));

    return cleaned === '' ? null : cleaned;
  };

  return {
    poNumber: text(readOcrField(extractedData, 'poNumber')),
    vendorName: text(readOcrField(extractedData, 'vendorName')),
    total: text(readOcrField(extractedData, 'totalAmount')),
  };
};

/**
 * Run OCR over a just-uploaded attachment without ever failing the upload.
 *
 * The file is already stored by the time this runs. An extraction service that
 * is down, slow or misconfigured must show up as "we could not read it", not as
 * a lost attachment.
 */
const readAttachmentQuietly = async ({
  supportingFileId,
  organizationId,
  fileName,
}: {
  supportingFileId: string;
  organizationId: number | null;
  fileName: string;
}) => {
  // A personal document has no organization, so no extraction service either.
  if (organizationId === null) return null;

  // Saves a pointless round trip for the file types the extractor cannot read.
  if (!/\.(pdf|png|jpe?g|tiff?)$/i.test(fileName)) return null;

  try {
    const result = await runAttachmentOcr({ supportingFileId, organizationId, userId: null });

    return {
      ran: true,
      ok: result.ok,
      error: result.error,
      documentType: result.documentType,
      poNumber: result.poNumber,
      vendorName: result.vendorName,
      total: result.total,
      // Whether the number was carried onto the invoice, so the signer can be
      // told "this cleared it" rather than just "we read your file".
      appliedToInvoice: result.appliedToInvoice,
    };
  } catch (error) {
    console.error('[supporting-file] OCR failed after upload:', error);

    return {
      ran: true,
      ok: false,
      error: 'Could not read this file.',
      documentType: null,
      poNumber: null,
      vendorName: null,
      total: null,
      appliedToInvoice: null,
    };
  }
};

export const filesRoute = new Hono<HonoEnv>()
  /**
   * Strips the encryption from a PDF that opens without a password and returns
   * the unlocked bytes.
   *
   * The browser can render these files (pdf.js decrypts them) but can't merge
   * or stamp them, because pdf-lib has no decryption support. MuPDF only runs
   * server side, so the client posts the file here whenever `PDFDocument.load`
   * rejects it as encrypted.
   */
  .post('/decrypt-pdf', sValidator('form', ZUploadPdfRequestSchema), async (c) => {
    const session = await getOptionalSession(c.req.raw);

    if (!session.isAuthenticated) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { file } = c.req.valid('form');

    if (!file) {
      return c.json({ error: 'No file provided' }, 400);
    }

    if (file.size > APP_DOCUMENT_UPLOAD_SIZE_LIMIT * 1024 * 1024) {
      return c.json({ error: 'File too large' }, 400);
    }

    try {
      const decrypted = await decryptPdf(new Uint8Array(await file.arrayBuffer()));

      return c.body(decrypted.buffer as ArrayBuffer, 200, {
        'Content-Type': 'application/pdf',
        'Content-Length': String(decrypted.byteLength),
      });
    } catch (error) {
      if (error instanceof PdfPasswordRequiredError) {
        return c.json({ error: error.message, code: PDF_PASSWORD_REQUIRED_CODE }, 400);
      }

      console.error('PDF decrypt failed:', error);

      return c.json({ error: 'Could not read this PDF' }, 400);
    }
  })
  /**
   * Uploads a document file to the appropriate storage location and creates
   * a document data record.
   */
  .post('/upload-pdf', sValidator('form', ZUploadPdfRequestSchema), async (c) => {
    try {
      const { file } = c.req.valid('form');

      if (!file) {
        return c.json({ error: 'No file provided' }, 400);
      }

      // Todo: (RR7) This is new.
      // Add file size validation.
      // Convert MB to bytes (1 MB = 1024 * 1024 bytes)
      const MAX_FILE_SIZE = APP_DOCUMENT_UPLOAD_SIZE_LIMIT * 1024 * 1024;

      if (file.size > MAX_FILE_SIZE) {
        return c.json({ error: 'File too large' }, 400);
      }

      const arrayBuffer = await file.arrayBuffer();

      const pdf = await PDFDocument.load(arrayBuffer).catch((e) => {
        console.error(`PDF upload parse error: ${e.message}`);

        throw new AppError('INVALID_DOCUMENT_FILE');
      });

      if (pdf.isEncrypted) {
        throw new AppError('INVALID_DOCUMENT_FILE');
      }

      // Todo: (RR7) Test this.
      if (!file.name.endsWith('.pdf')) {
        Object.defineProperty(file, 'name', {
          writable: true,
          value: `${file.name}.pdf`,
        });
      }

      const { type, data } = await putFileServerSide(file);

      const result = await createDocumentData({ type, data });

      return c.json(result);
    } catch (error) {
      console.error('Upload failed:', error);
      return c.json({ error: 'Upload failed' }, 500);
    }
  })
  .post('/presigned-get-url', sValidator('json', ZGetPresignedGetUrlRequestSchema), async (c) => {
    const { key } = await c.req.json();

    try {
      const { url } = await getPresignGetUrl(key || '');

      return c.json({ url } satisfies TGetPresignedGetUrlResponse);
    } catch (err) {
      console.error(err);

      throw new AppError(AppErrorCode.UNKNOWN_ERROR);
    }
  })
  .post('/presigned-post-url', sValidator('json', ZGetPresignedPostUrlRequestSchema), async (c) => {
    const { fileName, contentType } = c.req.valid('json');

    try {
      const { key, url } = await getPresignPostUrl(fileName, contentType);

      return c.json({ key, url } satisfies TGetPresignedPostUrlResponse);
    } catch (err) {
      console.error(err);

      throw new AppError(AppErrorCode.UNKNOWN_ERROR);
    }
  })
  // DMS generic file upload — accepts any file type (not just PDF)
  .post('/upload-dms', async (c) => {
    try {
      const session = await getOptionalSession(c.req.raw);

      if (!session.isAuthenticated) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const formData = await c.req.formData();
      const file = formData.get('file') as File | null;

      if (!file) {
        return c.json({ error: 'No file provided' }, 400);
      }

      const MAX_FILE_SIZE = APP_DOCUMENT_UPLOAD_SIZE_LIMIT * 1024 * 1024;

      if (file.size > MAX_FILE_SIZE) {
        return c.json({ error: 'File too large' }, 400);
      }

      const { type, data } = await putFileServerSide(file);
      const result = await createDocumentData({ type, data });

      return c.json(result);
    } catch (error) {
      console.error('DMS upload failed:', error);
      return c.json({ error: 'Upload failed' }, 500);
    }
  })
  /**
   * A signer attaching supporting documentation (PO, spec, photo) while signing.
   *
   * Authenticated by the signing token alone — the signer has no account — so
   * every limit here is load-bearing rather than advisory:
   *   - the token must resolve to a recipient who hasn't finished signing,
   *   - the file must pass `validateSupportingFile` (extension + MIME + magic
   *     bytes; executables and archives refused),
   *   - a per-recipient count cap bounds abuse of an unauthenticated endpoint.
   */
  /**
   * The attachments this signing token has already uploaded.
   *
   * Without it the signing page starts from an empty list every time, so a
   * signer who refreshed could not see what they had sent, could not remove it,
   * and could re-upload the same file until the per-recipient cap tripped.
   */
  .get('/supporting/:token', async (c) => {
    const token = c.req.param('token');

    const recipient = await prisma.recipient.findFirst({
      where: { token },
      select: { id: true },
    });

    if (!recipient) {
      return c.json({ error: 'Invalid signing link.' }, 404);
    }

    const files = await prisma.documentSupportingFile.findMany({
      where: { recipientId: recipient.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        ocrRanAt: true,
        ocrError: true,
        ocrDocumentType: true,
        extractedData: true,
      },
    });

    return c.json(
      files.map(({ extractedData, ocrRanAt, ocrError, ocrDocumentType, ...file }) => ({
        ...file,
        ocr: ocrRanAt
          ? {
              ran: true,
              ok: ocrError === null,
              error: ocrError,
              documentType: ocrDocumentType,
              ...summariseAttachment(extractedData),
            }
          : null,
      })),
    );
  })
  .post('/supporting/:token', async (c) => {
    try {
      const token = c.req.param('token');

      const recipient = await prisma.recipient.findFirst({
        where: { token },
        select: {
          id: true,
          documentId: true,
          signingStatus: true,
          document: { select: { id: true, status: true, organizationId: true } },
        },
      });

      if (!recipient?.document) {
        return c.json({ error: 'Invalid signing link.' }, 404);
      }

      // Closed documents accept nothing further; neither does a recipient who
      // already signed, or the endpoint would be writable forever.
      if (recipient.document.status === 'COMPLETED' || recipient.document.status === 'REJECTED') {
        return c.json({ error: 'This document is already closed.' }, 400);
      }

      if (recipient.signingStatus === 'SIGNED') {
        return c.json({ error: 'You have already completed this document.' }, 400);
      }

      const existingCount = await prisma.documentSupportingFile.count({
        where: { recipientId: recipient.id },
      });

      if (existingCount >= MAX_SUPPORTING_FILES_PER_RECIPIENT) {
        return c.json(
          { error: `You can attach at most ${MAX_SUPPORTING_FILES_PER_RECIPIENT} files.` },
          400,
        );
      }

      const formData = await c.req.formData();
      const file = formData.get('file');

      if (!(file instanceof File)) {
        return c.json({ error: 'No file provided.' }, 400);
      }

      // Read once; the head is needed for signature checking and the whole
      // buffer for storage.
      const arrayBuffer = await file.arrayBuffer();
      const head = new Uint8Array(arrayBuffer.slice(0, 16));

      const verdict = validateSupportingFile({
        fileName: file.name,
        declaredType: file.type,
        sizeBytes: arrayBuffer.byteLength,
        bytes: head,
      });

      if (!verdict.ok) {
        return c.json({ error: verdict.reason }, 400);
      }

      const fileName = sanitizeSupportingFileName(file.name);

      // Re-wrapped with the VERIFIED content type, so what gets stored (and
      // later served) is never the client's claim.
      const safeFile = new File([arrayBuffer], fileName, { type: verdict.contentType });
      const { type, data } = await putFileServerSide(safeFile);

      const created = await prisma.documentSupportingFile.create({
        data: {
          documentId: recipient.documentId!,
          recipientId: recipient.id,
          fileName,
          contentType: verdict.contentType,
          sizeBytes: arrayBuffer.byteLength,
          type,
          data,
        },
        select: { id: true, fileName: true, contentType: true, sizeBytes: true, createdAt: true },
      });

      // Read the attachment straight away.
      //
      // This is what makes "attach the PO and carry on signing" work: the
      // signer is an external party who cannot reach the Signature Inbox, so
      // waiting for someone in the office to press a button would leave them
      // blocked with no way forward. The extracted fields become available to
      // the business rules as `attachedPo.*`, and the next press of Sign is
      // evaluated against them.
      //
      // Never allowed to fail the upload — the file is already stored, and a
      // extraction service being down must not look like a failed attachment.
      const ocr = await readAttachmentQuietly({
        supportingFileId: created.id,
        organizationId: recipient.document.organizationId,
        fileName: created.fileName,
      });

      return c.json({ ...created, ocr });
    } catch (error) {
      console.error('Supporting file upload failed:', error);

      return c.json({ error: 'Upload failed.' }, 500);
    }
  })
  /** Remove one of your own attachments before you finish signing. */
  .delete('/supporting/:token/:id', async (c) => {
    try {
      const token = c.req.param('token');
      const id = c.req.param('id');

      const recipient = await prisma.recipient.findFirst({
        where: { token },
        select: { id: true, signingStatus: true },
      });

      if (!recipient) {
        return c.json({ error: 'Invalid signing link.' }, 404);
      }

      if (recipient.signingStatus === 'SIGNED') {
        return c.json({ error: 'You have already completed this document.' }, 400);
      }

      // Scoped to this recipient, so a token can only delete its own uploads.
      const deleted = await prisma.documentSupportingFile.deleteMany({
        where: { id, recipientId: recipient.id },
      });

      if (deleted.count === 0) {
        return c.json({ error: 'Attachment not found.' }, 404);
      }

      return c.json({ success: true });
    } catch (error) {
      console.error('Supporting file delete failed:', error);

      return c.json({ error: 'Delete failed.' }, 500);
    }
  })
  /**
   * Download a supporting file.
   *
   * Two ways in, mirroring who legitimately needs it: a signed-in user with
   * access to the parent document, or a recipient holding a signing token for
   * it. Anything else is a 404 — never "forbidden", which would confirm the id.
   *
   * The path carries a literal `file/` segment, and must keep it. This route was
   * originally `/supporting/:id`, which `GET /supporting/:token` above matches
   * just as well — so every download was answered by the list handler, which
   * read the file id as a signing token, found no recipient, and returned
   * `{"error":"Invalid signing link."}` with a 404. Two single-segment GETs
   * under the same prefix cannot be told apart by ordering; only a distinct
   * path fixes it.
   */
  .get('/supporting/file/:id', async (c) => {
    try {
      const id = c.req.param('id');
      const recipientToken = new URL(c.req.url).searchParams.get('recipientToken');

      const file = await prisma.documentSupportingFile.findUnique({
        where: { id },
        select: {
          fileName: true,
          contentType: true,
          type: true,
          data: true,
          documentId: true,
        },
      });

      if (!file) {
        return c.json({ error: 'Not found' }, 404);
      }

      let authorized = false;

      if (recipientToken) {
        const recipient = await prisma.recipient.findFirst({
          where: { token: recipientToken, documentId: file.documentId },
          select: { id: true },
        });

        authorized = Boolean(recipient);
      }

      if (!authorized) {
        const session = await getOptionalSession(c.req.raw);

        if (session.isAuthenticated && session.user) {
          // Reuses the document's own access rule rather than inventing a second
          // one, so attachments can never be broader than their document.
          const where = await getDocumentWhereInput({
            documentId: file.documentId,
            userId: session.user.id,
          });

          authorized = Boolean(await prisma.document.findFirst({ where }));
        }
      }

      if (!authorized) {
        return c.json({ error: 'Not found' }, 404);
      }

      const bytes = await getFileServerSide({ type: file.type, data: file.data });

      return new Response(new Uint8Array(bytes), {
        headers: {
          'Content-Type': file.contentType,
          // `attachment` matters: it stops the browser rendering an uploaded
          // file inline, which for an SVG or HTML would be same-origin script
          // execution. The name is already sanitized at upload.
          'Content-Disposition': `attachment; filename="${file.fileName}"`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'private, max-age=0, no-store',
        },
      });
    } catch (error) {
      console.error('Supporting file download failed:', error);

      return c.json({ error: 'Download failed' }, 500);
    }
  })
  // DMS document preview — serve DocumentData by ID for authenticated users
  .get('/dms-preview/:dataId', async (c) => {
    try {
      const session = await getOptionalSession(c.req.raw);

      if (!session.isAuthenticated) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const dataId = c.req.param('dataId');

      const documentData = await prisma.documentData.findUnique({
        where: { id: dataId },
      });

      if (!documentData) {
        return c.json({ error: 'Not found' }, 404);
      }

      // For database storage: data is base64 encoded
      if (documentData.type === 'BYTES_64') {
        const buffer = Buffer.from(documentData.data, 'base64');

        return new Response(buffer, {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'inline',
            'Cache-Control': 'private, max-age=3600',
          },
        });
      }

      // For S3 storage: get presigned URL and redirect
      if (documentData.type === 'S3_PATH') {
        const { url } = await getPresignGetUrl(documentData.data);
        return c.redirect(url);
      }

      return c.json({ error: 'Unsupported storage type' }, 400);
    } catch (err) {
      console.error('DMS preview error:', err);
      return c.json({ error: 'Failed to load preview' }, 500);
    }
  })
  .get('/download/signed', async (c) => {
    try {
      const searchParams = new URL(c.req.url).searchParams;
      const recipientToken = searchParams.get('recipientToken');
      const apiTokenParam = searchParams.get('apiToken');
      const documentIdParam = searchParams.get('documentId');
      const documentId = z.coerce.number().int().positive().parse(documentIdParam);
      if (!documentId) {
        throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Document not found' });
      }

      let userId: number | undefined;

      if (recipientToken) {
        const byToken = await getDocumentAndRecipientByToken({ token: recipientToken });

        if (byToken.id !== documentId) throw new AppError(AppErrorCode.UNAUTHORIZED);

        if (!byToken.documentData)
          throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Document data not found' });

        return c.json(
          await buildSignedResponse(byToken.documentData.type, byToken.documentData.data),
        );
      }

      let requesterEmail: string | undefined;

      const token = apiTokenParam;
      if (token) {
        const apiToken = await getApiTokenByToken({ token }).catch(() => null);

        if (!apiToken || apiToken.user.disabled)
          throw new AppError(AppErrorCode.UNAUTHORIZED, { message: 'Invalid API token' });

        userId = apiToken.user.id;
        requesterEmail = apiToken.user.email.toLowerCase();
      } else {
        const { user } = await getOptionalSession(c);
        if (!user) throw new AppError(AppErrorCode.UNAUTHORIZED);

        userId = user.id;
        requesterEmail = user.email.toLowerCase();
      }

      const doc = await prisma.document.findFirst({
        where: { id: documentId },
        include: {
          documentData: true,
          user: { select: { id: true, email: true } },
          recipients: { select: { email: true } },
        },
      });
      if (!doc) throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Document not found' });

      const isOwner = !!userId && doc.user?.id === userId;
      const isRecipient =
        doc.recipients?.some((r) => r.email.toLowerCase() === requesterEmail) ?? false;
      if (!isOwner && !isRecipient) throw new AppError(AppErrorCode.UNAUTHORIZED);
      if (!doc.documentData)
        throw new AppError(AppErrorCode.NOT_FOUND, { message: 'Document data not found' });

      return c.json(await buildSignedResponse(doc.documentData.type, doc.documentData.data));
    } catch (error) {
      console.error('Download failed:', error);
      const appErr = AppError.parseError(error);
      const { status, body } = AppError.toRestAPIError(appErr);
      return c.json(body, status);
    }
  });
