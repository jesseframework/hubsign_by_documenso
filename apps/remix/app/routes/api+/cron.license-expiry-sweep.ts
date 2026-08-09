import { sweepExpiredLicenseGrants } from '@documenso/lib/server-only/license/sweep-expired-license-grants';
import { env } from '@documenso/lib/utils/env';

import type { Route } from './+types/cron.license-expiry-sweep';

/**
 * POST /api/cron/license-expiry-sweep
 *
 * Deactivates expired individual license subscriptions and releases seats held
 * by expired org license plans (both past their grace window). The limits
 * resolver already fails closed on read, so this is cleanup — wire it to your
 * cron service on a daily cadence, same convention as the other /api/cron/*.
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

  const result = await sweepExpiredLicenseGrants();

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
