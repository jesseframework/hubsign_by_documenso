/**
 * WorkHub AI-credit client — mirrors the license-key client. HubSign is external
 * to WorkHub, so it does NOT hold the signing secret; it POSTs a minted
 * credit-pack key to WorkHub's public redeem endpoint, which verifies the HMAC
 * signature, enforces single-use + the pinned subject (the org id), and returns
 * how many AI credits the pack grants.
 *
 * Endpoint (WorkHub): POST {WORKHUB_LICENSE_API_URL}/v1/public/hubsign/ai-credits/redeem
 * Env: WORKHUB_LICENSE_API_URL — the same WorkHub api base used for licenses,
 *      e.g. https://api.workhubplatform.io (IP-allowlisted to HubSign's egress).
 */

import { env } from '@documenso/lib/utils/env';

export interface WorkHubCreditGrant {
  valid: true;
  jti: string;
  subject: string; // org id (as string)
  credits: number; // AI credits this pack grants (1 credit = 1 message)
}

export class WorkHubCreditError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'WorkHubCreditError';
  }
}

function baseUrl(): string {
  const url = (env('WORKHUB_LICENSE_API_URL') ?? '').trim().replace(/\/$/, '');
  if (!url) {
    throw new WorkHubCreditError(
      'WORKHUB_LICENSE_API_URL is not configured on this HubSign deployment',
      'not_configured',
      500,
    );
  }
  return url;
}

async function call(path: string, key: string, subject: string): Promise<WorkHubCreditGrant> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ key, subject }),
  }).catch((err: unknown) => {
    throw new WorkHubCreditError(
      `could not reach WorkHub: ${(err as Error).message}`,
      'unreachable',
      502,
    );
  });

  const bodyText = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
  } catch {
    throw new WorkHubCreditError(`WorkHub returned non-JSON (HTTP ${res.status})`, 'bad_response', 502);
  }

  if (!res.ok || body.valid !== true) {
    const code = typeof body.error === 'string' ? body.error : `http_${res.status}`;
    const detail = typeof body.detail === 'string' ? body.detail : code;
    throw new WorkHubCreditError(detail, code, res.status);
  }

  if (typeof body.credits !== 'number' || !Number.isFinite(body.credits) || body.credits <= 0) {
    throw new WorkHubCreditError('WorkHub returned an invalid credit amount', 'bad_response', 502);
  }

  return body as unknown as WorkHubCreditGrant;
}

/**
 * Redeem a credit-pack key (CONSUMES it — single-use). Returns the grant to
 * apply locally. Throws WorkHubCreditError on invalid/already-redeemed/mismatch.
 */
export function redeemWorkHubCreditKey(key: string, subject: string): Promise<WorkHubCreditGrant> {
  return call('/v1/public/hubsign/ai-credits/redeem', key, subject);
}
