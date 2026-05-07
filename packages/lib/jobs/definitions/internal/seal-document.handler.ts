import { DocumentStatus, RecipientRole, SigningStatus, WebhookTriggerEvents } from '@prisma/client';
import { nanoid } from 'nanoid';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

import { prisma } from '@documenso/prisma';
import { signPdf } from '@documenso/signing';

import { AppError, AppErrorCode } from '../../../errors/app-error';
import { decryptSecondaryData } from '../../../server-only/crypto/decrypt';
import { sendCompletedEmail } from '../../../server-only/document/send-completed-email';
import PostHogServerClient from '../../../server-only/feature-flags/get-post-hog-server-client';
import { getCertificatePdf } from '../../../server-only/htmltopdf/get-certificate-pdf';
import { addRejectionStampToPdf } from '../../../server-only/pdf/add-rejection-stamp-to-pdf';
import { encryptPdfWithPassword } from '../../../server-only/pdf/encrypt-pdf';
import { flattenAnnotations } from '../../../server-only/pdf/flatten-annotations';
import { flattenForm } from '../../../server-only/pdf/flatten-form';
import { insertFieldInPDF } from '../../../server-only/pdf/insert-field-in-pdf';
import { legacy_insertFieldInPDF } from '../../../server-only/pdf/legacy-insert-field-in-pdf';
import { normalizeSignatureAppearances } from '../../../server-only/pdf/normalize-signature-appearances';
import { triggerWebhook } from '../../../server-only/webhooks/trigger/trigger-webhook';
import { DOCUMENT_AUDIT_LOG_TYPE } from '../../../types/document-audit-logs';
import {
  ZWebhookDocumentSchema,
  mapDocumentToWebhookDocumentPayload,
} from '../../../types/webhook-payload';
import { prefixedId } from '../../../universal/id';
import { getFileServerSide } from '../../../universal/upload/get-file.server';
import { putPdfFileServerSide } from '../../../universal/upload/put-file.server';
import { fieldsContainUnsignedRequiredField } from '../../../utils/advanced-fields-helpers';
import { isDocumentCompleted } from '../../../utils/document';
import { createDocumentAuditLogData } from '../../../utils/document-audit-logs';
import type { JobRunIO } from '../../client/_internal/job';
import type { TSealDocumentJobDefinition } from './seal-document';

export const run = async ({
  payload,
  io,
}: {
  payload: TSealDocumentJobDefinition;
  io: JobRunIO;
}) => {
  const { documentId, sendEmail = true, isResealing = false, requestMetadata } = payload;

  const document = await prisma.document.findFirstOrThrow({
    where: {
      id: documentId,
    },
    include: {
      documentMeta: true,
      recipients: true,
      team: {
        select: {
          teamGlobalSettings: {
            select: {
              includeSigningCertificate: true,
            },
          },
        },
      },
    },
  });

  const isComplete =
    document.recipients.some((recipient) => recipient.signingStatus === SigningStatus.REJECTED) ||
    document.recipients.every((recipient) => recipient.signingStatus === SigningStatus.SIGNED);

  if (!isComplete) {
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
      message: 'Document is not complete',
    });
  }

  // Seems silly but we need to do this in case the job is re-ran
  // after it has already run through the update task further below.
  // eslint-disable-next-line @typescript-eslint/require-await
  const documentStatus = await io.runTask('get-document-status', async () => {
    return document.status;
  });

  // This is the same case as above.
  // eslint-disable-next-line @typescript-eslint/require-await
  const documentDataId = await io.runTask('get-document-data-id', async () => {
    return document.documentDataId;
  });

  const documentData = await prisma.documentData.findFirst({
    where: {
      id: documentDataId,
    },
  });

  if (!documentData) {
    throw new Error(`Document ${document.id} has no document data`);
  }

  const recipients = await prisma.recipient.findMany({
    where: {
      documentId: document.id,
      role: {
        not: RecipientRole.CC,
      },
    },
  });

  // Determine if the document has been rejected by checking if any recipient has rejected it
  const rejectedRecipient = recipients.find(
    (recipient) => recipient.signingStatus === SigningStatus.REJECTED,
  );

  const isRejected = Boolean(rejectedRecipient);

  // Get the rejection reason from the rejected recipient
  const rejectionReason = rejectedRecipient?.rejectionReason ?? '';

  const fields = await prisma.field.findMany({
    where: {
      documentId: document.id,
    },
    include: {
      signature: true,
      fieldSignedPosition: true,
    },
  });

  // Skip the field check if the document is rejected
  if (!isRejected && fieldsContainUnsignedRequiredField(fields)) {
    throw new Error(`Document ${document.id} has unsigned required fields`);
  }

  if (isResealing) {
    // If we're resealing we want to use the initial data for the document
    // so we aren't placing fields on top of eachother.
    documentData.data = documentData.initialData;
  }

  if (!document.qrToken) {
    await prisma.document.update({
      where: {
        id: document.id,
      },
      data: {
        qrToken: prefixedId('qr'),
      },
    });
  }

  const pdfData = await getFileServerSide(documentData);

  const certificateData =
    (document.team?.teamGlobalSettings?.includeSigningCertificate ?? true)
      ? await getCertificatePdf({
          documentId,
          language: document.documentMeta?.language,
          // Tell the renderer the seal's terminal state so the audit page
          // shows "Completed" / "Rejected" instead of the live "Pending".
          completionStatus: isRejected ? 'REJECTED' : 'COMPLETED',
        }).catch((err) => {
          // Don't abort the seal — but make this loud so we don't keep
          // silently shipping certificate-less PDFs to production. Most
          // common cause: Chromium / Playwright not installed in the
          // production image (dev images already have it from npm install).
          console.error(
            '[seal-document.handler] Failed to render audit certificate. Document will be sealed without it.',
            err,
          );
          return null;
        })
      : null;

  const newDataId = await io.runTask('decorate-and-sign-pdf', async () => {
    const pdfDoc = await PDFDocument.load(pdfData);

    // Normalize and flatten layers that could cause issues with the signature
    normalizeSignatureAppearances(pdfDoc);
    flattenForm(pdfDoc);
    flattenAnnotations(pdfDoc);

    // Add rejection stamp if the document is rejected
    if (isRejected && rejectionReason) {
      await addRejectionStampToPdf(pdfDoc, rejectionReason);
    }

    if (certificateData) {
      const certificateDoc = await PDFDocument.load(certificateData);

      const certificatePages = await pdfDoc.copyPages(
        certificateDoc,
        certificateDoc.getPageIndices(),
      );

      certificatePages.forEach((page) => {
        pdfDoc.addPage(page);
      });
    }

    for (const field of fields) {
      if (field.inserted) {
        document.useLegacyFieldInsertion
          ? await legacy_insertFieldInPDF(pdfDoc, field)
          : await insertFieldInPDF(pdfDoc, field);
      }
    }

    // Re-flatten the form to handle our checkbox and radio fields that
    // create native arcoFields
    flattenForm(pdfDoc);

    const pdfBytes = await pdfDoc.save();
    let pdfBuffer = await signPdf({ pdf: Buffer.from(pdfBytes) });

    // Apply PDF user-password lock if the owner opted in. The password was
    // held encrypted-at-rest on the document row during signing; decrypt it
    // just for this operation. The cleanup transaction below clears the
    // password from the row so the system no longer holds it.
    let pdfWasLocked = false;
    if (!isRejected && document.pdfPassword) {
      try {
        const decrypted = decryptSecondaryData(document.pdfPassword);
        if (decrypted) {
          pdfBuffer = await encryptPdfWithPassword(pdfBuffer, decrypted);
          pdfWasLocked = true;
        }
      } catch (err) {
        console.error('[seal-document.handler] Failed to apply PDF password lock:', err);
        throw new Error(
          'Failed to apply PDF password lock. The document was not sealed. ' +
            (err instanceof Error ? err.message : String(err)),
        );
      }
    }

    const { name } = path.parse(document.title);

    // Add suffix based on document status
    const suffix = isRejected ? '_rejected.pdf' : '_signed.pdf';

    const documentData = await putPdfFileServerSide(
      {
        name: `${name}${suffix}`,
        type: 'application/pdf',
        arrayBuffer: async () => Promise.resolve(pdfBuffer),
      },
      // Bypass the "no encrypted PDFs" validation since we just intentionally
      // encrypted this one with the owner's chosen password.
      { allowEncrypted: pdfWasLocked },
    );

    return documentData.id;
  });

  const postHog = PostHogServerClient();

  if (postHog) {
    postHog.capture({
      distinctId: nanoid(),
      event: 'App: Document Sealed',
      properties: {
        documentId: document.id,
        isRejected,
      },
    });
  }

  await io.runTask('update-document', async () => {
    await prisma.$transaction(async (tx) => {
      const newData = await tx.documentData.findFirstOrThrow({
        where: {
          id: newDataId,
        },
      });

      await tx.document.update({
        where: {
          id: document.id,
        },
        data: {
          status: isRejected ? DocumentStatus.REJECTED : DocumentStatus.COMPLETED,
          completedAt: new Date(),
          // If a PDF lock password was held during signing, clear it now so the
          // system no longer holds it, and mark the PDF as locked.
          ...(document.pdfPassword && !isRejected
            ? { pdfPassword: null, pdfLocked: true }
            : {}),
        },
      });

      await tx.documentData.update({
        where: {
          id: documentData.id,
        },
        data: {
          data: newData.data,
        },
      });

      await tx.documentAuditLog.create({
        data: createDocumentAuditLogData({
          type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_COMPLETED,
          documentId: document.id,
          requestMetadata,
          user: null,
          data: {
            transactionId: nanoid(),
            ...(isRejected ? { isRejected: true, rejectionReason: rejectionReason } : {}),
          },
        }),
      });
    });
  });

  // Non-fatal: by this point the document is fully sealed (PDF generated,
  // status=COMPLETED, file swapped on documentData). If notification email
  // fails — typically SMTP misconfig or network reachability (we've seen
  // ECONNREFUSED to the org's relay) — log it but DO NOT rethrow. Throwing
  // inside io.runTask causes the local jobs runner to retry the entire
  // seal job up to 3x, re-rendering Chromium and re-uploading the PDF on
  // each pass; that's how we ended up with cert-less PDFs in production.
  // We deliberately do NOT wrap this in io.runTask anymore — it's a
  // best-effort side-effect after the document is already sealed.
  {
    let shouldSendCompletedEmail = sendEmail && !isResealing && !isRejected;

    if (isResealing && !isDocumentCompleted(document.status)) {
      shouldSendCompletedEmail = sendEmail;
    }

    if (shouldSendCompletedEmail) {
      try {
        await sendCompletedEmail({ documentId, requestMetadata });
      } catch (err) {
        console.error(
          '[seal-document.handler] sendCompletedEmail failed (non-fatal — document is already sealed):',
          err,
        );
      }
    }
  }

  const updatedDocument = await prisma.document.findFirstOrThrow({
    where: {
      id: document.id,
    },
    include: {
      documentData: true,
      documentMeta: true,
      recipients: true,
    },
  });

  await triggerWebhook({
    event: isRejected
      ? WebhookTriggerEvents.DOCUMENT_REJECTED
      : WebhookTriggerEvents.DOCUMENT_COMPLETED,
    data: ZWebhookDocumentSchema.parse(mapDocumentToWebhookDocumentPayload(updatedDocument)),
    userId: updatedDocument.userId,
    teamId: updatedDocument.teamId ?? undefined,
  });
};
