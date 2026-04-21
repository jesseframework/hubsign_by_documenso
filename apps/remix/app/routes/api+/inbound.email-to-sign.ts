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

  const payload = await parseMailgunPayload(request);
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

  return Response.json({
    ok: true,
    documentId: document.id,
    editUrl,
    message: `Created DRAFT document "${document.title}" for ${member.user.email}.`,
  });
};

export const loader = () =>
  Response.json({
    usage:
      'POST inbound email here from your provider with Authorization: Bearer $NEXT_PRIVATE_INBOUND_EMAIL_SECRET. Multipart payload with recipient, sender, subject, and a PDF attachment field (`attachment-1` Mailgun-style).',
  });
