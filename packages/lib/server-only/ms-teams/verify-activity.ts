/**
 * Inbound Bot Framework activity authentication.
 *
 * Every request to /api/ms-teams/messages is unauthenticated by default — the
 * endpoint is public, and anyone can POST arbitrary JSON at it. The only thing
 * separating a real Teams activity from a forgery is the bearer token, so this
 * module is a hard security boundary. Do not weaken it.
 *
 * Checks performed, all of which must pass:
 *   1. RS256 signature against the Bot Framework JWKS.
 *   2. `iss` === https://api.botframework.com
 *   3. `aud` === our Microsoft App ID
 *   4. `exp` / `nbf` (with a small clock skew)
 *   5. the `serviceurl` claim matches the activity's `serviceUrl`
 *
 * Check 5 is the one that is easy to omit and expensive to skip: without it, a
 * caller holding *any* validly-signed Bot Framework token could hand us an
 * activity pointing `serviceUrl` at a host they control, and our outbound reply
 * would carry our bot's bearer token straight to them. `assertAllowedServiceUrl`
 * in bot-connector.ts is the second line of defence for exactly this.
 *
 * Reference: https://learn.microsoft.com/azure/bot-service/rest-api/bot-framework-rest-connector-authentication
 */
import { type JWTPayload, createRemoteJWKSet, jwtVerify } from 'jose';

import {
  MS_TEAMS_BOT_APP_ID,
  MS_TEAMS_OPENID_METADATA_URL,
  MS_TEAMS_TOKEN_ISSUER,
} from '../../constants/ms-teams';
import type { TMsTeamsActivity } from '../../types/ms-teams';

/** `jose` caches keys and handles rotation/cooldown internally; build it once. */
let jwksPromise: Promise<ReturnType<typeof createRemoteJWKSet>> | null = null;

/** Exposed so tests can reset module state. */
export const __resetJwksCache = () => {
  jwksPromise = null;
};

const getJwks = async () => {
  if (jwksPromise) {
    return jwksPromise;
  }

  jwksPromise = (async () => {
    const response = await fetch(MS_TEAMS_OPENID_METADATA_URL);

    if (!response.ok) {
      throw new Error(`Failed to fetch Bot Framework OpenID metadata: ${response.status}`);
    }

    const metadata = (await response.json()) as { jwks_uri?: string };

    if (!metadata.jwks_uri) {
      throw new Error('Bot Framework OpenID metadata contained no jwks_uri');
    }

    return createRemoteJWKSet(new URL(metadata.jwks_uri));
  })();

  // A transient failure must not poison the cache for the process lifetime.
  jwksPromise.catch(() => {
    jwksPromise = null;
  });

  return jwksPromise;
};

/** Trailing slashes and case differ between the claim and the activity. */
const normalizeServiceUrl = (value: string) => value.trim().toLowerCase().replace(/\/+$/, '');

export class MsTeamsAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MsTeamsAuthError';
  }
}

/**
 * Verify the `Authorization` header of an inbound activity.
 *
 * @throws {MsTeamsAuthError} if the token is absent, malformed, or fails any check.
 */
export const verifyMsTeamsActivity = async ({
  authorizationHeader,
  activity,
}: {
  authorizationHeader: string | null | undefined;
  activity: TMsTeamsActivity;
}): Promise<JWTPayload> => {
  const appId = MS_TEAMS_BOT_APP_ID();

  if (!appId) {
    throw new MsTeamsAuthError('Microsoft Teams bot is not configured');
  }

  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader?.trim() ?? '');

  if (!match) {
    throw new MsTeamsAuthError('Missing or malformed Authorization header');
  }

  const token = match[1];

  let payload: JWTPayload;

  try {
    ({ payload } = await jwtVerify(token, await getJwks(), {
      issuer: MS_TEAMS_TOKEN_ISSUER,
      audience: appId,
      algorithms: ['RS256'],
      clockTolerance: 60,
    }));
  } catch (err) {
    throw new MsTeamsAuthError(
      `Bot Framework token verification failed: ${err instanceof Error ? err.message : 'unknown error'}`,
    );
  }

  // The claim is lowercase `serviceurl`, not `serviceUrl`.
  const claimed = payload.serviceurl;

  if (typeof claimed !== 'string') {
    throw new MsTeamsAuthError('Bot Framework token is missing the serviceurl claim');
  }

  if (normalizeServiceUrl(claimed) !== normalizeServiceUrl(activity.serviceUrl)) {
    throw new MsTeamsAuthError('Bot Framework token serviceurl claim does not match the activity');
  }

  return payload;
};
