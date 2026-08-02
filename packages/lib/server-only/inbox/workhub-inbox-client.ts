/**
 * Client for the WorkHub inbound (receive) API — the companion to BulkSender.
 *
 *   GET    /v1/email/inbox                                  list messages
 *   GET    /v1/email/inbox/{id}/attachments                list attachments
 *   GET    /v1/email/inbox/{id}/attachments/{aid}          fetch attachment (base64)
 *   POST   /v1/email/inbox/{id}/mark-read                  mark read
 *
 * Auth: an `x-api-key` WorkHub API key (`whk_…`) with `email.read` (+ `email.update`
 * for mark-read). This is DIFFERENT from sending: the inbox REST API's auth
 * middleware accepts ONLY `x-api-key` or a user Bearer JWT — HTTP Basic (the
 * BulkSender username/password used for SMTP send) is NOT a supported scheme and
 * returns 401 `unauthenticated`. API-key callers are also required to target a
 * `mailboxId` (there is no user identity to resolve a default mailbox from), which
 * the poller resolves from the org's inbox email. The API key is stored per
 * organization, so each org reads its own mailbox. Response parsing is tolerant of
 * field-name variations until the live shape is pinned.
 */

import { env } from '../../utils/env';

export type WorkHubInboxConfig = {
  apiBase?: string | null;
  apiKey?: string | null;
  username?: string | null;
  password?: string | null;
  mailboxId?: string | null;
};

export const isWorkHubInboxConfigured = (config: WorkHubInboxConfig): boolean =>
  // Only an API key can read the inbox. BulkSender username/password (HTTP Basic)
  // is a send-only credential and is rejected by the inbox API's auth middleware,
  // so it does NOT count as configured here.
  !!config.apiKey;

/**
 * Resolve the API base, tolerating a missing version segment: both
 * `https://host` and `https://host/v1` work (we ensure `/v1`).
 */
const resolveBase = (config: WorkHubInboxConfig): string => {
  let base = (
    config.apiBase ||
    env('NEXT_PRIVATE_WORKHUB_API_BASE') ||
    'https://api.workhubplatform.io/v1'
  ).replace(/\/$/, '');
  if (!/\/v\d+$/.test(base)) base += '/v1';
  return base;
};

/**
 * The inbox read API authenticates via `x-api-key` only. There is deliberately no
 * HTTP Basic fallback: the WorkHub auth middleware rejects Basic with a 401, so a
 * "successful" Basic request never happens — failing here with an actionable
 * message beats emitting a doomed request that surfaces as a cryptic 401/502.
 */
const headers = (config: WorkHubInboxConfig): Record<string, string> => {
  if (!config.apiKey) {
    throw new Error(
      'WorkHub inbox requires an API key (x-api-key) with email.read permission. ' +
        'BulkSender username/password (HTTP Basic) is a send-only credential and is ' +
        'rejected by the inbox API — set the "WorkHub API key" field in Org Settings.',
    );
  }
  return { 'x-api-key': config.apiKey, 'content-type': 'application/json' };
};

const url = (config: WorkHubInboxConfig, path: string): string => {
  const base = `${resolveBase(config)}${path}`;
  if (!config.mailboxId) return base;
  const sep = path.includes('?') ? '&' : '?';
  return `${base}${sep}mailboxId=${encodeURIComponent(config.mailboxId)}`;
};

const asArray = (body: unknown): unknown[] => {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const o = body as Record<string, unknown>;
    for (const key of ['messages', 'items', 'value', 'data', 'attachments', 'results']) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
    }
  }
  return [];
};

const pick = (obj: Record<string, unknown>, keys: string[]): unknown => {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
};

const emailFromAddress = (value: unknown): string => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return emailFromAddress(value[0]);
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return String(pick(o, ['address', 'emailAddress', 'email', 'smtpAddress']) ?? '');
  }
  return String(value);
};

export type WorkHubMessage = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  isRead?: boolean;
  hasAttachments?: boolean;
  raw: Record<string, unknown>;
};

export type WorkHubAttachmentMeta = {
  id: string;
  name: string;
  contentType: string;
  isInline: boolean;
};

const request = async (
  config: WorkHubInboxConfig,
  method: string,
  path: string,
): Promise<unknown> => {
  const res = await fetch(url(config, path), { method, headers: headers(config) });
  const text = await res.text();

  // The inbox API always answers JSON. Gateways/proxies and auth redirects can
  // return an HTML or plain-text page instead (e.g. a "502 Bad Gateway" or a
  // login page) — blindly JSON.parsing that yields a cryptic "Unexpected token
  // '<'" error, so detect non-JSON bodies and surface something actionable.
  const contentType = res.headers.get('content-type') ?? '';
  const looksJson = contentType.includes('json') || /^\s*[[{]/.test(text);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON shape is validated by callers
  let body: any = null;
  if (text) {
    if (!looksJson) {
      const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 200);
      throw new Error(
        `WorkHub inbox ${method} ${path} failed: HTTP ${res.status} returned a non-JSON ` +
          `response (content-type "${contentType || 'unknown'}"). The WorkHub API may be ` +
          `unreachable or the API base URL may be misconfigured. Response: ${snippet}`,
      );
    }
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(
        `WorkHub inbox ${method} ${path} failed: could not parse JSON (HTTP ${res.status}): ` +
          text.slice(0, 200),
      );
    }
  }

  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && (body.detail || body.error)) || `HTTP ${res.status}`;
    throw new Error(`WorkHub inbox ${method} ${path} failed: ${message}`);
  }
  return body;
};

export const workhubListInbox = async (
  config: WorkHubInboxConfig,
  options?: { isRead?: boolean; hasAttachments?: boolean; maxResults?: number },
): Promise<WorkHubMessage[]> => {
  const params = new URLSearchParams();
  if (options?.isRead !== undefined) params.set('isRead', String(options.isRead));
  if (options?.hasAttachments !== undefined)
    params.set('hasAttachments', String(options.hasAttachments));
  params.set('maxResults', String(options?.maxResults ?? 50));

  const body = await request(config, 'GET', `/email/inbox?${params.toString()}`);

  return asArray(body).map((m) => {
    const o = m as Record<string, unknown>;
    const to = pick(o, ['to', 'toRecipients', 'recipients', 'recipient']);
    return {
      id: String(pick(o, ['id', 'emailId', 'messageId', 'itemId']) ?? ''),
      from: emailFromAddress(pick(o, ['from', 'sender', 'fromAddress'])),
      to: (Array.isArray(to) ? to : [to]).map(emailFromAddress).filter(Boolean),
      subject: String(pick(o, ['subject', 'Subject']) ?? ''),
      isRead: Boolean(pick(o, ['isRead', 'read'])),
      hasAttachments: Boolean(pick(o, ['hasAttachments', 'hasAttachment'])),
      raw: o,
    };
  });
};

export const workhubListAttachments = async (
  config: WorkHubInboxConfig,
  emailId: string,
): Promise<WorkHubAttachmentMeta[]> => {
  const body = await request(
    config,
    'GET',
    `/email/inbox/${encodeURIComponent(emailId)}/attachments`,
  );
  return asArray(body).map((a) => {
    const o = a as Record<string, unknown>;
    return {
      id: String(pick(o, ['id', 'attachmentId', 'contentId']) ?? ''),
      name: String(pick(o, ['name', 'fileName', 'filename']) ?? 'attachment'),
      contentType: String(pick(o, ['contentType', 'mimeType', 'type']) ?? ''),
      isInline: Boolean(pick(o, ['isInline', 'inline'])),
    };
  });
};

/**
 * Some mail backends (Exchange via WorkHub's Java service) return an attachment
 * as a base64-encoded *Java-serialized* `byte[]` rather than the raw file bytes.
 * The stored file then has a serialization header before the real content (e.g.
 * `%PDF…`), which breaks OCR/preview. Detect the stream magic (0xACED0005) and
 * return just the embedded byte[] payload; pass anything else through untouched.
 */
export const unwrapSerializedAttachment = (buf: Buffer): Buffer => {
  if (buf.length < 6 || buf[0] !== 0xac || buf[1] !== 0xed || buf[2] !== 0x00 || buf[3] !== 0x05) {
    return buf;
  }
  // A top-level serialized byte[] ends its class descriptor with TC_ENDBLOCKDATA
  // (0x78) + TC_NULL (0x70), followed by a 4-byte big-endian length and the data.
  let term = -1;
  for (let i = 0; i + 1 < buf.length; i++) {
    if (buf[i] === 0x78 && buf[i + 1] === 0x70) {
      term = i;
      break;
    }
  }
  if (term >= 0 && term + 6 <= buf.length) {
    const len = buf.readUInt32BE(term + 2);
    const start = term + 6;
    if (len > 0 && start + len <= buf.length) return buf.subarray(start, start + len);
  }
  return buf;
};

export const workhubFetchAttachment = async (
  config: WorkHubInboxConfig,
  emailId: string,
  attachmentId: string,
): Promise<{ contentBase64: string } | null> => {
  const body = await request(
    config,
    'GET',
    `/email/inbox/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
  );
  if (!body || typeof body !== 'object') return null;
  const content = pick(body as Record<string, unknown>, [
    'contentBase64',
    'content',
    'contentBytes',
    'data',
  ]);
  if (typeof content !== 'string') return null;
  return { contentBase64: content.replace(/^data:[^;]+;base64,/, '') };
};

export const workhubMarkRead = async (
  config: WorkHubInboxConfig,
  emailId: string,
): Promise<void> => {
  await request(config, 'POST', `/email/inbox/${encodeURIComponent(emailId)}/mark-read`);
};

/** List the mailboxes the credential/key can access. */
export const workhubListMailboxes = async (
  config: WorkHubInboxConfig,
): Promise<Array<{ id: string; primaryEmail: string }>> => {
  const body = await request(config, 'GET', '/email/mailboxes');
  return asArray(body).map((m) => {
    const o = m as Record<string, unknown>;
    return {
      id: String(pick(o, ['id', 'mailboxId']) ?? ''),
      primaryEmail: String(pick(o, ['primaryEmail', 'email', 'address']) ?? '').toLowerCase(),
    };
  });
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve the mailbox UUID to use. API-key callers must pass a UUID; we accept a
 * UUID as-is, otherwise look it up by email (`mailboxId` if it's an email, else
 * `inboxEmail`) via /email/mailboxes. Returns null if nothing matches.
 */
export const resolveMailboxId = async (
  config: WorkHubInboxConfig,
  inboxEmail?: string | null,
): Promise<string | null> => {
  const raw = (config.mailboxId ?? '').trim();
  if (UUID_RE.test(raw)) return raw;

  const targetEmail = (raw.includes('@') ? raw : inboxEmail ?? '').toLowerCase();
  if (!targetEmail) return null;

  const boxes = await workhubListMailboxes(config);
  return boxes.find((b) => b.primaryEmail === targetEmail)?.id ?? null;
};
