/**
 * Create a signature-inbox queue entry for an inbound document and kick off OCR.
 */

import { prisma } from '@documenso/prisma';

import { jobs } from '../../jobs/client';
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

  return item.id;
};
