/**
 * WorkHub's `email.mail-received` webhook — registration and delivery
 * verification.
 *
 * Replaces most of the timed inbox poll. WorkHub watches the mailbox and pushes
 * a notification through Svix when mail lands, so HubSign stops spending the
 * mailbox's API quota on a 2-minute timer.
 *
 * Two things worth knowing before reading further:
 *
 * 1. It is NOT real-time. WorkHub itself polls Exchange on a ~60s interval, so
 *    the webhook fires after *their* poll finds mail. Worst case goes from our
 *    120s to roughly 60s plus delivery — a halving, not an elimination.
 *
 * 2. The payload is a summary with no attachment bytes (Svix caps at ~1 MB).
 *    Rather than build a second ingest path that fetches them, the handler just
 *    triggers the existing poller for that organization. The webhook is a
 *    wake-up signal; `pollWorkHubInboxForOrg` remains the only ingest path, so
 *    dedup (`externalMessageId`), attachment fetching and OCR dispatch keep
 *    working exactly as they already do — and at-least-once duplicates become
 *    harmless by construction.
 *
 * Auth note: WorkHub's own documentation says to register with
 * `Authorization: Bearer <whk_ key>`. That returns 401 `JWSInvalid` — the Bearer
 * path expects a user JWT. A `whk_` key must be sent as `x-api-key`, verified
 * against the live API.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from '../../utils/env';

export type WorkHubWatch = {
  id: string;
  active: boolean;
  /** Svix App Portal URL — an admin opens this to add the endpoint and copy the secret. */
  portalUrl: string | null;
};

export class WorkHubWebhookError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'WorkHubWebhookError';
  }
}

/**
 * The configured base already ends in `/v1` on existing deployments, so the
 * suffix is stripped before paths are appended. Getting this wrong produces
 * `/v1/v1/...` and a 404 that looks like a missing feature.
 */
function apiRoot(override?: string | null): string {
  const configured = (
    override ||
    env('NEXT_PRIVATE_WORKHUB_API_BASE') ||
    'https://api.workhubplatform.io'
  )
    .trim()
    .replace(/\/$/, '');

  return configured.replace(/\/v1$/, '');
}

async function call(
  path: string,
  apiKey: string,
  apiBase: string | null | undefined,
  init: RequestInit = {},
): Promise<unknown> {
  const res = await fetch(`${apiRoot(apiBase)}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      // NOT `Authorization: Bearer` — see the auth note above.
      'x-api-key': apiKey,
      ...(init.headers ?? {}),
    },
  }).catch((err: unknown) => {
    throw new WorkHubWebhookError(
      `could not reach WorkHub: ${(err as Error).message}`,
      'unreachable',
      502,
    );
  });

  const text = await res.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new WorkHubWebhookError(`WorkHub returned non-JSON (HTTP ${res.status})`, 'bad_response', 502);
  }

  if (!res.ok) {
    const code = typeof body.error === 'string' ? body.error : `http_${res.status}`;
    const detail = typeof body.detail === 'string' ? body.detail : code;

    // The two failures an admin will actually hit, in words they can act on.
    if (code === 'mailbox_profile_missing') {
      throw new WorkHubWebhookError(
        'This mailbox has no Proxy Profile linked in WorkHub (Settings → Email). Link one and try again.',
        code,
        res.status,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new WorkHubWebhookError(
        'The WorkHub API key was rejected, or is missing the "email.update" permission needed to register.',
        code,
        res.status,
      );
    }

    throw new WorkHubWebhookError(detail, code, res.status);
  }

  return body;
}

/** Register the mailbox for push notifications. Returns the Svix portal URL. */
export async function registerMailWatch({
  apiKey,
  apiBase,
  mailboxId,
}: {
  apiKey: string;
  apiBase?: string | null;
  mailboxId: string;
}): Promise<WorkHubWatch> {
  const body = (await call('/v1/email/webhooks', apiKey, apiBase, {
    method: 'POST',
    body: JSON.stringify({ mailboxId }),
  })) as { watch?: { id?: string; active?: boolean }; portalUrl?: string };

  if (!body.watch?.id) {
    throw new WorkHubWebhookError('WorkHub did not return a watch id', 'bad_response', 502);
  }

  return {
    id: body.watch.id,
    active: body.watch.active !== false,
    portalUrl: typeof body.portalUrl === 'string' ? body.portalUrl : null,
  };
}

/** Watches WorkHub currently holds for this key's tenant. */
export async function listMailWatches({
  apiKey,
  apiBase,
}: {
  apiKey: string;
  apiBase?: string | null;
}): Promise<Array<{ id: string; active: boolean; lastError: string | null }>> {
  const body = (await call('/v1/email/webhooks', apiKey, apiBase)) as {
    items?: Array<{ id?: string; active?: boolean; last_error?: string | null }>;
  };

  return (body.items ?? [])
    .filter((item): item is { id: string; active?: boolean; last_error?: string | null } =>
      typeof item.id === 'string',
    )
    .map((item) => ({
      id: item.id,
      active: item.active !== false,
      lastError: item.last_error ?? null,
    }));
}

/** Re-fetch the portal link; the secret is only visible there. */
export async function getMailWatchPortalUrl({
  apiKey,
  apiBase,
}: {
  apiKey: string;
  apiBase?: string | null;
}): Promise<string | null> {
  const body = (await call('/v1/email/webhooks/portal', apiKey, apiBase)) as { portalUrl?: string };
  return typeof body.portalUrl === 'string' ? body.portalUrl : null;
}

/** Force an immediate catch-up poll on WorkHub's side. Useful when testing. */
export async function triggerMailWatchPoll({
  apiKey,
  apiBase,
  watchId,
}: {
  apiKey: string;
  apiBase?: string | null;
  watchId: string;
}): Promise<number> {
  const body = (await call(`/v1/email/webhooks/${encodeURIComponent(watchId)}/poll`, apiKey, apiBase, {
    method: 'POST',
  })) as { dispatched?: number };

  return typeof body.dispatched === 'number' ? body.dispatched : 0;
}

/** How far out of step a delivery's timestamp may be before it is refused. */
const TOLERANCE_SECONDS = 5 * 60;

/**
 * Verify a Svix delivery signature.
 *
 * Implemented directly rather than pulling in the `svix` package for one
 * endpoint. The scheme is small and stable: HMAC-SHA256 over
 * `{id}.{timestamp}.{body}`, keyed by the base64 body of the `whsec_` secret,
 * compared against a space-separated list of `v1,<signature>` candidates.
 *
 * The timestamp check is what stops a captured delivery being replayed later,
 * and the comparison is constant-time so a wrong signature leaks nothing about
 * how wrong it was.
 */
export function verifySvixSignature({
  secret,
  id,
  timestamp,
  signatureHeader,
  body,
  now = Date.now(),
}: {
  secret: string;
  id: string | null;
  timestamp: string | null;
  signatureHeader: string | null;
  body: string;
  now?: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!secret) return { ok: false, reason: 'no signing secret configured' };
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: 'missing svix headers' };

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return { ok: false, reason: 'unparseable timestamp' };

  const driftSeconds = Math.abs(now / 1000 - sentAt);
  if (driftSeconds > TOLERANCE_SECONDS) {
    return { ok: false, reason: `timestamp outside tolerance (${Math.round(driftSeconds)}s)` };
  }

  // Secrets are handed out as `whsec_<base64>`; the prefix is not part of the key.
  // Uint8Array rather than Buffer throughout: the repo's Node types don't accept
  // Buffer for these signatures (the same mismatch behind the standing errors in
  // seal-document and encrypt-pdf), and Uint8Array is what both APIs want anyway.
  const keyBytes = new Uint8Array(Buffer.from(secret.replace(/^whsec_/, ''), 'base64'));
  const expected = new Uint8Array(
    createHmac('sha256', keyBytes).update(`${id}.${timestamp}.${body}`).digest(),
  );

  // The header can carry several versioned signatures during a secret rotation.
  const candidates = signatureHeader
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .map((part) => part.slice(3));

  if (!candidates.length) return { ok: false, reason: 'no v1 signature present' };

  for (const candidate of candidates) {
    const provided = new Uint8Array(Buffer.from(candidate, 'base64'));
    // Length must match before the constant-time compare — timingSafeEqual
    // throws on a length mismatch rather than returning false.
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: 'signature mismatch' };
}
