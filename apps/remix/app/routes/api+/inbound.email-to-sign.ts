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

type InboundProviderPayload = {
  to: string;
  from: string;
  subject?: string;
  pdfFile: { name: string; arrayBuffer: () => Promise<ArrayBuffer>; type: string };
};

const parseMailgunPayload = async (request: Request): Promise<InboundProviderPayload | null> => {
  const form = await request.formData();
  const to = String(form.get('recipient') ?? form.get('To') ?? '');
  const from = String(form.get('sender') ?? form.get('From') ?? '');
  const subject = String(form.get('subject') ?? form.get('Subject') ?? '');

  // Find the first PDF attachment.
  for (const [key, value] of form.entries()) {
    if (key.startsWith('attachment-') && value instanceof File) {
      if (value.type === 'application/pdf' || value.name.toLowerCase().endsWith('.pdf')) {
        return {
          to,
          from,
          subject,
          pdfFile: {
            name: value.name,
            type: 'application/pdf',
            arrayBuffer: async () => value.arrayBuffer(),
          },
        };
      }
    }
  }

  return null;
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

  if (Array.isArray(attachments)) {
    for (const att of attachments) {
      const name = String(att.fileName ?? att.filename ?? att.name ?? 'attachment.pdf');
      const mime = String(att.mimeType ?? att.contentType ?? att.type ?? '');
      const b64 = att.contentBase64 ?? att.content ?? att.contentBytes ?? att.data;
      const isPdf = mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
      if (isPdf && typeof b64 === 'string') {
        const arrayBuffer = base64ToArrayBuffer(b64);
        return {
          to,
          from,
          subject,
          pdfFile: { name, type: 'application/pdf', arrayBuffer: async () => arrayBuffer },
        };
      }
    }
  }

  return null;
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
    select: { id: true, slug: true, emailToSignEnabled: true },
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

  // Upload the PDF.
  const documentData = await putPdfFileServerSide({
    name: payload.pdfFile.name,
    type: 'application/pdf',
    arrayBuffer: payload.pdfFile.arrayBuffer,
  });

  // Create a DRAFT document. No recipients yet — the sender (or anyone in
  // the org) finishes setup in the HubSign UI.
  const document = await prisma.document.create({
    data: {
      title: payload.subject || payload.pdfFile.name,
      qrToken: prefixedId('qr'),
      documentDataId: documentData.id,
      userId: member.userId,
      // The receiving org is already resolved above; stamp it directly.
      organizationId: member.organizationId,
      source: DocumentSource.DOCUMENT,
      documentMeta: {
        create: {
          // Use the inbound subject as the email subject, if any.
          subject: payload.subject || undefined,
        },
      },
    },
  });

  const editUrl = `${NEXT_PUBLIC_WEBAPP_URL()}/documents/${document.id}/edit`;

  // Signature inbox: queue the inbound document and kick off OCR (BMS ML). The
  // OCR job fires the INBOX_OCR_COMPLETED workflow event when it finishes.
  let inboxItemId: string | undefined;
  try {
    const { createInboxItem } = await import('@documenso/lib/server-only/inbox/create-inbox-item');
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

  // Fire the pre-OCR "email received" workflow event.
  try {
    const { triggerWorkflows } = await import(
      '@documenso/lib/server-only/workflow/trigger-workflows'
    );
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

  // Route the inbound document through an approval chain if the org has one
  // configured for documents. Non-fatal: a missing template just skips.
  let approval: { requestId?: string; skipped?: string } = {};
  try {
    const { startApprovalRequest } = await import(
      '@documenso/lib/server-only/approval/approval-execution'
    );
    const result = await startApprovalRequest({
      organizationId: member.organizationId,
      entityType: 'Document',
      entityId: String(document.id),
      requesterUserId: member.userId,
    });
    approval = 'skipped' in result ? { skipped: result.reason } : { requestId: result.requestId };
  } catch (err) {
    console.error('[email-to-sign] approval dispatch failed (non-fatal):', err);
  }

  return Response.json({
    ok: true,
    documentId: document.id,
    editUrl,
    inboxItemId,
    approval,
    message: `Created DRAFT document "${document.title}" for ${member.user.email}.`,
  });
};

export const loader = () =>
  Response.json({
    usage:
      'POST inbound email here from your provider with Authorization: Bearer $NEXT_PRIVATE_INBOUND_EMAIL_SECRET. Multipart payload with recipient, sender, subject, and a PDF attachment field (`attachment-1` Mailgun-style).',
  });
