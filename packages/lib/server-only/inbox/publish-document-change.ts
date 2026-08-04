/**
 * One-way bridge from a document's lifecycle back to the Signature Inbox stream.
 *
 * The inbox queue renders the linked document's status, and the item detail
 * view renders each recipient's signing status — so both screens have to move
 * when someone signs. The signing code has no reason to know the inbox exists,
 * so this adapter carries the signal instead: given a document id, push an
 * event if (and only if) that document arrived through the inbox.
 *
 * Best-effort by design — a realtime nicety must never fail a signature.
 */

import { prisma } from '@documenso/prisma';

import { publishInboxEvent } from './inbox-events';

export const publishInboxEventForDocument = async (documentId: number): Promise<void> => {
  try {
    const item = await prisma.signatureInboxItem.findUnique({
      where: { documentId },
      select: { id: true, organizationId: true, status: true },
    });

    // Not an inbox-sourced document — the overwhelmingly common case.
    if (!item) {
      return;
    }

    publishInboxEvent(item.organizationId, {
      type: 'update',
      inboxItemId: item.id,
      status: item.status,
    });
  } catch (err) {
    console.error('[inbox-events] document change publish failed:', err);
  }
};
