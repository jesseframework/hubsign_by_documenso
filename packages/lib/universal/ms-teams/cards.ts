/**
 * Adaptive Card renderers for the Microsoft Teams integration.
 *
 * Pure functions — no I/O, no env, no Prisma — so they can be unit-tested and
 * previewed from the settings UI. Transport-agnostic: the same card is posted by
 * the webhook transport and the bot transport.
 *
 * Cards target Adaptive Cards 1.4 (the floor for Action.Execute / refresh).
 * Paste any output into https://adaptivecards.io/designer to eyeball it.
 */
import {
  ADAPTIVE_CARD_SCHEMA,
  ADAPTIVE_CARD_VERSION,
  type AdaptiveCard,
  type MsTeamsDocumentSummary,
  type MsTeamsMessage,
  type MsTeamsRecipientSummary,
} from '../../types/ms-teams';
import type { WorkflowEventKey } from '../../types/workflow';

type CardColor = 'default' | 'dark' | 'light' | 'accent' | 'good' | 'warning' | 'attention';

const card = (body: unknown[], actions?: unknown[], extra?: Partial<AdaptiveCard>): AdaptiveCard => ({
  $schema: ADAPTIVE_CARD_SCHEMA,
  type: 'AdaptiveCard',
  version: ADAPTIVE_CARD_VERSION,
  body,
  ...(actions?.length ? { actions } : {}),
  msteams: { width: 'Full' },
  ...extra,
});

const textBlock = (text: string, opts: Record<string, unknown> = {}) => ({
  type: 'TextBlock',
  text,
  wrap: true,
  ...opts,
});

const openUrl = (title: string, url: string) => ({ type: 'Action.OpenUrl', title, url });

/**
 * Universal Action button. Only renders usefully on the BOT transport — a
 * webhook-delivered card has no bot to route the invoke back to, so callers
 * must omit these when building for WEBHOOK.
 */
const execute = (title: string, verb: string, data: Record<string, unknown> = {}) => ({
  type: 'Action.Execute',
  title,
  verb,
  data: { verb, ...data },
});

// ─── Event presentation ──────────────────────────────────────────────────────

type EventPresentation = { emoji: string; headline: string; color: CardColor };

const EVENT_PRESENTATION: Record<WorkflowEventKey, EventPresentation> = {
  DOCUMENT_CREATED: { emoji: '📄', headline: 'Document created', color: 'default' },
  DOCUMENT_SENT: { emoji: '📤', headline: 'Sent for signing', color: 'accent' },
  DOCUMENT_OPENED: { emoji: '👀', headline: 'Opened by recipient', color: 'default' },
  DOCUMENT_SIGNED: { emoji: '✍️', headline: 'Recipient signed', color: 'good' },
  DOCUMENT_COMPLETED: { emoji: '✅', headline: 'Completed', color: 'good' },
  DOCUMENT_REJECTED: { emoji: '⛔', headline: 'Rejected', color: 'attention' },
  DOCUMENT_CANCELLED: { emoji: '🚫', headline: 'Cancelled', color: 'warning' },
  DMS_DOCUMENT_FILED: { emoji: '🗂️', headline: 'Filed in DMS', color: 'default' },
  DMS_DOCUMENT_CLASSIFIED: { emoji: '🏷️', headline: 'Classified', color: 'default' },
  DMS_RETRIEVAL_REQUESTED: { emoji: '📥', headline: 'Retrieval requested', color: 'accent' },
  INBOX_EMAIL_RECEIVED: { emoji: '📧', headline: 'Inbox email received', color: 'default' },
  INBOX_OCR_COMPLETED: { emoji: '🔍', headline: 'OCR completed', color: 'default' },
};

export const getEventPresentation = (event: WorkflowEventKey): EventPresentation =>
  EVENT_PRESENTATION[event] ?? { emoji: '🔔', headline: event, color: 'default' };

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** eSign documents live at /documents/:id. DMS documents live at /dms/doc/:id, so
 *  callers dealing with non-eSign events must pass an explicit `documentUrl`. */
const defaultDocumentUrl = (appUrl: string, documentId: number) =>
  `${appUrl.replace(/\/+$/, '')}/documents/${documentId}`;

const displayName = (r: MsTeamsRecipientSummary) => r.name?.trim() || r.email;

const hasSigned = (r: MsTeamsRecipientSummary) => Boolean(r.signedAt);

/**
 * Adaptive Cards have no progress-bar element, so draw one with block glyphs.
 * Renders as `██████░░░░` at a fixed 10-cell width.
 */
export const progressBar = (done: number, total: number, width = 10): string => {
  if (total <= 0) return '░'.repeat(width);

  const clamped = Math.max(0, Math.min(done, total));
  const filled = Math.round((clamped / total) * width);

  return '█'.repeat(filled) + '░'.repeat(width - filled);
};

const signingProgress = (recipients: MsTeamsRecipientSummary[]) => {
  // CC and VIEWER recipients never sign, so counting them would make a fully
  // signed document read as e.g. "2 of 3".
  const signers = recipients.filter((r) => r.role !== 'CC' && r.role !== 'VIEWER');
  const signed = signers.filter(hasSigned).length;

  return { signed, total: signers.length, signers };
};

// ─── Cards ───────────────────────────────────────────────────────────────────

export type MilestoneCardInput = {
  event: WorkflowEventKey;
  document: MsTeamsDocumentSummary;
  organizationName: string;
  appUrl: string;
  /** Who caused the event, when known (e.g. the recipient who signed). */
  actorName?: string | null;
  /** Overrides the derived /documents/:id link — required for DMS events. */
  documentUrl?: string;
};

/**
 * A one-shot card announcing a single event. Safe on both transports.
 */
export const renderMilestoneCard = ({
  event,
  document,
  organizationName,
  appUrl,
  actorName,
  documentUrl,
}: MilestoneCardInput): MsTeamsMessage => {
  const { emoji, headline, color } = getEventPresentation(event);

  const facts: { title: string; value: string }[] = [{ title: 'Organization', value: organizationName }];

  if (actorName) {
    facts.push({ title: 'By', value: actorName });
  }

  if (document.status) {
    facts.push({ title: 'Status', value: document.status });
  }

  const body: unknown[] = [
    textBlock(`${emoji} ${headline}`, { weight: 'Bolder', size: 'Medium', color }),
    textBlock(document.title, { size: 'Large', weight: 'Bolder', spacing: 'None' }),
    { type: 'FactSet', facts },
  ];

  if (document.recipients?.length) {
    const { signed, total } = signingProgress(document.recipients);

    if (total > 0) {
      body.push(
        textBlock(`${progressBar(signed, total)}  ${signed} of ${total} signed`, {
          fontType: 'Monospace',
          spacing: 'Small',
        }),
      );
    }
  }

  return {
    summary: `${headline}: ${document.title}`,
    card: card(body, [
      openUrl('Open in HubSign', documentUrl ?? defaultDocumentUrl(appUrl, document.id)),
    ]),
  };
};

export type TrackerCardInput = {
  document: MsTeamsDocumentSummary;
  organizationName: string;
  appUrl: string;
  /**
   * Include Action.Execute buttons and the `refresh` block. BOT transport only —
   * a webhook-delivered card cannot route invokes back to us.
   */
  interactive?: boolean;
  /** Rendered into the footer so a re-posted card is visibly fresh. */
  updatedAt?: Date;
  /** Overrides the derived /documents/:id link. */
  documentUrl?: string;
};

/**
 * The live tracker: one card per document, rewritten in place as recipients act.
 *
 * On the BOT transport the caller PUTs this over the previously posted activity
 * (see MsTeamsCardRef). On WEBHOOK it degrades to a static snapshot, because a
 * posted webhook card can never be edited.
 */
export const renderTrackerCard = ({
  document,
  organizationName,
  appUrl,
  interactive = false,
  updatedAt,
  documentUrl,
}: TrackerCardInput): MsTeamsMessage => {
  const recipients = document.recipients ?? [];
  const { signed, total, signers } = signingProgress(recipients);

  const complete = total > 0 && signed === total;
  const rejected = document.status === 'REJECTED';

  const statusColor: CardColor = rejected ? 'attention' : complete ? 'good' : 'accent';
  const statusText = rejected
    ? '⛔ Rejected'
    : complete
      ? '✅ Fully signed'
      : `⏳ Awaiting ${total - signed} of ${total}`;

  const body: unknown[] = [
    {
      type: 'ColumnSet',
      columns: [
        {
          type: 'Column',
          width: 'stretch',
          items: [
            textBlock(document.title, { size: 'Large', weight: 'Bolder' }),
            textBlock(organizationName, { isSubtle: true, spacing: 'None' }),
          ],
        },
        {
          type: 'Column',
          width: 'auto',
          items: [textBlock(statusText, { weight: 'Bolder', color: statusColor })],
        },
      ],
    },
  ];

  if (total > 0) {
    body.push(
      textBlock(`${progressBar(signed, total)}  ${signed} / ${total}`, {
        fontType: 'Monospace',
        spacing: 'Small',
      }),
    );
  }

  if (signers.length) {
    body.push({
      type: 'FactSet',
      spacing: 'Medium',
      facts: signers.map((r) => ({
        title: hasSigned(r) ? '✅' : '⏳',
        value: displayName(r),
      })),
    });
  }

  const ccAndViewers = recipients.filter((r) => r.role === 'CC' || r.role === 'VIEWER');

  if (ccAndViewers.length) {
    body.push(
      textBlock(`CC: ${ccAndViewers.map(displayName).join(', ')}`, {
        isSubtle: true,
        size: 'Small',
        spacing: 'Small',
      }),
    );
  }

  if (updatedAt) {
    body.push(
      textBlock(`Updated ${updatedAt.toISOString()}`, {
        isSubtle: true,
        size: 'Small',
        spacing: 'Small',
      }),
    );
  }

  const actions: unknown[] = [
    openUrl('Open in HubSign', documentUrl ?? defaultDocumentUrl(appUrl, document.id)),
  ];

  if (interactive && !complete && !rejected) {
    actions.push(execute('Send reminder', 'document.remind', { documentId: document.id }));
  }

  const extra: Partial<AdaptiveCard> = interactive
    ? { refresh: { action: execute('Refresh', 'document.refresh', { documentId: document.id }) } }
    : {};

  return {
    summary: `${document.title} — ${statusText}`,
    card: card(body, actions, extra),
  };
};

export type DigestItem = {
  id: number;
  title: string;
  signed: number;
  total: number;
  /** Whole days past due. Negative/zero means not overdue. */
  overdueDays?: number;
};

export type DigestCardInput = {
  organizationName: string;
  appUrl: string;
  pending: DigestItem[];
  completedCount: number;
  /** Window the digest covers, e.g. "last 24 hours". */
  period: string;
  /** Cap the rendered rows; Teams truncates very tall cards. */
  maxItems?: number;
};

/**
 * Recurring summary card. Works on both transports (it is always a fresh post).
 */
export const renderDigestCard = ({
  organizationName,
  appUrl,
  pending,
  completedCount,
  period,
  maxItems = 10,
}: DigestCardInput): MsTeamsMessage => {
  const overdue = pending.filter((p) => (p.overdueDays ?? 0) > 0);
  const shown = pending.slice(0, maxItems);
  const hidden = pending.length - shown.length;

  const body: unknown[] = [
    textBlock(`📊 HubSign digest — ${organizationName}`, { size: 'Large', weight: 'Bolder' }),
    textBlock(period, { isSubtle: true, spacing: 'None' }),
    {
      type: 'ColumnSet',
      spacing: 'Medium',
      columns: [
        {
          type: 'Column',
          width: 'stretch',
          items: [
            textBlock('Pending', { isSubtle: true, size: 'Small' }),
            textBlock(String(pending.length), { size: 'ExtraLarge', weight: 'Bolder', spacing: 'None' }),
          ],
        },
        {
          type: 'Column',
          width: 'stretch',
          items: [
            textBlock('Overdue', { isSubtle: true, size: 'Small' }),
            textBlock(String(overdue.length), {
              size: 'ExtraLarge',
              weight: 'Bolder',
              spacing: 'None',
              color: overdue.length ? 'attention' : 'default',
            }),
          ],
        },
        {
          type: 'Column',
          width: 'stretch',
          items: [
            textBlock('Completed', { isSubtle: true, size: 'Small' }),
            textBlock(String(completedCount), {
              size: 'ExtraLarge',
              weight: 'Bolder',
              spacing: 'None',
              color: 'good',
            }),
          ],
        },
      ],
    },
  ];

  if (shown.length) {
    body.push({
      type: 'Container',
      spacing: 'Medium',
      separator: true,
      items: shown.map((item) => ({
        type: 'ColumnSet',
        columns: [
          {
            type: 'Column',
            width: 'stretch',
            items: [
              textBlock(item.title, { wrap: true }),
              ...((item.overdueDays ?? 0) > 0
                ? [
                    textBlock(`${item.overdueDays}d overdue`, {
                      size: 'Small',
                      color: 'attention',
                      spacing: 'None',
                    }),
                  ]
                : []),
            ],
          },
          {
            type: 'Column',
            width: 'auto',
            items: [
              textBlock(`${progressBar(item.signed, item.total, 6)} ${item.signed}/${item.total}`, {
                fontType: 'Monospace',
                size: 'Small',
              }),
            ],
          },
        ],
      })),
    });
  } else {
    body.push(textBlock('Nothing pending. 🎉', { spacing: 'Medium', isSubtle: true }));
  }

  if (hidden > 0) {
    body.push(textBlock(`+ ${hidden} more`, { isSubtle: true, size: 'Small' }));
  }

  return {
    summary: `HubSign digest — ${pending.length} pending, ${overdue.length} overdue`,
    card: card(body, [openUrl('Open HubSign', `${appUrl.replace(/\/+$/, '')}/documents`)]),
  };
};

export type LinkPromptCardInput = {
  linkUrl: string;
  channelName?: string | null;
  expiresInMinutes: number;
};

/**
 * Posted by the bot when it is first added to a channel. The deep link carries an
 * opaque, single-use `state` that binds this conversation to a HubSign org once
 * an authenticated admin confirms it.
 */
export const renderLinkPromptCard = ({
  linkUrl,
  channelName,
  expiresInMinutes,
}: LinkPromptCardInput): MsTeamsMessage => {
  const where = channelName ? `**${channelName}**` : 'this channel';

  return {
    summary: 'Connect this channel to HubSign',
    card: card(
      [
        textBlock('🔗 Connect HubSign', { size: 'Large', weight: 'Bolder' }),
        textBlock(
          `To post document notifications in ${where}, an organization admin needs to link it.`,
          { spacing: 'Small' },
        ),
        textBlock(`This link expires in ${expiresInMinutes} minutes and can be used once.`, {
          isSubtle: true,
          size: 'Small',
        }),
      ],
      [openUrl('Link this channel', linkUrl)],
    ),
  };
};

/**
 * Rewritten over the prompt card once linking succeeds, so the stale deep link
 * disappears from the channel.
 */
export const renderLinkedCard = ({
  organizationName,
  appUrl,
  linkedByName,
}: {
  organizationName: string;
  appUrl: string;
  linkedByName?: string | null;
}): MsTeamsMessage => ({
  summary: `Channel linked to ${organizationName}`,
  card: card(
    [
      textBlock('✅ Channel linked', { size: 'Large', weight: 'Bolder', color: 'good' }),
      textBlock(`Document notifications for **${organizationName}** will appear here.`, {
        spacing: 'Small',
      }),
      ...(linkedByName ? [textBlock(`Linked by ${linkedByName}`, { isSubtle: true, size: 'Small' })] : []),
    ],
    [openUrl('Manage notifications', `${appUrl.replace(/\/+$/, '')}/org/settings/integrations`)],
  ),
});
