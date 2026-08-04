/**
 * Create a signature-inbox queue entry for an inbound document and kick off OCR.
 */

import { prisma } from '@documenso/prisma';

import { NEXT_PUBLIC_WEBAPP_URL } from '../../constants/app';
import { jobs } from '../../jobs/client';
import { sendFcmNotificationToUser } from '../push-notifications/fcm-client';
import { publishInboxEvent } from './inbox-events';

export const createInboxItem = async ({
  organizationId,
  documentId,
  senderEmail,
  subject,
  receivedById,
  externalMessageId,
}: {
  organizationId: number;
  documentId: number;
  senderEmail?: string | null;
  subject?: string | null;
  receivedById?: number | null;
  externalMessageId?: string | null;
}): Promise<string> => {
  const item = await prisma.signatureInboxItem.create({
    data: {
      organizationId,
      documentId,
      senderEmail: senderEmail ?? null,
      subject: subject ?? null,
      receivedById: receivedById ?? null,
      externalMessageId: externalMessageId ?? null,
      status: 'RECEIVED',
    },
  });

  await jobs.triggerJob({
    name: 'internal.process-inbox-ocr',
    payload: { inboxItemId: item.id },
  });

  // Notify any open inbox views that a new item arrived.
  publishInboxEvent(organizationId, { type: 'new', inboxItemId: item.id });

  // Best-effort push notification to every org member who wants one — this
  // reaches the user even when HubSign isn't open at all, unlike the SSE
  // event above. Mirrors the pattern in `send-completed-email.ts`: never
  // let a push failure block inbox ingestion.
  try {
    const members = await prisma.organizationMember.findMany({
      where: { organizationId },
      select: {
        userId: true,
        user: { select: { pushNotifPrefs: { select: { inboxItemReceived: true } } } },
      },
    });

    await Promise.all(
      members
        .filter((m) => m.user.pushNotifPrefs?.inboxItemReceived !== false)
        .map((m) =>
          sendFcmNotificationToUser(m.userId, {
            title: 'New document received',
            body: subject ?? 'A document was received via WorkHub.',
            link: `${NEXT_PUBLIC_WEBAPP_URL()}/org/inbox/${item.id}`,
            data: { inboxItemId: item.id },
          }),
        ),
    );
  } catch (err) {
    console.error('[create-inbox-item] push notification failed (non-fatal):', err);
  }

  return item.id;
};
