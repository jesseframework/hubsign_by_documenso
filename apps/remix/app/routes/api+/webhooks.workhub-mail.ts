/**
 * POST /api/webhooks/workhub-mail
 *
 * Receives WorkHub's `email.mail-received` notification (delivered by Svix) and
 * wakes the inbox poller for the matching organization.
 *
 * The webhook is a signal, not a data path. Its payload is a summary with no
 * attachment bytes, so instead of building a second ingest route this hands off
 * to `pollWorkHubInboxForOrg` — the same function the timer calls. Dedup on
 * `externalMessageId`, attachment fetching and OCR dispatch therefore keep
 * working unchanged, and Svix's at-least-once duplicates are harmless: a second
 * delivery just polls again and imports nothing.
 *
 * The timed poll is deliberately NOT retired. WorkHub documents an overflow case
 * (>200 unseen messages in one window) that can gap, delivery is at-least-once
 * rather than exactly-once, and this endpoint can be down. The timer stays as a
 * backstop; the webhook is what makes the common case fast.
 */

import { pollWorkHubInboxForOrg } from '@documenso/lib/server-only/inbox/poll-workhub-inbox';
import { verifySvixSignature } from '@documenso/lib/server-only/inbox/workhub-mail-webhook';
import { prisma } from '@documenso/prisma';

import type { Route } from './+types/webhooks.workhub-mail';

export const action = async ({ request }: Route.ActionArgs) => {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Read once, as text: the signature covers the exact bytes sent, so the body
  // must not be re-serialised before verification.
  const body = await request.text();

  let payload: { event?: string; mailboxId?: string; emailId?: string };
  try {
    payload = JSON.parse(body) as typeof payload;
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const mailboxId = typeof payload.mailboxId === 'string' ? payload.mailboxId : '';
  if (!mailboxId) {
    return Response.json({ error: 'missing_mailbox' }, { status: 400 });
  }

  /*
    The mailbox id routes the delivery to an organization, and that org's stored
    secret is what verifies it. An unknown mailbox is answered 202 rather than
    404: Svix retries 4xx-with-backoff, and a mailbox we do not host will never
    become one we do, so retrying it forever helps nobody. The log line is the
    signal for a human.
  */
  const organization = await prisma.organization.findFirst({
    where: { workhubMailboxId: mailboxId },
    select: { id: true, workhubWebhookSecret: true },
  });

  if (!organization) {
    console.warn('[workhub-mail] delivery for an unknown mailbox — ignoring');
    return Response.json({ ok: true, ignored: 'unknown_mailbox' }, { status: 202 });
  }

  const verdict = verifySvixSignature({
    secret: organization.workhubWebhookSecret ?? '',
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signatureHeader: request.headers.get('svix-signature'),
    body,
  });

  if (!verdict.ok) {
    // 401 and no detail: an unverified caller learns nothing about why. The
    // reason goes to the log, where an operator debugging a real misconfiguration
    // will look.
    console.error(`[workhub-mail] rejected delivery for org ${organization.id}: ${verdict.reason}`);
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (payload.event && payload.event !== 'email.mail-received') {
    return Response.json({ ok: true, ignored: 'unhandled_event' }, { status: 202 });
  }

  try {
    const result = await pollWorkHubInboxForOrg(organization.id);

    return Response.json({ ok: true, imported: result.imported, skipped: result.skipped });
  } catch (err) {
    /*
      A 500 here is correct and wanted: Svix retries with backoff, which is
      exactly the right behaviour when our own poll failed transiently. The mail
      is still sitting in the mailbox, and the timed poll would catch it anyway.
    */
    console.error(`[workhub-mail] poll failed for org ${organization.id}:`, err);

    return Response.json({ error: 'poll_failed' }, { status: 500 });
  }
};
