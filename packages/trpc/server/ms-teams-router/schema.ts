import { z } from 'zod';

import { ZWorkflowEventKeySchema } from '@documenso/lib/types/workflow';

/**
 * Which events a channel receives. An empty array means "every event", matching
 * the semantics of MsTeamsChannelLink.events in the schema.
 */
export const ZMsTeamsEventsSchema = z.array(ZWorkflowEventKeySchema).default([]);

export const ZMsTeamsConnectSchema = z.object({
  transport: z.enum(['WEBHOOK', 'BOT']),
});

export const ZMsTeamsSetEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const ZMsTeamsAddWebhookChannelSchema = z.object({
  name: z.string().trim().min(1, 'Give the channel a name.').max(120),
  /** Power Automate "when a webhook request is received" URL. */
  webhookUrl: z.string().trim().min(1, 'Paste the Power Automate webhook URL.'),
  events: ZMsTeamsEventsSchema,
  digest: z.boolean().default(false),
  digestCron: z.string().trim().optional(),
  digestTimezone: z.string().trim().default('UTC'),
});

export const ZMsTeamsUpdateChannelSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
  /** Omit to leave the stored URL untouched; the client never receives it back. */
  webhookUrl: z.string().trim().min(1).optional(),
  events: z.array(ZWorkflowEventKeySchema).optional(),
  enabled: z.boolean().optional(),
  tracker: z.boolean().optional(),
  digest: z.boolean().optional(),
  digestCron: z.string().trim().nullable().optional(),
  digestTimezone: z.string().trim().optional(),
});

export const ZMsTeamsChannelIdSchema = z.object({
  id: z.string().min(1),
});

export const ZMsTeamsListDeliveriesSchema = z.object({
  channelId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export type TMsTeamsAddWebhookChannel = z.infer<typeof ZMsTeamsAddWebhookChannelSchema>;
export type TMsTeamsUpdateChannel = z.infer<typeof ZMsTeamsUpdateChannelSchema>;
