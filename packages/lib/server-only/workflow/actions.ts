/**
 * Workflow action registry — the code-level extension point.
 *
 * Each ACTION step names an `action` (SEND_EMAIL, HTTP_REQUEST, NOTIFY, ...).
 * Adding a new capability = adding one entry to `WORKFLOW_ACTIONS`. Handlers
 * receive the (zod-validated) action config plus the run `data` used to resolve
 * `{{ templates }}`, and return a JSON-serialisable result stored on the step.
 */

import type { TWorkflowAction } from '../../types/workflow';
import { normalizeMetadataKey } from '../../universal/metadata';
import { renderTemplate, resolveTemplatesDeep, resolveValue } from './template';

export type WorkflowLogger = {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

export type WorkflowActionContext = {
  /** Root object that `{{ templates }}` resolve against (the run context). */
  data: unknown;
  logger: WorkflowLogger;
};

export type WorkflowActionHandler<C extends TWorkflowAction = TWorkflowAction> = (
  config: C,
  ctx: WorkflowActionContext,
) => Promise<unknown>;

const splitAddresses = (rendered: string): string[] =>
  rendered
    .split(',')
    .map((a) => a.trim())
    .filter((a) => a.length > 0);

const sendEmail: WorkflowActionHandler<Extract<TWorkflowAction, { action: 'SEND_EMAIL' }>> = async (
  config,
  { data, logger },
) => {
  const rawTo = Array.isArray(config.to) ? config.to : [config.to];
  const to = Array.from(
    new Set(rawTo.flatMap((addr) => splitAddresses(renderTemplate(addr, data)))),
  );

  if (to.length === 0) {
    logger.warn('[workflow:SEND_EMAIL] no resolvable recipients — skipping');
    return { skipped: true, reason: 'no-recipients' };
  }

  // A saved template supplies the body; anything set explicitly on the step
  // still wins, so one template can be reused under a different subject.
  let source = { subject: config.subject, html: config.html, text: config.text };
  let usedTemplate: string | undefined;

  if (config.templateKey) {
    const organizationId = Number((data as { organization?: { id?: unknown } })?.organization?.id);

    if (!organizationId) {
      logger.warn('[workflow:SEND_EMAIL] templateKey set but run has no organization — skipping');
      return { skipped: true, reason: 'no-organization' };
    }

    const { prisma } = await import('@documenso/prisma');
    const template = await prisma.emailTemplate.findUnique({
      where: { organizationId_key: { organizationId, key: config.templateKey } },
    });

    // Deliberately a skip, not a silent fall-through to the inline fields: a
    // renamed or deleted template would otherwise send a blank email, and a
    // blank email that looks delivered is worse than an obvious no-send.
    if (!template) {
      logger.warn(
        `[workflow:SEND_EMAIL] email template "${config.templateKey}" not found in org ${organizationId} — skipping`,
      );
      return { skipped: true, reason: 'template-not-found', templateKey: config.templateKey };
    }

    usedTemplate = template.key;
    source = {
      subject: config.subject || template.subject,
      html: config.html || template.html,
      text: config.text ?? template.text ?? undefined,
    };
  }

  const subject = renderTemplate(source.subject, data);
  const html = renderTemplate(source.html, data);
  const text = source.text ? renderTemplate(source.text, data) : html.replace(/<[^>]+>/g, '');

  const { mailer } = await import('@documenso/email/mailer');
  const { FROM_ADDRESS, FROM_NAME } = await import('../../constants/email');

  await mailer.sendMail({
    to,
    from: { name: FROM_NAME, address: FROM_ADDRESS },
    subject,
    html,
    text,
  });

  return { sent: true, to, subject, ...(usedTemplate && { templateKey: usedTemplate }) };
};

const httpRequest: WorkflowActionHandler<
  Extract<TWorkflowAction, { action: 'HTTP_REQUEST' }>
> = async (config, { data, logger }) => {
  const url = renderTemplate(config.url, data);
  const headers = config.headers
    ? (resolveTemplatesDeep(config.headers, data) as Record<string, string>)
    : {};

  let body: string | undefined;
  if (config.body !== undefined && config.method !== 'GET') {
    if (typeof config.body === 'string') {
      body = renderTemplate(config.body, data);
    } else {
      body = JSON.stringify(resolveTemplatesDeep(config.body, data));
      if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
        headers['content-type'] = 'application/json';
      }
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 10_000);

  try {
    const response = await fetch(url, {
      method: config.method,
      headers,
      body,
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') ?? '';
    const responseBody = contentType.includes('application/json')
      ? await response.json().catch(() => null)
      : await response.text();

    if (!response.ok) {
      logger.warn(`[workflow:HTTP_REQUEST] ${config.method} ${url} -> ${response.status}`);
    }

    return { status: response.status, ok: response.ok, body: responseBody };
  } finally {
    clearTimeout(timeout);
  }
};

const notify: WorkflowActionHandler<Extract<TWorkflowAction, { action: 'NOTIFY' }>> = async (
  config,
  { data, logger },
) => {
  const resolved = resolveValue(config.userId, data);

  let userId: number | undefined;
  if (resolved === 'OWNER' || resolved === 'INITIATOR') {
    const ownerId = (data as { document?: { userId?: unknown } })?.document?.userId;
    userId = typeof ownerId === 'number' ? ownerId : Number(ownerId);
  } else {
    userId = typeof resolved === 'number' ? resolved : Number(resolved);
  }

  if (!userId || Number.isNaN(userId)) {
    logger.warn('[workflow:NOTIFY] could not resolve a user id — skipping');
    return { skipped: true, reason: 'no-user' };
  }

  const { sendFcmNotificationToUser } = await import('../push-notifications/fcm-client');

  const sent = await sendFcmNotificationToUser(userId, {
    title: renderTemplate(config.title, data),
    body: renderTemplate(config.message, data),
  });

  return { userId, sent };
};

/** Recipient roles the signing flow accepts. */
const RECIPIENT_ROLES = ['SIGNER', 'APPROVER', 'CC', 'VIEWER'] as const;

type RecipientRole = (typeof RECIPIENT_ROLES)[number];

/**
 * Resolve a recipient's role, which may be a literal or a `{{template}}` such
 * as `{{vars.vendor.signerRole}}`.
 *
 * Falls back to SIGNER rather than throwing: a metadata record with a typo'd or
 * missing role should still get the document in front of someone, and the warn
 * makes the misconfiguration findable in the run log.
 */
const resolveRecipientRole = (
  raw: string | undefined,
  data: unknown,
  logger: WorkflowLogger,
): RecipientRole => {
  const rendered = renderTemplate(raw ?? '', data).trim().toUpperCase();

  if (!rendered) {
    return 'SIGNER';
  }

  if ((RECIPIENT_ROLES as readonly string[]).includes(rendered)) {
    return rendered as RecipientRole;
  }

  logger.warn(
    `[workflow:SEND_FOR_SIGNATURE] role "${rendered}" is not one of ${RECIPIENT_ROLES.join(', ')} — defaulting to SIGNER`,
  );

  return 'SIGNER';
};

const sendForSignature: WorkflowActionHandler<
  Extract<TWorkflowAction, { action: 'SEND_FOR_SIGNATURE' }>
> = async (config, { data, logger }) => {
  const root = data as {
    payload?: { document?: { id?: unknown } };
    document?: { id?: unknown; document?: { id?: unknown } };
    organization?: { id?: unknown };
  };

  // Resolve the document id: explicit config wins, else the event's document
  // (INBOX_* payloads nest it under `document.document`).
  const fromConfig =
    config.documentId === undefined
      ? undefined
      : typeof config.documentId === 'number'
        ? config.documentId
        : resolveValue(config.documentId, data);
  const rawId =
    fromConfig ??
    root.payload?.document?.id ??
    root.document?.document?.id ??
    root.document?.id;
  const documentId = Number(rawId);
  if (!documentId || Number.isNaN(documentId)) {
    logger.warn('[workflow:SEND_FOR_SIGNATURE] no document id — skipping');
    return { skipped: true, reason: 'no-document' };
  }

  const organizationId = Number(root.organization?.id);

  const recipients = config.recipients
    .map((r) => ({
      email: renderTemplate(r.email, data).trim(),
      name: r.name ? renderTemplate(r.name, data).trim() : '',
      role: resolveRecipientRole(r.role, data, logger),
    }))
    .filter((r) => /\S+@\S+\.\S+/.test(r.email));
  if (recipients.length === 0) {
    logger.warn('[workflow:SEND_FOR_SIGNATURE] no resolvable recipients — skipping');
    return { skipped: true, reason: 'no-recipients' };
  }

  const { prisma } = await import('@documenso/prisma');

  // Only documents that came through this org's signature inbox are eligible —
  // stops a workflow from sending arbitrary documents.
  const inboxItem = await prisma.signatureInboxItem.findFirst({
    where: { documentId, organizationId },
    select: { id: true },
  });
  if (!inboxItem) {
    logger.warn(
      `[workflow:SEND_FOR_SIGNATURE] document ${documentId} not in org ${organizationId} inbox — skipping`,
    );
    return { skipped: true, reason: 'document-not-in-org-inbox' };
  }

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { recipients: { select: { email: true } } },
  });
  if (!document) return { skipped: true, reason: 'document-not-found' };
  if (document.status !== 'DRAFT') {
    logger.warn(`[workflow:SEND_FOR_SIGNATURE] document ${documentId} is ${document.status} — skipping`);
    return { skipped: true, reason: `already-${document.status}` };
  }

  const { nanoid } = await import('../../universal/id');
  const existing = new Set(document.recipients.map((r) => r.email.toLowerCase()));
  const added: string[] = [];
  for (const r of recipients) {
    if (existing.has(r.email.toLowerCase())) continue;
    await prisma.recipient.create({
      data: {
        documentId,
        email: r.email,
        name: r.name,
        token: nanoid(),
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- z.enum value matches RecipientRole
        role: r.role as never,
      },
    });
    existing.add(r.email.toLowerCase());
    added.push(r.email);
  }

  const { sendDocument } = await import('../document/send-document');
  await sendDocument({
    documentId,
    userId: document.userId,
    teamId: document.teamId ?? undefined,
    requestMetadata: { requestMetadata: {}, source: 'app', auth: null },
  });

  await prisma.signatureInboxItem.update({
    where: { id: inboxItem.id },
    data: { status: 'SENT_FOR_SIGNATURE' },
  });

  return { sent: true, documentId, recipients: recipients.map((r) => r.email), added };
};

/** Extra fields ({{vars.<saveAs>.email}}, .contactName, .role, …) from a record. */
const recordExtra = (record: { data?: unknown }): Record<string, unknown> =>
  record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? (record.data as Record<string, unknown>)
    : {};

/** A record's keywords (stored on data.keywords as an array or comma-string). */
const recordKeywords = (record: { data?: unknown }): string[] => {
  const raw = recordExtra(record).keywords;
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(',') : [];
  return list.map((k) => k.trim().toLowerCase()).filter(Boolean);
};

const lookupMetadata: WorkflowActionHandler<
  Extract<TWorkflowAction, { action: 'LOOKUP_METADATA' }>
> = async (config, { data, logger }) => {
  const organizationId = Number(
    (data as { organization?: { id?: unknown } })?.organization?.id,
  );
  if (!organizationId) {
    logger.warn('[workflow:LOOKUP_METADATA] missing organization — skipping');
    return { found: false };
  }

  const { prisma } = await import('@documenso/prisma');

  // EXACT mode — look up by normalized name.
  if (config.key && config.key.trim()) {
    const rawKey = renderTemplate(config.key, data).trim();
    const key = normalizeMetadataKey(rawKey);
    if (!key) return { found: false, key: rawKey };
    const record = await prisma.metadataRecord.findUnique({
      where: { organizationId_category_key: { organizationId, category: config.category, key } },
    });
    if (!record) return { found: false, key: rawKey };
    return { found: true, key: rawKey, label: record.label, email: record.email, ...recordExtra(record) };
  }

  // KEYWORD mode — scan text for each record's keywords, return the first match.
  // Default haystack = every OCR field the event carried, plus type + title.
  let haystack = config.keywordText ? renderTemplate(config.keywordText, data) : '';
  if (!haystack) {
    const payload = (data as { payload?: Record<string, unknown> })?.payload ?? {};
    const parts: string[] = [];
    const extracted = payload.extractedData;
    if (extracted && typeof extracted === 'object') {
      parts.push(...Object.values(extracted as Record<string, unknown>).map((v) => String(v ?? '')));
    }
    if (payload.documentType) parts.push(String(payload.documentType));
    const doc = payload.document as { title?: unknown } | undefined;
    if (doc?.title) parts.push(String(doc.title));
    haystack = parts.join(' ');
  }
  haystack = haystack.toLowerCase();

  if (!haystack.trim()) {
    logger.warn('[workflow:LOOKUP_METADATA] nothing to match keywords against — skipping');
    return { found: false };
  }

  const records = await prisma.metadataRecord.findMany({
    where: { organizationId, category: config.category },
  });
  for (const record of records) {
    const matched = recordKeywords(record).find((kw) => haystack.includes(kw));
    if (matched) {
      logger.info(`[workflow:LOOKUP_METADATA] matched "${record.label}" on keyword "${matched}"`);
      return {
        found: true,
        matchedKeyword: matched,
        key: record.key,
        label: record.label,
        email: record.email,
        ...recordExtra(record),
      };
    }
  }

  return { found: false };
};

/**
 * Maps each action name to a handler typed for *that* action's config variant.
 */
type WorkflowActionHandlerMap = {
  [A in TWorkflowAction as A['action']]: WorkflowActionHandler<A>;
};

/**
 * The registry. Add a new capability by adding one entry here.
 */
export const WORKFLOW_ACTIONS = {
  SEND_EMAIL: sendEmail,
  HTTP_REQUEST: httpRequest,
  NOTIFY: notify,
  SEND_FOR_SIGNATURE: sendForSignature,
  LOOKUP_METADATA: lookupMetadata,
} satisfies WorkflowActionHandlerMap;

/**
 * Execute an action by dispatching to its registered handler. The lookup is
 * sound (config.action ↔ handler variant); the cast just collapses the union for
 * the call site.
 */
export const runAction = async (
  config: TWorkflowAction,
  ctx: WorkflowActionContext,
): Promise<unknown> => {
  const handler = WORKFLOW_ACTIONS[config.action] as WorkflowActionHandler | undefined;

  if (!handler) {
    throw new Error(`Unknown workflow action: "${config.action}"`);
  }

  return handler(config, ctx);
};
