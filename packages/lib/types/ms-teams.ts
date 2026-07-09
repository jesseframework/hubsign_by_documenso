import { z } from 'zod';

/**
 * Microsoft Teams wire types.
 *
 * Cards are Adaptive Cards (schema 1.4+), NOT the legacy `MessageCard` format
 * used by Office 365 Connectors — Microsoft is retiring those.
 */

export const ADAPTIVE_CARD_CONTENT_TYPE = 'application/vnd.microsoft.card.adaptive';
export const ADAPTIVE_CARD_SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';

/**
 * 1.4 is the floor for `Action.Execute` and `refresh` (Universal Actions) while
 * still rendering on every supported Teams client.
 */
export const ADAPTIVE_CARD_VERSION = '1.4';

export type AdaptiveCard = {
  $schema: typeof ADAPTIVE_CARD_SCHEMA;
  type: 'AdaptiveCard';
  version: string;
  body: unknown[];
  actions?: unknown[];
  /** Teams-specific rendering hints, e.g. `{ width: 'Full' }`. */
  msteams?: Record<string, unknown>;
  /** Universal Actions auto-refresh. Bot transport only. */
  refresh?: { action?: unknown; userIds?: string[] };
};

/** A card plus the fallback text shown in notifications and channel previews. */
export type MsTeamsMessage = {
  card: AdaptiveCard;
  /** Plaintext fallback, surfaced in the activity feed and on old clients. */
  summary: string;
};

/**
 * The envelope both transports accept. Power Automate's "when a webhook request
 * is received" trigger and the Bot Connector's activity endpoint happen to take
 * the same `attachments` shape.
 */
export const toCardEnvelope = (message: MsTeamsMessage) => ({
  type: 'message' as const,
  summary: message.summary,
  attachments: [
    {
      contentType: ADAPTIVE_CARD_CONTENT_TYPE,
      content: message.card,
    },
  ],
});

// ─── Inbound activities ──────────────────────────────────────────────────────

/**
 * Lenient schema for inbound Bot Framework activities. Teams sends far more
 * fields than we model, so unknown keys pass through and only what we read is
 * validated. Nothing here is trusted until the bearer token is verified — see
 * `server-only/ms-teams/verify-activity.ts`.
 */
export const ZMsTeamsActivitySchema = z
  .object({
    type: z.string(),
    id: z.string().optional(),
    serviceUrl: z.string().url(),
    /** Bot Framework channel, e.g. "msteams". NOT a Teams *channel* id. */
    channelId: z.string().optional(),
    conversation: z.object({
      id: z.string(),
      conversationType: z.string().optional(),
      tenantId: z.string().optional(),
    }),
    from: z
      .object({
        id: z.string(),
        name: z.string().optional(),
        aadObjectId: z.string().optional(),
      })
      .optional(),
    recipient: z.object({ id: z.string(), name: z.string().optional() }).optional(),
    text: z.string().optional(),
    /** Invoke name, e.g. "adaptiveCard/action". */
    name: z.string().optional(),
    value: z.unknown().optional(),
    channelData: z
      .object({
        tenant: z.object({ id: z.string() }).optional(),
        team: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
        channel: z.object({ id: z.string().optional(), name: z.string().optional() }).optional(),
      })
      .passthrough()
      .optional(),
    membersAdded: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  })
  .passthrough();

export type TMsTeamsActivity = z.infer<typeof ZMsTeamsActivitySchema>;

/** Payload of an `Action.Execute` press, carried at `activity.value.action.data`. */
export const ZMsTeamsCardActionSchema = z.object({
  verb: z.string(),
  documentId: z.coerce.number().int().positive().optional(),
  linkRequestId: z.string().optional(),
});

export type TMsTeamsCardAction = z.infer<typeof ZMsTeamsCardActionSchema>;

// ─── Outbound results ────────────────────────────────────────────────────────

export type MsTeamsSendResult = {
  ok: boolean;
  /** Bot Connector activity id. Absent on the webhook transport, which is fire-and-forget. */
  activityId?: string;
  status?: number;
  body?: unknown;
  error?: string;
};

// ─── Card input shapes ───────────────────────────────────────────────────────

/** The subset of a Document the cards render. Kept structural so callers can pass Prisma rows. */
export type MsTeamsDocumentSummary = {
  id: number;
  title: string;
  status?: string | null;
  createdAt?: Date | string | null;
  recipients?: MsTeamsRecipientSummary[];
};

export type MsTeamsRecipientSummary = {
  email: string;
  name?: string | null;
  role?: string | null;
  signedAt?: Date | string | null;
};
