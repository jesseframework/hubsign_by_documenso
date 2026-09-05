/**
 * Workflow action registry — the code-level extension point.
 *
 * Each ACTION step names an `action` (SEND_EMAIL, HTTP_REQUEST, NOTIFY, ...).
 * Adding a new capability = adding one entry to `WORKFLOW_ACTIONS`. Handlers
 * receive the (zod-validated) action config plus the run `data` used to resolve
 * `{{ templates }}`, and return a JSON-serialisable result stored on the step.
 */

import type { TWorkflowAction } from '../../types/workflow';
import { containsKeyword, parseKeywords } from '../../universal/keyword-match';
import { normalizeMetadataKey } from '../../universal/metadata';
import {
  type MetadataSigner,
  type MetadataSigningOrder,
  readRecordSigners,
  readRecordSigningOrder,
} from '../../universal/metadata-signers';
import { asMatchPercent, matchVendorName } from '../../universal/vendor-match';
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

/**
 * Resolve a signer chain from a `{{path}}` on the run context.
 *
 * The value at the path is whatever the lookup put there — for a metadata record
 * that is `data.signers`, so `readRecordSigners` also handles the legacy
 * single-signer shape and a record written before chains existed still resolves
 * to a one-entry list.
 *
 * `renderTemplate` cannot be used: it stringifies, and this needs the array.
 */
const readSignerList = (
  path: string,
  data: unknown,
  logger: { warn: (message: string) => void },
): { signers: MetadataSigner[]; signingOrder: MetadataSigningOrder | null } => {
  const cleaned = path.trim().replace(/^\{\{\s*/, '').replace(/\s*\}\}$/, '');

  const value = cleaned
    .split('.')
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[key] : undefined,
      data,
    );

  if (value === undefined || value === null) {
    logger.warn(`[workflow:SEND_FOR_SIGNATURE] "${path}" resolved to nothing`);
    return { signers: [], signingOrder: null };
  }

  // The path may point at the list itself or at the record holding it; accept
  // both so an author does not have to know which shape the lookup returned.
  const signers = Array.isArray(value)
    ? readRecordSigners({ signers: value })
    : readRecordSigners(value);

  if (signers.length === 0) {
    logger.warn(`[workflow:SEND_FOR_SIGNATURE] "${path}" held no usable signers`);
  }

  return {
    signers,
    signingOrder: Array.isArray(value) ? null : readRecordSigningOrder(value),
  };
};

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

  // A chain resolved from the run context — typically a metadata record's
  // `signers`. Read first so its order is the signing order, with any statically
  // configured recipients appended after it.
  const fromList = config.recipientsFrom
    ? readSignerList(config.recipientsFrom, data, logger)
    : { signers: [], signingOrder: null };

  const recipients = [
    ...fromList.signers.map((s) => ({ email: s.email, name: s.name ?? '', role: s.role })),
    ...config.recipients.map((r) => ({
      email: renderTemplate(r.email, data).trim(),
      name: r.name ? renderTemplate(r.name, data).trim() : '',
      role: resolveRecipientRole(r.role, data, logger),
    })),
  ]
    .filter((r) => /\S+@\S+\.\S+/.test(r.email))
    // The same address twice would ask one person to sign the same document
    // twice, and in sequential mode would deadlock behind itself.
    .filter((r, i, all) => all.findIndex((o) => o.email.toLowerCase() === r.email.toLowerCase()) === i);

  if (recipients.length === 0) {
    logger.warn('[workflow:SEND_FOR_SIGNATURE] no resolvable recipients — skipping');
    return { skipped: true, reason: 'no-recipients' };
  }

  // Step config wins, then the record's own preference, then the document's.
  const signingOrder = config.signingOrder ?? fromList.signingOrder;

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

  // Continue after anyone already on the document, so adding a chain to a
  // document that already has a recipient does not put two people at position 1
  // — which sequential signing reads as a tie and cannot resolve.
  let position = document.recipients.length;

  for (const r of recipients) {
    if (existing.has(r.email.toLowerCase())) continue;
    position += 1;

    await prisma.recipient.create({
      data: {
        documentId,
        email: r.email,
        name: r.name,
        token: nanoid(),
        // Always written, even in parallel mode: it is ignored unless the
        // document is sequential, and storing it means switching a document to
        // sequential later preserves the intended order instead of inventing one.
        signingOrder: position,
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- z.enum value matches RecipientRole
        role: r.role as never,
      },
    });
    existing.add(r.email.toLowerCase());
    added.push(r.email);
  }

  // Turn-taking is enforced off the DOCUMENT's setting, so the per-recipient
  // order above does nothing on its own.
  if (signingOrder) {
    await prisma.documentMeta.upsert({
      where: { documentId },
      create: { documentId, signingOrder },
      update: { signingOrder },
    });
  }

  // The organization's send rules apply to an automated send exactly as they do
  // to a manual one — otherwise a workflow becomes a way around a BLOCK rule
  // (a duplicate invoice, say) that a person clicking Send would have hit.
  const { evaluateGate, describeBlocks } = await import('../rules/evaluate-gate');

  const verdict = await evaluateGate({
    gate: 'DOCUMENT_SEND',
    subject: { organizationId, entityType: 'Document', entityId: String(documentId) },
  });

  if (!verdict.allowed) {
    logger.warn(`[workflow:SEND_FOR_SIGNATURE] blocked by rules: ${describeBlocks(verdict)}`);
    return { skipped: true, reason: 'blocked-by-rules', message: describeBlocks(verdict) };
  }

  // An emailed-in document has no field layout, so without this the signer
  // receives a document with nothing to sign.
  const { ensureSignatureFields } = await import('../field/ensure-signature-fields');
  const fieldsAdded = await ensureSignatureFields({ documentId });

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

  return {
    sent: true,
    documentId,
    recipients: recipients.map((r) => r.email),
    added,
    signatureFieldsAdded: fieldsAdded,
  };
};

/** Extra fields ({{vars.<saveAs>.email}}, .contactName, .role, …) from a record. */
const recordExtra = (record: { data?: unknown }): Record<string, unknown> =>
  record.data && typeof record.data === 'object' && !Array.isArray(record.data)
    ? (record.data as Record<string, unknown>)
    : {};

/** A record's keywords (stored on data.keywords as an array or delimited string). */
const recordKeywords = (record: { data?: unknown }): string[] =>
  parseKeywords(recordExtra(record).keywords);

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

  // NAME mode — exact first, then fuzzy.
  if (config.key && config.key.trim()) {
    const rawKey = renderTemplate(config.key, data).trim();
    const key = normalizeMetadataKey(rawKey);
    if (!key) return { found: false, key: rawKey };

    const record = await prisma.metadataRecord.findUnique({
      where: { organizationId_category_key: { organizationId, category: config.category, key } },
    });

    if (record) {
      return {
        found: true,
        key: rawKey,
        label: record.label,
        email: record.email,
        matchScore: 100,
        matchMethod: 'exact',
        ...recordExtra(record),
      };
    }

    // No character-for-character hit. The name came off an invoice, so this is
    // the common case rather than the exception: "Company Ltd." against
    // "Company Limited", a dropped suffix, a scanning slip. Before the fuzzy
    // pass this returned not-found and the workflow silently did nothing, which
    // is indistinguishable from no rule having applied.
    const candidates = await prisma.metadataRecord.findMany({
      where: { organizationId, category: config.category },
    });

    const outcome = matchVendorName(
      rawKey,
      candidates.map((c) => ({ name: c.label ?? c.key, value: c })),
      { threshold: (config.minScore ?? 85) / 100 },
    );

    if (outcome.ambiguousWith) {
      // Two vendors fit equally well. Picking one would be a coin flip that
      // could email the wrong company or route to the wrong approver.
      logger.warn(
        `[workflow:LOOKUP_METADATA] "${rawKey}" is ambiguous between ` +
          outcome.ambiguousWith.map((c) => `"${c.name}" (${asMatchPercent(c.score)}%)`).join(' and ') +
          ' — no match returned',
      );
      return { found: false, key: rawKey, ambiguous: true, matchScore: asMatchPercent(outcome.bestScore) };
    }

    if (!outcome.match) {
      logger.info(
        `[workflow:LOOKUP_METADATA] no "${config.category}" match for "${rawKey}" ` +
          `(closest ${asMatchPercent(outcome.bestScore)}%)`,
      );
      return { found: false, key: rawKey, matchScore: asMatchPercent(outcome.bestScore) };
    }

    const matched = outcome.match.value;
    logger.info(
      `[workflow:LOOKUP_METADATA] "${rawKey}" matched "${matched.label}" ` +
        `at ${asMatchPercent(outcome.match.score)}% (${outcome.match.method})`,
    );

    return {
      found: true,
      key: rawKey,
      label: matched.label,
      email: matched.email,
      matchScore: asMatchPercent(outcome.match.score),
      matchMethod: outcome.match.method,
      ...recordExtra(matched),
    };
  }

  // KEYWORD mode — scan text for each record's keywords.
  // Default haystack = every OCR field the event carried, plus type + title,
  // and — only when asked for — the document's full OCR text.
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

    // The extracted fields are ~15 short values, so a keyword the OCR template
    // has no field for is unfindable without the body text. It is read here
    // rather than carried on the event because that payload is persisted on
    // every WorkflowRun and pushed to Teams — fetching it lazily keeps the cost
    // on the lookups that actually asked for it.
    if (config.searchDocumentText) {
      const inboxItemId = payload.inboxItemId;
      if (!inboxItemId) {
        logger.warn(
          '[workflow:LOOKUP_METADATA] searchDocumentText is set but this event carries no ' +
            'inboxItemId — matching extracted fields only',
        );
      } else {
        const item = await prisma.signatureInboxItem.findUnique({
          where: { id: String(inboxItemId) },
          select: { ocrText: true },
        });
        if (item?.ocrText) parts.push(item.ocrText);
        else logger.info('[workflow:LOOKUP_METADATA] no OCR text stored for this document');
      }
    }

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

  const hits: { record: (typeof records)[number]; keyword: string }[] = [];
  for (const record of records) {
    const keyword = recordKeywords(record).find((kw) => containsKeyword(haystack, kw));
    if (keyword) hits.push({ record, keyword });
  }

  const [best, ...rest] = hits;
  if (!best) return { found: false };

  // More than one record claims the document. NAME mode refuses to guess here,
  // but a keyword list is a deliberately loose net and returning nothing would
  // break the workflows already relying on first-match; so the first is still
  // used and the collision is logged and put on the result, where a CONDITION
  // step can gate on it. This is the "a generic keyword like 'consulting' on
  // one vendor silently captures every invoice" failure, made visible.
  if (rest.length > 0) {
    logger.warn(
      `[workflow:LOOKUP_METADATA] ${hits.length} "${config.category}" records match — using ` +
        `"${best.record.label}" (on "${best.keyword}"); also ` +
        rest.map((h) => `"${h.record.label}" (on "${h.keyword}")`).join(', '),
    );
  }

  logger.info(
    `[workflow:LOOKUP_METADATA] matched "${best.record.label}" on keyword "${best.keyword}"`,
  );

  return {
    found: true,
    matchedKeyword: best.keyword,
    key: best.record.key,
    label: best.record.label,
    email: best.record.email,
    ambiguous: rest.length > 0,
    matchCount: hits.length,
    matches: hits.map((h) => ({
      key: h.record.key,
      label: h.record.label,
      email: h.record.email,
      matchedKeyword: h.keyword,
    })),
    ...recordExtra(best.record),
  };
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
