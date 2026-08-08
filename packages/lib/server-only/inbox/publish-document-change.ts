/**
 * One-way bridge from a document's lifecycle back to the Signature Inbox.
 *
 * The inbox queue renders `SignatureInboxItem.status`, not the document's — so a
 * signature completing has to move the item's own column. This used to publish a
 * realtime event and nothing else: it re-read the item's existing status and
 * broadcast that, so a fully-signed invoice sat on `SENT_FOR_SIGNATURE`
 * indefinitely while the E-Sign list showed it Completed. The event was correct
 * and the data behind it was stale.
 *
 * Best-effort by design — a realtime nicety, and now a status write, must never
 * fail a signature.
 */

import type { DocumentStatus, InboxItemStatus } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { publishInboxEvent } from './inbox-events';

/**
 * Document outcome → inbox status.
 *
 * Only terminal outcomes map. DRAFT and PENDING are deliberately absent: the
 * inbox tracks its own earlier lifecycle there (RECEIVED → OCR_* → READY →
 * SENT_FOR_SIGNATURE) and mapping PENDING back would overwrite that with
 * something less specific.
 */
const TERMINAL_STATUS: Partial<Record<DocumentStatus, InboxItemStatus>> = {
  COMPLETED: 'COMPLETED',
  REJECTED: 'REJECTED',
};

export const publishInboxEventForDocument = async (documentId: number): Promise<void> => {
  try {
    const item = await prisma.signatureInboxItem.findUnique({
      where: { documentId },
      select: {
        id: true,
        organizationId: true,
        status: true,
        document: { select: { status: true } },
      },
    });

    // Not an inbox-sourced document — the overwhelmingly common case.
    if (!item) {
      return;
    }

    const target = TERMINAL_STATUS[item.document.status];
    let status = item.status;

    // ARCHIVED is a user's explicit filing decision and outranks an automatic
    // lifecycle update, so it is never overwritten.
    if (target && item.status !== target && item.status !== 'ARCHIVED') {
      const updated = await prisma.signatureInboxItem.update({
        where: { id: item.id },
        data: { status: target },
        select: { status: true },
      });

      status = updated.status;
    }

    // Published after the write so subscribers refetch the new value, not the old.
    publishInboxEvent(item.organizationId, {
      type: 'update',
      inboxItemId: item.id,
      status,
    });
  } catch (err) {
    console.error('[inbox-events] document change publish failed:', err);
  }
};
