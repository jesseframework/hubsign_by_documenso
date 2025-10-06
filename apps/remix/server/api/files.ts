import { sValidator } from '@hono/standard-validator';
import { Hono } from 'hono';
import { PDFDocument } from 'pdf-lib';
import { z } from 'zod';

import { getOptionalSession } from '@documenso/auth/server/lib/utils/get-session';
import { APP_DOCUMENT_UPLOAD_SIZE_LIMIT } from '@documenso/lib/constants/app';
import { AppError, AppErrorCode } from '@documenso/lib/errors/app-error';
import { createDocumentData } from '@documenso/lib/server-only/document-data/create-document-data';
import { getDocumentAndRecipientByToken } from '@documenso/lib/server-only/document/get-document-by-token';
import { getApiTokenByToken } from '@documenso/lib/server-only/public-api/get-api-token-by-token';
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

export const filesRoute = new Hono<HonoEnv>()
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
