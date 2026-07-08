/**
 * Minimal Bot Connector REST client.
 *
 * Deliberately not the `botbuilder` SDK: we need exactly three operations
 * (acquire token, post activity, replace activity) and the SDK drags in a large
 * dependency tree for an integration most deployments will run in WEBHOOK mode
 * anyway. Node >= 22 gives us `fetch`; `jose` (already a dependency) handles the
 * inbound half in `verify-activity.ts`.
 *
 * Reference: https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-api-reference
 */
import {
  MS_TEAMS_BOT_APP_ID,
  MS_TEAMS_BOT_APP_PASSWORD,
  MS_TEAMS_BOT_TENANT_ID,
  MS_TEAMS_CONNECTOR_SCOPE,
  MS_TEAMS_REQUEST_TIMEOUT_MS,
  MS_TEAMS_SERVICE_URL_ALLOWED_HOSTS,
  MS_TEAMS_SERVICE_URL_ALLOWED_SUFFIXES,
} from '../../constants/ms-teams';
import { type MsTeamsMessage, type MsTeamsSendResult, toCardEnvelope } from '../../types/ms-teams';

/**
 * `serviceUrl` originates in an inbound activity and is persisted, then replayed
 * as an outbound request target carrying a bearer token. A forged or tampered
 * value would leak that token to an attacker-controlled host, so constrain it to
 * hosts the Bot Connector actually lives on.
 *
 * Exported for direct unit testing — this is the security boundary.
 */
export const assertAllowedServiceUrl = (serviceUrl: string): URL => {
  let url: URL;

  try {
    url = new URL(serviceUrl);
  } catch {
    throw new Error(`Invalid Bot Connector serviceUrl: ${serviceUrl}`);
  }

  if (url.protocol !== 'https:') {
    throw new Error(`Bot Connector serviceUrl must be https: ${serviceUrl}`);
  }

  // `https://smba.trafficmanager.net@evil.com/` has hostname evil.com and would
  // be caught below anyway, but credentials have no legitimate place here.
  if (url.username || url.password) {
    throw new Error('Bot Connector serviceUrl must not carry credentials');
  }

  const host = url.hostname.toLowerCase();

  const allowed =
    MS_TEAMS_SERVICE_URL_ALLOWED_HOSTS.some((exact) => host === exact) ||
    MS_TEAMS_SERVICE_URL_ALLOWED_SUFFIXES.some(
      (suffix) => host === suffix.slice(1) || host.endsWith(suffix),
    );

  if (!allowed) {
    throw new Error(`Bot Connector serviceUrl host not allowed: ${host}`);
  }

  return url;
};

// ─── Requests ────────────────────────────────────────────────────────────────

const fetchWithTimeout = async (url: string, init: RequestInit): Promise<Response> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MS_TEAMS_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

// ─── Token acquisition ───────────────────────────────────────────────────────

type CachedToken = { value: string; expiresAtMs: number };

let cachedToken: CachedToken | null = null;

/** Refresh this far before actual expiry to avoid racing the boundary. */
const TOKEN_SKEW_MS = 60_000;

/** Exposed so tests can reset module state. */
export const __resetTokenCache = () => {
  cachedToken = null;
};

const tokenEndpoint = (): string => {
  const tenantId = MS_TEAMS_BOT_TENANT_ID();

  // Single-tenant bots authenticate against their own tenant; multi-tenant bots
  // use the shared botframework.com tenant.
  return tenantId
    ? `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`
    : 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';
};

export const getBotToken = async (): Promise<string> => {
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAtMs - TOKEN_SKEW_MS > now) {
    return cachedToken.value;
  }

  const appId = MS_TEAMS_BOT_APP_ID();
  const appPassword = MS_TEAMS_BOT_APP_PASSWORD();

  if (!appId || !appPassword) {
    throw new Error(
      'Microsoft Teams bot is not configured — set NEXT_PRIVATE_MS_TEAMS_BOT_APP_ID and NEXT_PRIVATE_MS_TEAMS_BOT_APP_PASSWORD.',
    );
  }

  const response = await fetchWithTimeout(tokenEndpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: appId,
      client_secret: appPassword,
      scope: MS_TEAMS_CONNECTOR_SCOPE,
    }).toString(),
  });

  if (!response.ok) {
    // Never echo the response body — it can contain the client_secret on some
    // AAD error paths.
    throw new Error(`Bot Connector token request failed with status ${response.status}`);
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };

  if (!json.access_token) {
    throw new Error('Bot Connector token response contained no access_token');
  }

  cachedToken = {
    value: json.access_token,
    expiresAtMs: Date.now() + (json.expires_in ?? 3600) * 1000,
  };

  return cachedToken.value;
};

// ─── Conversations ───────────────────────────────────────────────────────────

const conversationsBase = (serviceUrl: string, conversationId: string): string => {
  const url = assertAllowedServiceUrl(serviceUrl);
  const base = url.href.endsWith('/') ? url.href : `${url.href}/`;

  return `${base}v3/conversations/${encodeURIComponent(conversationId)}/activities`;
};

const parseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    return response.json().catch(() => null);
  }

  return response.text().catch(() => null);
};

export type BotActivityTarget = {
  serviceUrl: string;
  conversationId: string;
};

/**
 * Post a new card into a conversation. Returns the Bot Connector activity id,
 * which is what makes in-place updates (the live tracker) possible later.
 */
export const sendActivity = async (
  target: BotActivityTarget,
  message: MsTeamsMessage,
): Promise<MsTeamsSendResult> => {
  const url = conversationsBase(target.serviceUrl, target.conversationId);
  const token = await getBotToken();

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(toCardEnvelope(message)),
  });

  const body = await parseBody(response);
  const activityId =
    body && typeof body === 'object' && 'id' in body && typeof body.id === 'string'
      ? body.id
      : undefined;

  return {
    ok: response.ok,
    status: response.status,
    activityId,
    body,
    error: response.ok ? undefined : `Bot Connector send failed with status ${response.status}`,
  };
};

/**
 * Replace a previously posted activity in place. This is the whole reason the BOT
 * transport exists — webhooks cannot do it.
 */
export const updateActivity = async (
  target: BotActivityTarget & { activityId: string },
  message: MsTeamsMessage,
): Promise<MsTeamsSendResult> => {
  const url = `${conversationsBase(target.serviceUrl, target.conversationId)}/${encodeURIComponent(
    target.activityId,
  )}`;

  const token = await getBotToken();

  const response = await fetchWithTimeout(url, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ...toCardEnvelope(message), id: target.activityId }),
  });

  const body = await parseBody(response);

  return {
    ok: response.ok,
    status: response.status,
    activityId: target.activityId,
    body,
    error: response.ok ? undefined : `Bot Connector update failed with status ${response.status}`,
  };
};
