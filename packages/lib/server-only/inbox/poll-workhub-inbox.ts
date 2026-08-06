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
import { resolveInboxOwnerUserId } from './resolve-inbox-owner';
import type { WorkHubInboxConfig } from './workhub-inbox-client';
import {
  isWorkHubInboxConfigured,
  resolveMailboxId,
  unwrapSerializedAttachment,
  workhubFetchAttachment,
  workhubListAttachments,
  workhubListInbox,
  workhubMarkRead,
} from './workhub-inbox-client';

export type PollResult = { scanned: number; imported: number; skipped: number; configured: boolean };

const base64ToArrayBuffer = (b64: string): ArrayBuffer => {
  // WorkHub may wrap attachment bytes in a Java-serialized byte[] — unwrap to the
  // real file before storing, otherwise the leading header corrupts the PDF.
  const buf = unwrapSerializedAttachment(Buffer.from(b64, 'base64'));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

type OrgInbox = {
  id: number;
  inboxEmail: string | null;
  workhubApiKey: string | null;
  workhubUsername: string | null;
  workhubPassword: string | null;
  workhubMailboxId: string | null;
  workhubApiBase: string | null;
};

const configFor = (org: OrgInbox): WorkHubInboxConfig => ({
  apiBase: org.workhubApiBase,
  apiKey: org.workhubApiKey,
  username: org.workhubUsername,
  password: org.workhubPassword,
  mailboxId: org.workhubMailboxId,
});

/** Poll a single organization's WorkHub inbox. */
export const pollOrgInbox = async (org: OrgInbox): Promise<PollResult> => {
  const base = configFor(org);
  // Surface the common misconfiguration loudly: BulkSender username/password is a
  // send-only (HTTP Basic) credential that the inbox API rejects. If that's all the
  // org set, tell them exactly what to fix instead of silently reporting "not
  // configured" (which reads as "I never set anything up").
  if (!base.apiKey && (base.username || base.password)) {
    throw new Error(
      'WorkHub inbox is set up with BulkSender username/password only, which the ' +
        'inbox API rejects (HTTP Basic is send-only). Add a WorkHub API key with ' +
        'email.read permission in Org Settings → WorkHub inbox connection.',
    );
  }
  if (!isWorkHubInboxConfigured(base)) {
    return { scanned: 0, imported: 0, skipped: 0, configured: false };
  }

  // Resolve the mailbox UUID from the inbox email (API-key callers must pass a
  // UUID; users only enter the email). Falls back to the credential's mailbox.
  const mailboxId = await resolveMailboxId(base, org.inboxEmail);
  if ((base.apiKey || org.workhubMailboxId) && !mailboxId) {
    throw new Error(
      `Could not resolve a WorkHub mailbox for "${org.inboxEmail ?? org.workhubMailboxId}". ` +
        `Check the inbox email matches a mailbox the API key can access.`,
    );
  }
  const config: WorkHubInboxConfig = { ...base, mailboxId };

  // Persist the resolved UUID so every future call short-circuits `resolveMailboxId`'s
  // own UUID check (workhub-inbox-client.ts) instead of hitting `GET /email/mailboxes`
  // again — that endpoint was the direct cause of a quota_exceeded incident when this
  // ran on a 20s poll; still worth avoiding on every manual fetch too.
  if (mailboxId && org.workhubMailboxId !== mailboxId) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { workhubMailboxId: mailboxId },
    });
  }

  // The org owns this mailbox, so trust what lands in it. Every document it
  // produces is owned by ONE account — the org's inbox owner — regardless of who
  // emailed it; external senders are expected on a shared mailbox anyway.
  const inboxOwnerUserId = await resolveInboxOwnerUserId(org.id);
  const defaultOwner = inboxOwnerUserId ? { userId: inboxOwnerUserId } : null;

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

      // LEGACY GUARD — do not remove.
      //
      // Items imported before multi-attachment support stored the BARE message
      // id. New items store `${messageId}:${attachmentId}`. Without this check
      // every previously-imported email would look unseen under the new scheme
      // and be re-imported as a duplicate on the next poll.
      //
      // It also preserves the original saving: the first import already called
      // mark-read, so re-encountering the message costs no further API quota.
      const existing = await prisma.signatureInboxItem.findFirst({
        where: { externalMessageId: msg.id, organizationId: org.id },
        select: { id: true },
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      // The sender is recorded for attribution, but does NOT own the document.
      // The inbox is a shared org queue while document access is owner-scoped,
      // so attributing ownership to the sender hid the document from whoever was
      // operating the inbox — see `resolveInboxOwnerUserId`.
      const member = msg.from
        ? await prisma.organizationMember.findFirst({
            where: {
              organizationId: org.id,
              user: { email: { equals: msg.from, mode: 'insensitive' } },
            },
            select: { userId: true },
          })
        : null;

      const ownerUserId = defaultOwner?.userId;
      if (!ownerUserId) {
        skipped += 1;
        continue;
      }

      // Who it came from, kept separate from who owns it.
      const receivedById = member?.userId ?? ownerUserId;

      const attachments = await workhubListAttachments(config, msg.id);

      // EVERY PDF becomes its own document. One email routinely carries several
      // unrelated invoices, potentially for different vendors, so they cannot be
      // merged — each needs its own OCR pass, queue row and workflow run. This
      // previously took `.find()`, imported the first PDF and discarded the rest
      // without a trace while still reporting success.
      const pdfs = attachments.filter(
        (a) =>
          !a.isInline &&
          (a.contentType === 'application/pdf' || a.name.toLowerCase().endsWith('.pdf')),
      );

      const nonPdfCount = attachments.filter((a) => !a.isInline).length - pdfs.length;

      if (nonPdfCount > 0) {
        // Still not handled — but say so, rather than dropping them in silence.
        console.warn(
          `[workhub-poll] message ${msg.id}: ignoring ${nonPdfCount} non-PDF attachment(s)`,
        );
      }

      if (pdfs.length === 0) {
        skipped += 1;
        continue;
      }

      let importedFromMessage = 0;

      for (const pdf of pdfs) {
        // Dedup is per ATTACHMENT, not per message. A message-level key meant a
        // run that died halfway through a multi-attachment email would find the
        // message "already imported" on retry and abandon the remainder.
        const externalMessageId = `${msg.id}:${pdf.id}`;

        const alreadyImported = await prisma.signatureInboxItem.findFirst({
          where: { externalMessageId, organizationId: org.id },
          select: { id: true },
        });

        if (alreadyImported) {
          continue;
        }

        const fetched = await workhubFetchAttachment(config, msg.id, pdf.id);
        if (!fetched) {
          console.error(`[workhub-poll] could not fetch attachment ${pdf.id} of ${msg.id}`);
          continue;
        }

        const arrayBuffer = base64ToArrayBuffer(fetched.contentBase64);
        const documentData = await putPdfFileServerSide({
          name: pdf.name,
          type: 'application/pdf',
          arrayBuffer: async () => arrayBuffer,
        });

        // With several documents from one email, the subject alone no longer
        // identifies them — qualify with the file name so the queue is readable.
        const title =
          pdfs.length > 1 && msg.subject ? `${msg.subject} — ${pdf.name}` : msg.subject || pdf.name;

        const document = await prisma.document.create({
          data: {
            title,
            qrToken: prefixedId('qr'),
            documentDataId: documentData.id,
            userId: ownerUserId,
            // The polling org is already known here, so use it directly rather
            // than re-deriving it from the owner's memberships.
            organizationId: org.id,
            source: DocumentSource.DOCUMENT,
            documentMeta: { create: { subject: msg.subject || undefined } },
          },
        });

        await createInboxItem({
          organizationId: org.id,
          documentId: document.id,
          senderEmail: msg.from,
          subject: msg.subject,
          receivedById,
          externalMessageId,
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
        }).catch((err) =>
          console.error('[workhub-poll] INBOX_EMAIL_RECEIVED dispatch failed:', err),
        );

        importedFromMessage += 1;
        imported += 1;
      }

      if (importedFromMessage === 0) {
        skipped += 1;
        continue;
      }

      // Only once every attachment landed — marking read after a partial import
      // would hide the message from the next poll with documents still missing.
      await workhubMarkRead(config, msg.id).catch((err) =>
        console.error('[workhub-poll] mark-read failed:', err),
      );
    } catch (err) {
      console.error('[workhub-poll] failed to import message:', err);
      skipped += 1;
    }
  }

  return { scanned: messages.length, imported, skipped, configured: true };
};

const ORG_SELECT = {
  id: true,
  inboxEmail: true,
  workhubApiKey: true,
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
      OR: [
        { workhubApiKey: { not: null } },
        { AND: [{ workhubUsername: { not: null } }, { workhubPassword: { not: null } }] },
      ],
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
