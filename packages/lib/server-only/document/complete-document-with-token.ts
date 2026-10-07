import {
  DocumentSigningOrder,
  DocumentStatus,
  RecipientRole,
  SendStatus,
  SigningStatus,
  WebhookTriggerEvents,
} from '@prisma/client';

import {
  DOCUMENT_AUDIT_LOG_TYPE,
  RECIPIENT_DIFF_TYPE,
} from '@documenso/lib/types/document-audit-logs';
import type { RequestMetadata } from '@documenso/lib/universal/extract-request-metadata';
import { fieldsContainUnsignedRequiredField } from '@documenso/lib/utils/advanced-fields-helpers';
import { createDocumentAuditLogData } from '@documenso/lib/utils/document-audit-logs';
import { prisma } from '@documenso/prisma';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { jobs } from '../../jobs/client';
import type { TRecipientActionAuth } from '../../types/document-auth';
import {
  ZWebhookDocumentSchema,
  mapDocumentToWebhookDocumentPayload,
} from '../../types/webhook-payload';
import { publishInboxEventForDocument } from '../inbox/publish-document-change';
import { getIsRecipientsTurnToSign } from '../recipient/get-is-recipient-turn';
import { triggerWebhook } from '../webhooks/trigger/trigger-webhook';
import { sendPendingEmail } from './send-pending-email';

export type CompleteDocumentWithTokenResponse = {
  /**
   * False when a notification email could not be handed to the mail provider.
   *
   * The signature is recorded either way — this exists so the UI can show a
   * warning *beside* the confirmation rather than an error *instead* of it. The
   * provider's own message is deliberately not returned: it is infrastructure
   * detail ("WorkHub BulkSender error [http_502]") that means nothing to an
   * external signer, and it goes to the server log instead.
   */
  emailDelivered: boolean;
};

export type CompleteDocumentWithTokenOptions = {
  token: string;
  documentId: number;
  userId?: number;
  authOptions?: TRecipientActionAuth;
  requestMetadata?: RequestMetadata;
  nextSigner?: {
    email: string;
    name: string;
  };
};

const getDocument = async ({ token, documentId }: CompleteDocumentWithTokenOptions) => {
  return await prisma.document.findFirstOrThrow({
    where: {
      id: documentId,
      recipients: {
        some: {
          token,
        },
      },
    },
    include: {
      documentMeta: true,
      recipients: {
        where: {
          token,
        },
      },
    },
  });
};

export const completeDocumentWithToken = async ({
  token,
  documentId,
  requestMetadata,
  nextSigner,
  // Present when a signed-in user is signing; absent for token-only signers.
  // Feeds the rule context's `actor.*` namespace.
  userId,
}: CompleteDocumentWithTokenOptions): Promise<CompleteDocumentWithTokenResponse> => {
  const document = await getDocument({ token, documentId });

  if (document.status !== DocumentStatus.PENDING) {
    throw new Error(`Document ${document.id} must be pending`);
  }

  if (document.recipients.length === 0) {
    throw new Error(`Document ${document.id} has no recipient with token ${token}`);
  }

  const [recipient] = document.recipients;

  if (recipient.signingStatus === SigningStatus.SIGNED) {
    throw new Error(`Recipient ${recipient.id} has already signed`);
  }

  if (recipient.signingStatus === SigningStatus.REJECTED) {
    throw new AppError(AppErrorCode.UNKNOWN_ERROR, {
      message: 'Recipient has already rejected the document',
      statusCode: 400,
    });
  }

  if (document.documentMeta?.signingOrder === DocumentSigningOrder.SEQUENTIAL) {
    const isRecipientsTurn = await getIsRecipientsTurnToSign({ token: recipient.token });

    if (!isRecipientsTurn) {
      throw new Error(
        `Recipient ${recipient.id} attempted to complete the document before it was their turn`,
      );
    }
  }

  const fields = await prisma.field.findMany({
    where: {
      documentId: document.id,
      recipientId: recipient.id,
    },
  });

  if (fieldsContainUnsignedRequiredField(fields)) {
    throw new Error(`Recipient ${recipient.id} has unsigned fields`);
  }

  // DOCUMENT_SIGN gate — org-authored business rules, e.g. "an invoice over
  // 300,000 can't be signed without a PO number".
  //
  // Placed after the structural checks (turn order, required fields) and before
  // anything is written, so a refusal leaves no partial state. Only runs for
  // documents that belong to an organization; a personal document has no rules
  // to apply. Fails open by design — see `evaluateGate`.
  if (document.organizationId) {
    const { evaluateGate, describeBlocks } = await import('../rules/evaluate-gate');

    const verdict = await evaluateGate({
      gate: 'DOCUMENT_SIGN',
      subject: {
        organizationId: document.organizationId,
        entityType: 'Document',
        entityId: String(document.id),
        actorUserId: userId ?? null,
        recipientId: recipient.id,
      },
    });

    if (!verdict.allowed) {
      const reason = describeBlocks(verdict);

      // INVALID_REQUEST, not UNKNOWN_ERROR: this is a deliberate policy refusal,
      // so it maps to a 400 rather than being reported as a server fault.
      //
      // The authored text goes in `userMessage` as well as `message`. `message`
      // is defined as internal-for-logging and some transports mask it, whereas
      // `userMessage` is the field meant to be shown — and a block the signer
      // can't read tells them nothing about what to fix. These strings are
      // written by the signer's own organization, so they are safe to display.
      throw new AppError(AppErrorCode.INVALID_REQUEST, {
        message: reason,
        userMessage: reason,
        statusCode: 400,
      });
    }
  }

  // Document reauth for completing documents is currently not required.

  // const { derivedRecipientActionAuth } = extractDocumentAuthMethods({
  //   documentAuth: document.authOptions,
  //   recipientAuth: recipient.authOptions,
  // });

  // const isValid = await isRecipientAuthorized({
  //   type: 'ACTION',
  //   document: document,
  //   recipient: recipient,
  //   userId,
  //   authOptions,
  // });

  // if (!isValid) {
  //   throw new AppError(AppErrorCode.UNAUTHORIZED, 'Invalid authentication values');
  // }

  await prisma.$transaction(async (tx) => {
    await tx.recipient.update({
      where: {
        id: recipient.id,
      },
      data: {
        signingStatus: SigningStatus.SIGNED,
        signedAt: new Date(),
      },
    });

    await tx.documentAuditLog.create({
      data: createDocumentAuditLogData({
        type: DOCUMENT_AUDIT_LOG_TYPE.DOCUMENT_RECIPIENT_COMPLETED,
        documentId: document.id,
        user: {
          name: recipient.name,
          email: recipient.email,
        },
        requestMetadata,
        data: {
          recipientEmail: recipient.email,
          recipientName: recipient.name,
          recipientId: recipient.id,
          recipientRole: recipient.role,
        },
      }),
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The signature is committed. Everything below is a consequence of it, and
  // nothing below may throw.
  //
  // A failure here used to reject the whole mutation, so the signer was told
  // "the document was not completed" about a document that had in fact just
  // been signed — and their retry was then refused with "Recipient N has
  // already signed", which reads as the system contradicting itself. The usual
  // trigger was a transient mail-provider fault (an HTTP 502 from the send
  // API): someone else's outage, reported to the signer as their failure to
  // sign, with no way forward.
  //
  // Delivery problems are collected and returned instead, so the caller can say
  // "signed — but we could not email you" rather than "it did not work".
  // ───────────────────────────────────────────────────────────────────────────

  let emailDelivered = true;

  /**
   * Runs one post-signature side effect. A failure is logged and, when the
   * signer would notice the absence of it, remembered — but never raised.
   */
  const sideEffect = async (
    label: string,
    run: () => Promise<unknown>,
    options?: { isEmail?: boolean },
  ): Promise<void> => {
    try {
      await run();
    } catch (err) {
      console.error(
        `[complete-document] ${label} failed for document ${document.id}. ` +
          'The signature is already recorded and stands.',
        err,
      );

      if (options?.isEmail) {
        emailDelivered = false;
      }
    }
  };

  await sideEffect(
    'recipient-signed email',
    async () =>
      jobs.triggerJob({
        name: 'send.recipient.signed.email',
        payload: {
          documentId: document.id,
          recipientId: recipient.id,
        },
      }),
    { isEmail: true },
  );

  const pendingRecipients = await prisma.recipient
    .findMany({
      select: {
        id: true,
        signingOrder: true,
        name: true,
        email: true,
        role: true,
      },
      where: {
        documentId: document.id,
        signingStatus: {
          not: SigningStatus.SIGNED,
        },
        role: {
          not: RecipientRole.CC,
        },
      },
      // Composite sort so our next recipient is always the one with the lowest signing order or id
      // if there is a tie.
      orderBy: [{ signingOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    })
    // Only used to decide who to notify next, so an unreadable list costs a
    // notification — not the signature.
    .catch((err) => {
      console.error(
        `[complete-document] could not load pending recipients for document ${document.id}.`,
        err,
      );

      emailDelivered = false;

      return [];
    });

  if (pendingRecipients.length > 0) {
    // This is the call that produced the original bug: a direct, unguarded
    // `mailer.sendMail` to the person who just signed.
    await sideEffect(
      'document-pending email',
      async () => sendPendingEmail({ documentId, recipientId: recipient.id }),
      { isEmail: true },
    );

    if (document.documentMeta?.signingOrder === DocumentSigningOrder.SEQUENTIAL) {
      const [nextRecipient] = pendingRecipients;

      await sideEffect(
        'next-signer handoff',
        async () =>
          prisma.$transaction(async (tx) => {
            if (nextSigner && document.documentMeta?.allowDictateNextSigner) {
              await tx.documentAuditLog.create({
                data: createDocumentAuditLogData({
                  type: DOCUMENT_AUDIT_LOG_TYPE.RECIPIENT_UPDATED,
                  documentId: document.id,
                  user: {
                    name: recipient.name,
                    email: recipient.email,
                  },
                  requestMetadata,
                  data: {
                    recipientEmail: nextRecipient.email,
                    recipientName: nextRecipient.name,
                    recipientId: nextRecipient.id,
                    recipientRole: nextRecipient.role,
                    changes: [
                      {
                        type: RECIPIENT_DIFF_TYPE.NAME,
                        from: nextRecipient.name,
                        to: nextSigner.name,
                      },
                      {
                        type: RECIPIENT_DIFF_TYPE.EMAIL,
                        from: nextRecipient.email,
                        to: nextSigner.email,
                      },
                    ],
                  },
                }),
              });
            }

            await tx.recipient.update({
              where: { id: nextRecipient.id },
              data: {
                sendStatus: SendStatus.SENT,
                ...(nextSigner && document.documentMeta?.allowDictateNextSigner
                  ? {
                      name: nextSigner.name,
                      email: nextSigner.email,
                    }
                  : {}),
              },
            });

            await jobs.triggerJob({
              name: 'send.signing.requested.email',
              payload: {
                userId: document.userId,
                documentId: document.id,
                recipientId: nextRecipient.id,
                requestMetadata,
              },
            });
          }),
        { isEmail: true },
      );
    }
  }

  const haveAllRecipientsSigned = await prisma.document
    .findFirst({
      where: {
        id: document.id,
        recipients: {
          every: {
            OR: [{ signingStatus: SigningStatus.SIGNED }, { role: RecipientRole.CC }],
          },
        },
      },
    })
    .catch((err) => {
      console.error(
        `[complete-document] could not check completion state for document ${document.id}.`,
        err,
      );

      return null;
    });

  if (haveAllRecipientsSigned) {
    await sideEffect('seal-document job', async () =>
      jobs.triggerJob({
        name: 'internal.seal-document',
        payload: {
          documentId: document.id,
          requestMetadata,
        },
      }),
    );
  }

  await sideEffect('document-signed webhook', async () => {
    const updatedDocument = await prisma.document.findFirstOrThrow({
      where: {
        id: document.id,
      },
      include: {
        documentMeta: true,
        recipients: true,
      },
    });

    await triggerWebhook({
      event: WebhookTriggerEvents.DOCUMENT_SIGNED,
      data: ZWebhookDocumentSchema.parse(mapDocumentToWebhookDocumentPayload(updatedDocument)),
      userId: updatedDocument.userId,
      teamId: updatedDocument.teamId ?? undefined,
    });
  });

  // Move any open Signature Inbox view watching this document.
  await sideEffect('inbox event publish', async () => publishInboxEventForDocument(document.id));

  return { emailDelivered };
};
