import { drainOcrQueue } from '@documenso/lib/server-only/bms-ml/drain-ocr-queue';
import { env } from '@documenso/lib/utils/env';

import type { Route } from './+types/cron.ocr-queue-drain';

/**
 * POST /api/cron/ocr-queue-drain
 *
 * Re-attempts Smart OCR (BMS ML) pages that were queued because an org was
 * over its page quota when they were ready to process. Wire this to your
 * cron service on a daily cadence — same convention as
 * `/api/cron/subscription-renewals`.
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

  const result = await drainOcrQueue();

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
