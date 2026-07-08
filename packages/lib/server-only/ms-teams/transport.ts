/**
 * Transport abstraction for Microsoft Teams delivery.
 *
 * This exists because HubSign is self-hostable. A Teams *bot* requires an Azure
 * Bot registration and a Teams admin to install an app package — a hard gate for
 * self-hosters. The WEBHOOK transport asks a user to paste one URL and works
 * everywhere, at the cost of being fire-and-forget.
 *
 *   supportsUpdate === false  →  no live tracker, only fresh posts.
 *
 * Callers must branch on `supportsUpdate` rather than on the transport name, so
 * a future transport (Graph API, say) slots in without touching call sites.
 */
import type { MsTeamsChannelLink, MsTeamsTransport } from '@prisma/client';

import { MS_TEAMS_REQUEST_TIMEOUT_MS } from '../../constants/ms-teams';
import { type MsTeamsMessage, type MsTeamsSendResult, toCardEnvelope } from '../../types/ms-teams';
import { sendActivity, updateActivity } from './bot-connector';

export type MsTeamsTransportAdapter = {
  readonly kind: MsTeamsTransport;
  /** Whether a posted card can later be rewritten in place. */
  readonly supportsUpdate: boolean;
  post(link: MsTeamsChannelLink, message: MsTeamsMessage): Promise<MsTeamsSendResult>;
  update(
    link: MsTeamsChannelLink,
    activityId: string,
    message: MsTeamsMessage,
  ): Promise<MsTeamsSendResult>;
};

// ─── Webhook transport ───────────────────────────────────────────────────────

/**
 * Posts to a Power Automate "when a webhook request is received" flow URL.
 *
 * NOT an Office 365 Connector: those, and their `MessageCard` payload format,
 * are being retired by Microsoft. The flow URL accepts the same Adaptive Card
 * envelope the Bot Connector does.
 *
 * The flow URL is a bearer credential in itself — anyone holding it can post to
 * the channel — so it is never logged or returned to the client.
 */
const webhookTransport: MsTeamsTransportAdapter = {
  kind: 'WEBHOOK',
  supportsUpdate: false,

  async post(link, message) {
    if (!link.webhookUrl) {
      return { ok: false, error: 'Channel link has no webhookUrl' };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MS_TEAMS_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(link.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toCardEnvelope(message)),
        signal: controller.signal,
      });

      // Power Automate answers 202 with an empty body on success.
      const body = await response.text().catch(() => '');

      return {
        ok: response.ok,
        status: response.status,
        body: body || null,
        error: response.ok ? undefined : `Teams webhook responded ${response.status}`,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Teams webhook request failed' };
    } finally {
      clearTimeout(timeout);
    }
  },

  async update() {
    // Structural, not incidental: a Power Automate webhook returns no message id
    // and exposes no edit endpoint. Callers should check `supportsUpdate` first.
    return {
      ok: false,
      error: 'The webhook transport cannot edit a posted card — connect the Teams bot for live trackers.',
    };
  },
};

// ─── Bot transport ───────────────────────────────────────────────────────────

const botTransport: MsTeamsTransportAdapter = {
  kind: 'BOT',
  supportsUpdate: true,

  async post(link, message) {
    if (!link.conversationId || !link.serviceUrl) {
      return { ok: false, error: 'Channel link is missing Bot Connector addressing' };
    }

    try {
      return await sendActivity(
        { serviceUrl: link.serviceUrl, conversationId: link.conversationId },
        message,
      );
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Bot Connector send failed' };
    }
  },

  async update(link, activityId, message) {
    if (!link.conversationId || !link.serviceUrl) {
      return { ok: false, error: 'Channel link is missing Bot Connector addressing' };
    }

    try {
      return await updateActivity(
        { serviceUrl: link.serviceUrl, conversationId: link.conversationId, activityId },
        message,
      );
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Bot Connector update failed' };
    }
  },
};

// ─── Resolution ──────────────────────────────────────────────────────────────

const TRANSPORTS: Record<MsTeamsTransport, MsTeamsTransportAdapter> = {
  WEBHOOK: webhookTransport,
  BOT: botTransport,
};

export const getTransport = (kind: MsTeamsTransport): MsTeamsTransportAdapter => TRANSPORTS[kind];
