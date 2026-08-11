import { DocumentSource } from '@prisma/client';

import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { prisma } from '@documenso/prisma';
import { putPdfFileServerSide } from '@documenso/lib/universal/upload/put-file.server';
import { env } from '@documenso/lib/utils/env';
import { prefixedId } from '@documenso/lib/universal/id';

import type { Route } from './+types/inbound.email-to-sign';

/**
 * POST /api/inbound/email-to-sign
 *
 * Provider-agnostic inbound-email webhook. When an org has
 * `emailToSignEnabled=true`, configure your inbound provider (Mailgun /
 * Postmark / SES inbound) to forward emails sent to
 * `<org-slug>@<your-inbound-domain>` to this endpoint.
 *
 * The handler:
 *   1. Verifies the request via `Authorization: Bearer $NEXT_PRIVATE_INBOUND_EMAIL_SECRET`
 *      (set this on the webhook config as a custom header)
 *   2. Parses the multipart payload (or JSON, depending on provider) for:
 *      - To address (used to look up the org by slug — the local part)
 *      - From address (used to find the corresponding org member)
 *      - PDF attachment
 *   3. Creates a DRAFT Document owned by the matched org member
 *   4. Replies (via the mail provider's outbound) with a link to complete setup
 *
 * Currently scaffolded for the **Mailgun** "store and notify" / "Routes" payload
 * (multipart/form-data with `recipient`, `from`, `attachment-1`, etc.).
 * Adapt the field names if you use a different provider.
 */

type InboundPdf = { name: string; arrayBuffer: () => Promise<ArrayBuffer>; type: string };

type InboundProviderPayload = {
  to: string;
  from: string;
  subject?: string;
  /**
   * EVERY PDF on the email, in the order the provider sent them.
   *
   * One email routinely carries several unrelated invoices — potentially for
   * different vendors — so they cannot be merged into a single document. Each
   * needs its own OCR pass, queue row and workflow run. This used to be a
   * single `pdfFile`: the first attachment was imported and the rest were
   * discarded silently while the caller still received a 200.
   */
  pdfFiles: InboundPdf[];
  /** Attachments that were not PDFs, so the response can admit to skipping them. */
  ignoredAttachments: string[];
};

const isPdf = (name: string, mime: string) =>
  mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf');

const parseMailgunPayload = async (request: Request): Promise<InboundProviderPayload | null> => {
  const form = await request.formData();
  const to = String(form.get('recipient') ?? form.get('To') ?? '');
  const from = String(form.get('sender') ?? form.get('From') ?? '');
  const subject = String(form.get('subject') ?? form.get('Subject') ?? '');

  const pdfFiles: InboundPdf[] = [];
  const ignoredAttachments: string[] = [];

  for (const [key, value] of form.entries()) {
    if (!key.startsWith('attachment-') || !(value instanceof File)) {
      continue;
    }

    if (isPdf(value.name, value.type)) {
      pdfFiles.push({
        name: value.name,
        type: 'application/pdf',
        arrayBuffer: async () => value.arrayBuffer(),
      });
    } else {
      ignoredAttachments.push(value.name);
    }
  }

  if (pdfFiles.length === 0) {
    return null;
  }

  return { to, from, subject, pdfFiles, ignoredAttachments };
};

const base64ToArrayBuffer = (b64: string): ArrayBuffer => {
  const buf = Buffer.from(b64.replace(/^data:[^;]+;base64,/, ''), 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
};

/**
 * JSON inbound payload (e.g. WorkHub webhook). Mirrors WorkHub's BulkSender
 * attachment shape: `{ to, from, subject, attachments: [{ fileName,
 * contentBase64, mimeType }] }` and tolerates common field aliases.
 */
const parseJsonPayload = async (request: Request): Promise<InboundProviderPayload | null> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const body = (await request.json().catch(() => null)) as any;
  if (!body) return null;

  const to = String(body.to ?? body.recipient ?? body.To ?? '');
  const from = String(body.from ?? body.sender ?? body.From ?? '');
  const subject = String(body.subject ?? body.Subject ?? '');
  const attachments = body.attachments ?? body.Attachments ?? [];

  const pdfFiles: InboundPdf[] = [];
  const ignoredAttachments: string[] = [];

  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      const name = String(att.fileName ?? att.filename ?? att.name ?? 'attachment.pdf');
      const mime = String(att.mimeType ?? att.contentType ?? att.type ?? '');
      const b64 = att.contentBase64 ?? att.content ?? att.contentBytes ?? att.data;

      if (isPdf(name, mime) && typeof b64 === 'string') {
        const arrayBuffer = base64ToArrayBuffer(b64);
        pdfFiles.push({ name, type: 'application/pdf', arrayBuffer: async () => arrayBuffer });
      } else {
        ignoredAttachments.push(name);
      }
    }
  }

  if (pdfFiles.length === 0) {
    return null;
  }

  return { to, from, subject, pdfFiles, ignoredAttachments };
};

const parseInboundPayload = async (request: Request): Promise<InboundProviderPayload | null> => {
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return parseJsonPayload(request);
  }
  return parseMailgunPayload(request);
};

export const action = async ({ request }: Route.ActionArgs) => {
  const secret = env('NEXT_PRIVATE_INBOUND_EMAIL_SECRET');

  if (!secret) {
    return Response.json(
      { error: 'Inbound email endpoint disabled: NEXT_PRIVATE_INBOUND_EMAIL_SECRET is not set.' },
      { status: 503 },
    );
  }

  const auth = request.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await parseInboundPayload(request);
  if (!payload) {
    return Response.json({ error: 'No PDF attachment found in inbound email' }, { status: 400 });
  }

  // Extract the org slug from the To address local-part.
  // Format: `<slug>@<your-inbound-domain>`
  const localPart = payload.to.split('@')[0]?.toLowerCase();
  if (!localPart) {
    return Response.json({ error: 'Cannot determine org from To address' }, { status: 400 });
  }

  const org = await prisma.organization.findUnique({
    where: { slug: localPart },
    select: {
      id: true,
      slug: true,
      emailToSignEnabled: true,
      inboxEmail: true,
      inboxBlockedSenders: true,
      inboxBlockedSubjects: true,
    },
  });

  if (!org) {
    return Response.json({ error: `No org with slug "${localPart}"` }, { status: 404 });
  }

  if (!org.emailToSignEnabled) {
    return Response.json({ error: 'Email-to-sign is disabled for this organization' }, { status: 403 });
  }

  // Match the sender to an org member. Reject otherwise — anti-spoofing.
  const senderEmail = payload.from.match(/<([^>]+)>/)?.[1] ?? payload.from.trim();
  const member = await prisma.organizationMember.findFirst({
    where: {
      organizationId: org.id,
      user: { email: { equals: senderEmail, mode: 'insensitive' } },
    },
    include: { user: true },
  });

  if (!member) {
    return Response.json(
      { error: `Sender ${senderEmail} is not a member of this organization.` },
      { status: 403 },
    );
  }

  // Refuse mail the platform itself produced. A completed document is emailed to
  // every recipient WITH the signed PDF attached, so a document sent to this
  // org's own inbox address comes straight back here as a new "invoice" and
  // re-fires the workflow that produced it. 200 rather than an error: the
  // provider did nothing wrong and must not retry.
  const { shouldIngestInboundEmail } = await import(
    '@documenso/lib/server-only/inbox/should-ingest-email'
  );

  const decision = shouldIngestInboundEmail(
    { from: senderEmail, subject: payload.subject },
    {
      orgInboxEmail: org.inboxEmail,
      blockedSenders: org.inboxBlockedSenders,
      blockedSubjects: org.inboxBlockedSubjects,
    },
  );

  if (!decision.ingest) {
    console.log(`[email-to-sign] refused inbound email: ${decision.detail}`);

    return Response.json({
      ok: true,
      skipped: true,
      reason: decision.reason,
      message: `Email not ingested: ${decision.detail}`,
    });
  }

  // The sender must be a member (checked above, anti-spoofing) but does not own
  // the document: the inbox is a shared queue and document access is
  // owner-scoped, so sender-ownership hid inbound documents from whoever was
  // operating the inbox. See `resolveInboxOwnerUserId`.
  const { resolveInboxOwnerUserId } = await import(
    '@documenso/lib/server-only/inbox/resolve-inbox-owner'
  );

  const ownerUserId = (await resolveInboxOwnerUserId(member.organizationId)) ?? member.userId;

  const { createInboxItem } = await import('@documenso/lib/server-only/inbox/create-inbox-item');
  const { triggerWorkflows } = await import(
    '@documenso/lib/server-only/workflow/trigger-workflows'
  );
  const { startApprovalRequest } = await import(
    '@documenso/lib/server-only/approval/approval-execution'
  );

  const created: Array<{
    documentId: number;
    title: string;
    editUrl: string;
    inboxItemId?: string;
    approval: { requestId?: string; skipped?: string };
  }> = [];

  const failed: Array<{ name: string; error: string }> = [];

  // One document per attachment — they may be invoices for entirely different
  // vendors, so each gets its own OCR pass, queue row and workflow run.
  for (const pdf of payload.pdfFiles) {
    try {
      const documentData = await putPdfFileServerSide({
        name: pdf.name,
        type: 'application/pdf',
        arrayBuffer: pdf.arrayBuffer,
      });

      // With several documents from one email the subject alone no longer
      // identifies them, so qualify with the file name.
      const title =
        payload.pdfFiles.length > 1 && payload.subject
          ? `${payload.subject} — ${pdf.name}`
          : payload.subject || pdf.name;

      // A DRAFT document. No recipients yet — the sender (or anyone in the org)
      // finishes setup in the HubSign UI.
      const document = await prisma.document.create({
        data: {
          title,
          qrToken: prefixedId('qr'),
          documentDataId: documentData.id,
          userId: ownerUserId,
          // The receiving org is already resolved above; stamp it directly.
          organizationId: member.organizationId,
          source: DocumentSource.DOCUMENT,
          documentMeta: {
            create: { subject: payload.subject || undefined },
          },
        },
      });

      // Signature inbox: queue the document and kick off OCR (BMS ML). The OCR
      // job fires INBOX_OCR_COMPLETED when it finishes.
      let inboxItemId: string | undefined;
      try {
        inboxItemId = await createInboxItem({
          organizationId: member.organizationId,
          documentId: document.id,
          senderEmail,
          subject: payload.subject || null,
          receivedById: member.userId,
        });
      } catch (err) {
        console.error('[email-to-sign] inbox/OCR dispatch failed (non-fatal):', err);
      }

      // Pre-OCR "email received" workflow event, once per document.
      try {
        await triggerWorkflows({
          event: 'INBOX_EMAIL_RECEIVED',
          organizationId: member.organizationId,
          data: {
            documentId: document.id,
            title: document.title,
            sender: senderEmail,
            subject: payload.subject || null,
          },
        });
      } catch (err) {
        console.error('[email-to-sign] INBOX_EMAIL_RECEIVED dispatch failed (non-fatal):', err);
      }

      // Route through an approval chain if the org has one configured for
      // documents. Non-fatal: a missing template just skips.
      let approval: { requestId?: string; skipped?: string } = {};
      try {
        const result = await startApprovalRequest({
          organizationId: member.organizationId,
          entityType: 'Document',
          entityId: String(document.id),
          requesterUserId: member.userId,
        });
        approval =
          'skipped' in result ? { skipped: result.reason } : { requestId: result.requestId };
      } catch (err) {
        console.error('[email-to-sign] approval dispatch failed (non-fatal):', err);
      }

      created.push({
        documentId: document.id,
        title: document.title,
        editUrl: `${NEXT_PUBLIC_WEBAPP_URL()}/documents/${document.id}/edit`,
        inboxItemId,
        approval,
      });
    } catch (err) {
      // One bad attachment must not lose the others — record it and continue.
      const message = err instanceof Error ? err.message : 'Unknown error';
      console.error(`[email-to-sign] failed to import attachment "${pdf.name}":`, err);
      failed.push({ name: pdf.name, error: message });
    }
  }

  if (created.length === 0) {
    return Response.json(
      { ok: false, error: 'Every PDF attachment failed to import.', failed },
      { status: 500 },
    );
  }

  return Response.json({
    ok: true,
    documents: created,
    // Anything not imported is reported rather than dropped in silence — the
    // old handler returned a plain success while discarding extra attachments.
    failed,
    ignoredAttachments: payload.ignoredAttachments,
    // Kept so existing integrations reading the single-document shape keep
    // working; they now see the first of several rather than the only one.
    documentId: created[0].documentId,
    editUrl: created[0].editUrl,
    inboxItemId: created[0].inboxItemId,
    approval: created[0].approval,
    message: `Created ${created.length} DRAFT document(s) for ${member.user.email}.`,
  });
};

export const loader = () =>
  Response.json({
    usage:
      'POST inbound email here from your provider with Authorization: Bearer $NEXT_PRIVATE_INBOUND_EMAIL_SECRET. Multipart payload with recipient, sender, subject, and a PDF attachment field (`attachment-1` Mailgun-style).',
  });
