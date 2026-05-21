/**
 * Client for the WorkHub inbound (receive) API — the companion to BulkSender.
 *
 *   GET    /v1/email/inbox                                  list messages
 *   GET    /v1/email/inbox/{id}/attachments                list attachments
 *   GET    /v1/email/inbox/{id}/attachments/{aid}          fetch attachment (base64)
 *   POST   /v1/email/inbox/{id}/mark-read                  mark read
 *
 * Auth: HTTP Basic with the org's WorkHub BulkSender credential — the SAME auth
 * model as sending (WorkHub binds the credential to a mailbox server-side). The
 * credential is stored per-organization, so each org reads its own mailbox.
 * Response parsing is tolerant of field-name variations until the live shape is
 * pinned.
 */

import { env } from '../../utils/env';

export type WorkHubInboxConfig = {
  apiBase?: string | null;
  username?: string | null;
  password?: string | null;
  mailboxId?: string | null;
};

export const isWorkHubInboxConfigured = (config: WorkHubInboxConfig): boolean =>
  !!config.username && !!config.password;

const resolveBase = (config: WorkHubInboxConfig): string =>
  (config.apiBase || env('NEXT_PRIVATE_WORKHUB_API_BASE') || 'https://api.workhubplatform.io/v1').replace(
    /\/$/,
    '',
  );

const headers = (config: WorkHubInboxConfig): Record<string, string> => {
  const basic = Buffer.from(`${config.username ?? ''}:${config.password ?? ''}`).toString('base64');
  return { authorization: `Basic ${basic}`, 'content-type': 'application/json' };
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
  const body = text ? JSON.parse(text) : null;
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
