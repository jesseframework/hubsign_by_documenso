import { DocumentStatus, ReadStatus, RecipientRole, SendStatus, SigningStatus } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { AppError, AppErrorCode } from '../../errors/app-error';
import { jobs } from '../../jobs/client';
import { DOCUMENT_AUDIT_LOG_TYPE } from '../../types/document-audit-logs';
import type { RequestMetadata } from '../../universal/extract-request-metadata';
import { nanoid } from '../../universal/id';
import { createDocumentAuditLogData, diffRecipientChanges } from '../../utils/document-audit-logs';

/**
 * Hand a signing request to a different person.
 *
 * The everyday case this exists for: an invoice was sent to the wrong signer, or
 * the right signer has left, is on leave, or has told you to send it to their
 * manager. Until now the only way to fix that was the admin screen's recipient
 * editor, which changes the row's name and email and nothing else — and that is
 * not a reassignment, it is a relabelling. Three things go wrong if you stop
 * there:
 *
 *   1. **The old signing link keeps working.** A recipient's token is what
 *      authorises signing; leave it alone and the person you just removed can
 *      still open the document and sign it, now under someone else's name in the
 *      audit trail. So the token is rotated, which invalidates their link.
 *   2. **What the previous signer filled in stays behind.** A half-completed
 *      document would carry their typed values, and their signature image, into
 *      a document the new signer is about to complete. Those are cleared.
 *   3. **Nobody tells the new signer.** They are emailed the signing request
 *      here, the same way any signer is.
 *
 * Reassignment is deliberately *not* re-gated through the DOCUMENT_SEND business
 * rules. Those rules judge the document (a duplicate invoice, a missing PO), not
 * who is holding it, and re-running them here would mean that a rule added after
 * a document was legitimately sent leaves it permanently stuck with the wrong
 * signer and no way to correct it.
 */

export type ReassignRecipientOptions = {
  documentId: number;
  recipientId: number;
  /** Who it should go to instead. */
  email: string;
  name?: string;
  /** The user performing the reassignment — recorded in the audit log. */
  actorUserId: number;
  requestMetadata?: RequestMetadata;
};

export type ReassignRecipientResult = {
  recipient: { id: number; email: string; name: string };
  previous: { email: string; name: string };
  /**
   * Whether the new signer was emailed now. False for a draft (nothing has been
   * sent yet) and under sequential signing when it is not their turn — in that
   * case the existing sequencing emails them when it becomes their turn.
   */
  emailed: boolean;
  /** Values the previous signer had entered that were discarded. */
  clearedFields: number;
};

export const reassignRecipient = async ({
  documentId,
  recipientId,
  email: rawEmail,
  name,
  actorUserId,
  requestMetadata,
}: ReassignRecipientOptions): Promise<ReassignRecipientResult> => {
  const email = rawEmail.trim().toLowerCase();

  const recipient = await prisma.recipient.findFirst({
    where: { id: recipientId, documentId },
    include: {
      document: {
        select: {
          id: true,
          userId: true,
          status: true,
          documentMeta: { select: { signingOrder: true } },
          recipients: {
            select: { id: true, email: true, role: true, signingStatus: true },
            // The same ordering the send path uses, so "whose turn is it" is
            // answered identically here and there.
            orderBy: [{ signingOrder: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
          },
        },
      },
    },
  });

  if (!recipient?.document) {
    throw new AppError(AppErrorCode.NOT_FOUND, {
      message: 'That signer is not on this document.',
    });
  }

  const document = recipient.document;

  if (recipient.signingStatus === SigningStatus.SIGNED) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `${recipient.name || recipient.email} has already signed. A signature cannot be reassigned.`,
    });
  }

  if (document.status === DocumentStatus.COMPLETED) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'This document is already complete.',
    });
  }

  // A declined document is finished: its status stops the signing page for
  // everyone, so a reassignment would quietly produce a signer who cannot sign.
  if (document.status === DocumentStatus.REJECTED) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: 'This document was declined and can no longer be signed. Send it again instead.',
    });
  }

  if (email === recipient.email.toLowerCase()) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `${recipient.email} is already the assigned signer.`,
    });
  }

  // `Recipient` is unique on (documentId, email), so this would fail at the
  // database anyway — caught here to say why in words rather than as a
  // constraint violation.
  if (document.recipients.some((other) => other.email.toLowerCase() === email)) {
    throw new AppError(AppErrorCode.INVALID_REQUEST, {
      message: `${email} is already a signer on this document.`,
    });
  }

  const previous = { email: recipient.email, name: recipient.name };

  const clearedFields = await prisma.field.count({
    where: { recipientId: recipient.id, inserted: true },
  });

  const updated = await prisma.$transaction(async (tx) => {
    // Everything the previous signer put on the document, removed — scoped to
    // this one recipient by id. Their signature image cannot be allowed to
    // remain attached to a document another person is about to complete.
    await tx.signature.deleteMany({ where: { recipientId: recipient.id } });
    await tx.fieldSignedPosition.deleteMany({ where: { recipientId: recipient.id } });

    await tx.field.updateMany({
      where: { recipientId: recipient.id, documentId: document.id },
      data: { inserted: false, customText: '' },
    });

    const persisted = await tx.recipient.update({
      where: { id: recipient.id },
      data: {
        email,
        // An empty name is what the schema defaults to, and the signing page
        // falls back to the address — better than carrying the old person's name.
        name: name?.trim() ?? '',
        // The security-critical line. A recipient's token *is* their authority to
        // sign, so the previous signer's link has to stop working.
        token: nanoid(),
        readStatus: ReadStatus.NOT_OPENED,
        signingStatus: SigningStatus.NOT_SIGNED,
        // Reset even when we email immediately: the job sets it back to SENT, and
        // under sequential order this is what lets the sequencing pick them up.
        sendStatus: SendStatus.NOT_SENT,
        signedAt: null,
        rejectionReason: null,
        expired: null,
        // The new signer has not been chased. Carrying the counter over would
        // spend their reminder budget on nudges that went to somebody else.
        remindersSent: 0,
        lastReminderAt: null,
      },
    });

    // Recorded as a recipient change rather than a new audit type so it appears
    // on the existing certificate and diff rendering, with both addresses in it.
    await tx.documentAuditLog.create({
      data: createDocumentAuditLogData({
        type: DOCUMENT_AUDIT_LOG_TYPE.RECIPIENT_UPDATED,
        documentId: document.id,
        user: await tx.user.findUnique({
          where: { id: actorUserId },
          select: { id: true, name: true, email: true },
        }),
        requestMetadata,
        data: {
          changes: diffRecipientChanges(recipient, persisted),
          recipientId: persisted.id,
          recipientEmail: persisted.email,
          recipientName: persisted.name,
          recipientRole: persisted.role,
        },
      }),
    });

    return persisted;
  });

  // Whose turn it is, under the document's own signing order. Sending to a
  // sequential signer out of turn would put the document in front of somebody
  // who is not yet supposed to see it.
  const signingOrder = document.documentMeta?.signingOrder ?? 'PARALLEL';
  const isTheirTurn =
    signingOrder !== 'SEQUENTIAL' ||
    document.recipients
      .filter((r) => r.signingStatus === SigningStatus.NOT_SIGNED && r.role !== RecipientRole.CC)
      .at(0)?.id === recipient.id;

  const emailed =
    document.status === DocumentStatus.PENDING && recipient.role !== RecipientRole.CC && isTheirTurn;

  if (emailed) {
    // The same job the first send uses, so the new signer gets the ordinary
    // invite email, the push notification, and the EMAIL_SENT audit entry that
    // puts "signing request emailed to …" on the timeline.
    await jobs.triggerJob({
      name: 'send.signing.requested.email',
      payload: {
        // As the document owner, matching how the inbox sends: the queue is
        // shared, and the owner is who the email is from.
        userId: document.userId,
        documentId: document.id,
        recipientId: updated.id,
        requestMetadata,
      },
    });
  }

  return {
    recipient: { id: updated.id, email: updated.email, name: updated.name },
    previous,
    emailed,
    clearedFields,
  };
};
