import { env } from '../utils/env';

/**
 * Microsoft Teams integration configuration.
 *
 * NOTE: `constants/teams.ts` is about HubSign's own Team workspaces. Everything
 * Microsoft lives here, under the `ms-teams` name.
 *
 * The BOT transport is optional. A deployment with no Azure Bot registration
 * still gets full notification support via the WEBHOOK transport; only the live
 * tracker card and Action.Execute buttons require a bot.
 */

export const MS_TEAMS_BOT_APP_ID = () => env('NEXT_PRIVATE_MS_TEAMS_BOT_APP_ID');
export const MS_TEAMS_BOT_APP_PASSWORD = () => env('NEXT_PRIVATE_MS_TEAMS_BOT_APP_PASSWORD');

/**
 * Set only for a single-tenant bot registration. Multi-tenant bots (the default)
 * authenticate against the shared `botframework.com` tenant.
 */
export const MS_TEAMS_BOT_TENANT_ID = () => env('NEXT_PRIVATE_MS_TEAMS_BOT_TENANT_ID');

export const isMsTeamsBotConfigured = () =>
  Boolean(MS_TEAMS_BOT_APP_ID() && MS_TEAMS_BOT_APP_PASSWORD());

/** OpenID metadata whose JWKS signs inbound Bot Framework activities. */
export const MS_TEAMS_OPENID_METADATA_URL =
  'https://login.botframework.com/v1/.well-known/openidconfiguration';

/** `iss` every inbound Bot Connector token must carry. */
export const MS_TEAMS_TOKEN_ISSUER = 'https://api.botframework.com';

/** OAuth2 scope for outbound Bot Connector calls. */
export const MS_TEAMS_CONNECTOR_SCOPE = 'https://api.botframework.com/.default';

/**
 * Hosts the Bot Connector is permitted to live on.
 *
 * `serviceUrl` arrives inside an inbound activity, is persisted, and is later
 * replayed as the target of outbound requests carrying a bearer token. Without
 * an allowlist that is an SSRF + token-exfiltration primitive, so every outbound
 * call re-checks the URL even though it originally came from a signature-verified
 * activity.
 *
 * `smba.trafficmanager.net` is matched EXACTLY and never as a suffix: Azure
 * Traffic Manager hands out `*.trafficmanager.net` profiles to any customer, so
 * a `.trafficmanager.net` suffix rule would let an attacker register
 * `evil.trafficmanager.net` and defeat the guard.
 */
export const MS_TEAMS_SERVICE_URL_ALLOWED_HOSTS = [
  'smba.trafficmanager.net',
] as const;

/** Matched as `host === suffix.slice(1)` or `host.endsWith(suffix)`. */
export const MS_TEAMS_SERVICE_URL_ALLOWED_SUFFIXES = [
  '.botframework.com',
  '.skype.com',
  // US Government (GCC High / DoD) Teams clouds.
  '.gov.teams.microsoft.us',
  '.dod.teams.microsoft.us',
] as const;

/** How long a channel-linking deep link stays valid. */
export const MS_TEAMS_LINK_REQUEST_TTL_MS = 15 * 60 * 1000;

/** Outbound Bot Connector / webhook request timeout. */
export const MS_TEAMS_REQUEST_TIMEOUT_MS = 10_000;
