import { runDueApprovalReminders } from '@documenso/lib/server-only/approval/run-due-reminders';
import { env } from '@documenso/lib/utils/env';

import type { Route } from './+types/cron.approval-reminders';

/**
 * POST /api/cron/approval-reminders
 *
 * Sends due approval reminders/escalations. Wire to your cron service (hourly is
 * a sensible cadence). Auth: `Authorization: Bearer $NEXT_PRIVATE_CRON_SECRET`.
 */
export const action = async ({ request }: Route.ActionArgs) => {
  const secret = env('NEXT_PRIVATE_CRON_SECRET');

  if (!secret) {
    return new Response(
      JSON.stringify({ error: 'Cron endpoint disabled: NEXT_PRIVATE_CRON_SECRET is not set.' }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  if ((request.headers.get('authorization') ?? '') !== `Bearer ${secret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    });
  }

  const result = await runDueApprovalReminders();

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
