import { sendPendingReminders } from '@documenso/lib/server-only/document/send-pending-reminders';
import { env } from '@documenso/lib/utils/env';

import type { Route } from './+types/cron.send-reminders';

/**
 * POST /api/cron/send-reminders
 *
 * Wire to your cron service (Cloud Scheduler, GitHub Actions, fly.io machines,
 * a Render cron job, etc.). Hit it on whatever cadence you want — every hour
 * is a reasonable default.
 *
 * Auth: requires `Authorization: Bearer $NEXT_PRIVATE_CRON_SECRET` header.
 * If `NEXT_PRIVATE_CRON_SECRET` is unset, the endpoint is disabled to avoid
 * accidental exposure.
 */
export const action = async ({ request }: Route.ActionArgs) => {
  const secret = env('NEXT_PRIVATE_CRON_SECRET');

  if (!secret) {
    return new Response(
      JSON.stringify({ error: 'Cron endpoint disabled: NEXT_PRIVATE_CRON_SECRET is not set.' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  const auth = request.headers.get('authorization') ?? '';
  if (auth !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const result = await sendPendingReminders();

  return new Response(JSON.stringify({ ok: true, ...result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

// GET should not trigger reminders, but it's useful for sanity-checking the URL.
export const loader = () =>
  new Response(JSON.stringify({ usage: 'POST with Authorization: Bearer $NEXT_PRIVATE_CRON_SECRET' }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
