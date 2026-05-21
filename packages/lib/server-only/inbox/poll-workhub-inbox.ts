/**
 * Polls each organization's WorkHub inbox for new signing emails and feeds them
 * into the signature pipeline. Per-org by design: each org configures its own
 * WorkHub BulkSender credential (Org Settings), so polling reads that org's own
 * mailbox — every message there belongs to that org.
 *
 * Per message: anti-spoof match the sender to an org member, download the first
 * PDF, store it, create a DRAFT document + inbox item (kicks off OCR), fire
 * INBOX_EMAIL_RECEIVED, mark read. Idempotent via SignatureInboxItem.externalMessageId.
 *
 * Driven by /api/cron/inbox-poll (all orgs) and the in-app "Fetch now" (one org).
 */

import { DocumentSource } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { prefixedId } from '../../universal/id';
import { putPdfFileServerSide } from '../../universal/upload/put-file.server';
import { triggerWorkflows } from '../workflow/trigger-workflows';
import { createInboxItem } from './create-inbox-item';
import type { WorkHubInboxConfig } from './workhub-inbox-client';
import {
  isWorkHubInboxConfigured,
  workhubFetchAttachment,
  workhubListAttachments,
  workhubListInbox,
  workhubMarkRead,
} from './workhub-inbox-client';

export type PollResult = { scanned: number; imported: number; skipped: number; configured: boolean };

const base64ToArrayBuffer = (b64: string): ArrayBuffer => {
  const buf = Buffer.from(b64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

type OrgInbox = {
  id: number;
  workhubUsername: string | null;
  workhubPassword: string | null;
  workhubMailboxId: string | null;
  workhubApiBase: string | null;
};

const configFor = (org: OrgInbox): WorkHubInboxConfig => ({
  apiBase: org.workhubApiBase,
  username: org.workhubUsername,
  password: org.workhubPassword,
  mailboxId: org.workhubMailboxId,
});

/** Poll a single organization's WorkHub inbox. */
export const pollOrgInbox = async (org: OrgInbox): Promise<PollResult> => {
  const config = configFor(org);
  if (!isWorkHubInboxConfigured(config)) {
    return { scanned: 0, imported: 0, skipped: 0, configured: false };
  }

  const messages = await workhubListInbox(config, {
    isRead: false,
    hasAttachments: true,
    maxResults: 50,
  });

  let imported = 0;
  let skipped = 0;

  for (const msg of messages) {
    try {
      if (!msg.id) {
        skipped += 1;
        continue;
      }

      const existing = await prisma.signatureInboxItem.findFirst({
        where: { externalMessageId: msg.id, organizationId: org.id },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        await workhubMarkRead(config, msg.id).catch(() => null);
        continue;
      }

      // Anti-spoofing: the sender must be a member of this org.
      const member = await prisma.organizationMember.findFirst({
        where: {
          organizationId: org.id,
          user: { email: { equals: msg.from, mode: 'insensitive' } },
        },
        select: { userId: true },
      });
      if (!member) {
        skipped += 1;
        continue;
      }

      const attachments = await workhubListAttachments(config, msg.id);
      const pdf = attachments.find(
        (a) =>
          !a.isInline &&
          (a.contentType === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf')),
      );
      if (!pdf) {
        skipped += 1;
        continue;
      }

      const fetched = await workhubFetchAttachment(config, msg.id, pdf.id);
      if (!fetched) {
        skipped += 1;
        continue;
      }

      const arrayBuffer = base64ToArrayBuffer(fetched.contentBase64);
      const documentData = await putPdfFileServerSide({
        name: pdf.name,
        type: 'application/pdf',
        arrayBuffer: async () => arrayBuffer,
      });

      const document = await prisma.document.create({
        data: {
          title: msg.subject || pdf.name,
          qrToken: prefixedId('qr'),
          documentDataId: documentData.id,
          userId: member.userId,
          source: DocumentSource.DOCUMENT,
          documentMeta: { create: { subject: msg.subject || undefined } },
        },
      });

      await createInboxItem({
        organizationId: org.id,
        documentId: document.id,
        senderEmail: msg.from,
        subject: msg.subject,
        receivedById: member.userId,
        externalMessageId: msg.id,
      });

      await triggerWorkflows({
        event: 'INBOX_EMAIL_RECEIVED',
        organizationId: org.id,
        data: {
          documentId: document.id,
          title: document.title,
          sender: msg.from,
          subject: msg.subject,
        },
      }).catch((err) => console.error('[workhub-poll] INBOX_EMAIL_RECEIVED dispatch failed:', err));

      await workhubMarkRead(config, msg.id).catch((err) =>
        console.error('[workhub-poll] mark-read failed:', err),
      );
      imported += 1;
    } catch (err) {
      console.error('[workhub-poll] failed to import message:', err);
      skipped += 1;
    }
  }

  return { scanned: messages.length, imported, skipped, configured: true };
};

const ORG_SELECT = {
  id: true,
  workhubUsername: true,
  workhubPassword: true,
  workhubMailboxId: true,
  workhubApiBase: true,
} as const;

/** Poll one organization by id (used by the in-app "Fetch now"). */
export const pollWorkHubInboxForOrg = async (organizationId: number): Promise<PollResult> => {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { ...ORG_SELECT, emailToSignEnabled: true },
  });
  if (!org || !org.emailToSignEnabled) {
    return { scanned: 0, imported: 0, skipped: 0, configured: false };
  }
  return pollOrgInbox(org);
};

/** Poll every org with email-to-sign enabled and a WorkHub credential (cron). */
export const pollAllOrgInboxes = async (): Promise<PollResult> => {
  const orgs = await prisma.organization.findMany({
    where: {
      emailToSignEnabled: true,
      workhubUsername: { not: null },
      workhubPassword: { not: null },
    },
    select: ORG_SELECT,
  });

  const totals: PollResult = { scanned: 0, imported: 0, skipped: 0, configured: orgs.length > 0 };
  for (const org of orgs) {
    try {
      const r = await pollOrgInbox(org);
      totals.scanned += r.scanned;
      totals.imported += r.imported;
      totals.skipped += r.skipped;
    } catch (err) {
      console.error(`[workhub-poll] org ${org.id} poll failed:`, err);
    }
  }
  return totals;
};
