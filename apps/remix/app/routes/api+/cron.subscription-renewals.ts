import { runDueSubscriptionRenewalReminders } from '@documenso/lib/server-only/billing/run-due-renewal-reminders';
import { env } from '@documenso/lib/utils/env';

import type { Route } from './+types/cron.subscription-renewals';

/**
 * POST /api/cron/subscription-renewals
 *
 * Scans active individual/team/org subscriptions for upcoming renewals and
 * sends a reminder email once per billing period. Wire this to your cron
 * service (Cloud Scheduler, GitHub Actions, Render cron, fly machines, ...)
 * on a daily cadence — same convention as `/api/cron/workflows`.
 *
 * Auth: requires `Authorization: Bearer $NEXT_PRIVATE_CRON_SECRET`. If the
 * secret is unset the endpoint is disabled to avoid accidental exposure.
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

  const result = await runDueSubscriptionRenewalReminders();

  return new Response(JSON.stringify({ ok: true, ...result }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const loader = () =>
  new Response(
    JSON.stringify({ usage: 'POST with Authorization: Bearer $NEXT_PRIVATE_CRON_SECRET' }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
