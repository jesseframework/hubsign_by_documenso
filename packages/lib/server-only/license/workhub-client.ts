/**
 * WorkHub license-key client — HubSign is external to WorkHub, so it does NOT
 * hold the signing secret; it POSTs a minted key to WorkHub's public redeem
 * endpoint, which verifies the HMAC signature, enforces single-use + the pinned
 * subject, and returns the grant.
 *
 * Endpoint (WorkHub): POST {WORKHUB_LICENSE_API_URL}/v1/public/hubsign/license/{redeem,verify}
 * Env: WORKHUB_LICENSE_API_URL — WorkHub api base, e.g. https://api.workhubplatform.io
 *      (WorkHub also IP-allowlists this endpoint to HubSign's egress IP.)
 */

import { env } from '@documenso/lib/utils/env';

export type WorkHubGrantType = 'org' | 'individual';

export interface WorkHubLicenseGrant {
  valid: true;
  jti: string;
  grantType: WorkHubGrantType;
  subject: string;
  tier: string;
  addons: string[];
  seats: number | null;
  days: number;
  expiresAt: string; // ISO
}

export class WorkHubLicenseError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'WorkHubLicenseError';
  }
}

function baseUrl(): string {
  const url = (env('WORKHUB_LICENSE_API_URL') ?? '').trim().replace(/\/$/, '');
  if (!url) {
    throw new WorkHubLicenseError(
      'WORKHUB_LICENSE_API_URL is not configured on this HubSign deployment',
      'not_configured',
      500,
    );
  }
  return url;
}

async function call(path: string, key: string, subject: string): Promise<WorkHubLicenseGrant> {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ key, subject }),
  }).catch((err: unknown) => {
    throw new WorkHubLicenseError(
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
    throw new WorkHubLicenseError(`WorkHub returned non-JSON (HTTP ${res.status})`, 'bad_response', 502);
  }

  if (!res.ok || body.valid !== true) {
    const code = typeof body.error === 'string' ? body.error : `http_${res.status}`;
    const detail = typeof body.detail === 'string' ? body.detail : code;
    throw new WorkHubLicenseError(detail, code, res.status);
  }

  return body as unknown as WorkHubLicenseGrant;
}

/**
 * Redeem a key (CONSUMES it — single-use). Returns the grant to apply locally.
 * Throws WorkHubLicenseError on invalid/expired/already-redeemed/subject-mismatch.
 */
export function redeemWorkHubLicenseKey(key: string, subject: string): Promise<WorkHubLicenseGrant> {
  return call('/v1/public/hubsign/license/redeem', key, subject);
}

/**
 * Verify a key WITHOUT consuming it — for a "this key grants X" preview before
 * the user confirms.
 */
export function verifyWorkHubLicenseKey(key: string, subject: string): Promise<WorkHubLicenseGrant> {
  return call('/v1/public/hubsign/license/verify', key, subject);
}
