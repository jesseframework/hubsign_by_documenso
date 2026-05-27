/**
 * Workflow action registry — the code-level extension point.
 *
 * Each ACTION step names an `action` (SEND_EMAIL, HTTP_REQUEST, NOTIFY, ...).
 * Adding a new capability = adding one entry to `WORKFLOW_ACTIONS`. Handlers
 * receive the (zod-validated) action config plus the run `data` used to resolve
 * `{{ templates }}`, and return a JSON-serialisable result stored on the step.
 */

import type { TWorkflowAction } from '../../types/workflow';
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

  const subject = renderTemplate(config.subject, data);
  const html = renderTemplate(config.html, data);
  const text = config.text ? renderTemplate(config.text, data) : html.replace(/<[^>]+>/g, '');

  const { mailer } = await import('@documenso/email/mailer');
  const { FROM_ADDRESS, FROM_NAME } = await import('../../constants/email');

  await mailer.sendMail({
    to,
    from: { name: FROM_NAME, address: FROM_ADDRESS },
    subject,
    html,
    text,
  });

  return { sent: true, to, subject };
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
