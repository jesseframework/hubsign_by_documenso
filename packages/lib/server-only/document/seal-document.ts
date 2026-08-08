import { DocumentStatus, RecipientRole, SigningStatus, WebhookTriggerEvents } from '@prisma/client';
import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

import PostHogServerClient from '@documenso/lib/server-only/feature-flags/get-post-hog-server-client';
import { DOCUMENT_AUDIT_LOG_TYPE } from '@documenso/lib/types/document-audit-logs';
import { createDocumentAuditLogData } from '@documenso/lib/utils/document-audit-logs';
import { prisma } from '@documenso/prisma';
import { signPdf } from '@documenso/signing';

import {
  ZWebhookDocumentSchema,
  mapDocumentToWebhookDocumentPayload,
} from '../../types/webhook-payload';
import type { RequestMetadata } from '../../universal/extract-request-metadata';
import { getFileServerSide } from '../../universal/upload/get-file.server';
import { putPdfFileServerSide } from '../../universal/upload/put-file.server';
import { fieldsContainUnsignedRequiredField } from '../../utils/advanced-fields-helpers';
import { shouldIncludeSigningCertificate } from '../../utils/signing-certificate';
import { decryptSecondaryData } from '../crypto/decrypt';
import { getCertificatePdf } from '../htmltopdf/get-certificate-pdf';
import { addRejectionStampToPdf } from '../pdf/add-rejection-stamp-to-pdf';
import { encryptPdfWithPassword } from '../pdf/encrypt-pdf';
import { flattenAnnotations } from '../pdf/flatten-annotations';
import { flattenForm } from '../pdf/flatten-form';
import { insertFieldInPDF } from '../pdf/insert-field-in-pdf';
import { legacy_insertFieldInPDF } from '../pdf/legacy-insert-field-in-pdf';
import { normalizeSignatureAppearances } from '../pdf/normalize-signature-appearances';
import { embedStampsOnPdf } from '../stamps/embed-stamp-on-pdf';
import { publishInboxEventForDocument } from '../inbox/publish-document-change';
import { triggerWebhook } from '../webhooks/trigger/trigger-webhook';
import { sendCompletedEmail } from './send-completed-email';

export type SealDocumentOptions = {
  documentId: number;
  sendEmail?: boolean;
  isResealing?: boolean;
  requestMetadata?: RequestMetadata;
};

export const sealDocument = async ({
  documentId,
  sendEmail = true,
  isResealing = false,
  requestMetadata,
}: SealDocumentOptions) => {
  const document = await prisma.document.findFirstOrThrow({
    where: {
      id: documentId,
    },
    include: {
      documentData: true,
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
      organization: {
        select: {
          includeSigningCertificate: true,
        },
      },
    },
  });

  const { documentData } = document;

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

  // If the document is not rejected, ensure all recipients have signed
  if (
    !isRejected &&
    recipients.some((recipient) => recipient.signingStatus !== SigningStatus.SIGNED)
  ) {
    throw new Error(`Document ${document.id} has unsigned recipients`);
  }

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

  // !: Need to write the fields onto the document as a hard copy
  const pdfData = await getFileServerSide(documentData);

  const certificateData = shouldIncludeSigningCertificate({
    teamSetting: document.team?.teamGlobalSettings?.includeSigningCertificate,
    organizationSetting: document.organization?.includeSigningCertificate,
  })
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
          '[seal-document] Failed to render audit certificate. Document will be sealed without it.',
          err,
        );
        return null;
      })
    : null;

  const doc = await PDFDocument.load(pdfData);

  // Normalize and flatten layers that could cause issues with the signature
  normalizeSignatureAppearances(doc);
  flattenForm(doc);
  flattenAnnotations(doc);

  // Add rejection stamp if the document is rejected
  if (isRejected && rejectionReason) {
    await addRejectionStampToPdf(doc, rejectionReason);
  }

  // Track how many trailing pages of the final sealed PDF are the audit
  // certificate so the client can offer "Download without audit certificate"
  // by slicing them off. 0 when the team disabled the cert or rendering
  // failed (e.g. Chromium missing in production).
  let certificatePageCount = 0;

  if (certificateData) {
    const certificate = await PDFDocument.load(certificateData);

    const certificatePages = await doc.copyPages(certificate, certificate.getPageIndices());

    certificatePages.forEach((page) => {
      doc.addPage(page);
    });

    certificatePageCount = certificatePages.length;
  }

  for (const field of fields) {
    document.useLegacyFieldInsertion
      ? await legacy_insertFieldInPDF(doc, field)
      : await insertFieldInPDF(doc, field);
  }

  // Draw any custom stamps the owner placed on the document. Best-effort —
  // a broken placement logs and is skipped rather than aborting the seal.
  if (!isRejected) {
    await embedStampsOnPdf(doc, document.id);
  }

  // Re-flatten post-insertion to handle fields that create arcoFields
  flattenForm(doc);

  const pdfBytes = await doc.save();

  let pdfBuffer = await signPdf({ pdf: Buffer.from(pdfBytes) });

  // Apply PDF user-password lock if the owner opted in at upload time. The
  // password was held encrypted-at-rest on the document row during signing;
  // we decrypt it just for this operation, encrypt the PDF with it, then
  // clear the field below so the system no longer holds the password.
  let pdfWasLocked = false;
  if (!isRejected && document.pdfPassword) {
    try {
      const decrypted = decryptSecondaryData(document.pdfPassword);
      if (decrypted) {
        pdfBuffer = await encryptPdfWithPassword(pdfBuffer, decrypted);
        pdfWasLocked = true;
      }
    } catch (err) {
      console.error('[seal-document] Failed to apply PDF password lock:', err);
      throw new Error(
        'Failed to apply PDF password lock. The document was not sealed. ' +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  // SHA-256 of the final sealed bytes — exposed on /verify/:token so anyone
  // can recompute the same hash from a downloaded copy and confirm the file
  // hasn't been modified since signing. We hash the canonical form (post-sign,
  // post-encryption if locked) since that's what end users receive.
  const signatureHash = createHash('sha256').update(pdfBuffer).digest('hex');

  const { name } = path.parse(document.title);

  // Add suffix based on document status
  const suffix = isRejected ? '_rejected.pdf' : '_signed.pdf';

  const { data: newData } = await putPdfFileServerSide(
    {
      name: `${name}${suffix}`,
      type: 'application/pdf',
      arrayBuffer: async () => Promise.resolve(pdfBuffer),
    },
    { allowEncrypted: pdfWasLocked },
  );

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

  await prisma.$transaction(async (tx) => {
    await tx.document.update({
      where: {
        id: document.id,
      },
      data: {
        status: isRejected ? DocumentStatus.REJECTED : DocumentStatus.COMPLETED,
        completedAt: new Date(),
        signatureHash,
        certificatePageCount,
        // Clear the held password and mark the PDF as locked. After this point
        // the system has no way to recover the password.
        ...(document.pdfPassword
          ? {
              pdfPassword: null,
              pdfLocked: pdfWasLocked,
            }
          : {}),
      },
    });

    await tx.documentData.update({
      where: {
        id: documentData.id,
      },
      data: {
        data: newData,
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
          ...(isRejected ? { isRejected: true, rejectionReason } : {}),
        },
      }),
    });
  });

  if (sendEmail && !isResealing) {
    // Non-fatal: by this point the document is fully sealed (PDF generated,
    // status=COMPLETED, signatureHash + certificatePageCount committed, file
    // uploaded). If notification email fails — typically SMTP misconfig or
    // network reachability — we log it but DO NOT rethrow. Throwing here
    // would cause the local jobs runner to retry the entire seal up to 3
    // times, re-rendering Chromium and re-uploading the PDF on each pass.
    try {
      await sendCompletedEmail({ documentId, requestMetadata });
    } catch (err) {
      console.error(
        '[seal-document] sendCompletedEmail failed (non-fatal — document is already sealed):',
        err,
      );
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
    userId: document.userId,
    teamId: document.teamId ?? undefined,
  });

  // Move any open Signature Inbox view watching this document.
  await publishInboxEventForDocument(document.id);

  // Auto-file completed documents into DMS (if enabled)
  if (!isRejected && !isResealing) {
    try {
      const autoFilingSettings = await prisma.dmsAutoFilingSettings.findUnique({
        where: { userId: document.userId },
      });

      if (autoFilingSettings?.enabled) {
        const existing = await prisma.dmsDocument.findUnique({
          where: { signedDocumentId: document.id },
        });

        if (!existing) {
          await prisma.dmsDocument.create({
            data: {
              title: document.title,
              referenceNumber: `DMS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`,
              fileUrl: documentData.id,
              fileName: `${document.title}.pdf`,
              fileType: 'application/pdf',
              fileSize: 0,
              status: 'ACTIVE',
              format: 'DIGITAL',
              confidentiality: autoFilingSettings.confidentiality,
              binId: autoFilingSettings.binId,
              documentTypeId: autoFilingSettings.documentTypeId,
              classificationId: autoFilingSettings.classificationId,
              signedDocumentId: document.id,
              uploadedById: document.userId,
              teamId: document.teamId,
            },
          });
        }
      }
    } catch (err) {
      // Don't fail the seal if auto-filing fails
      console.error('[DMS Auto-Filing Error]', err);
    }
  }
};
