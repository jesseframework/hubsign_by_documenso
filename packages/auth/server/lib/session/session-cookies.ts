import type { Context } from 'hono';
import { deleteCookie, getSignedCookie, setSignedCookie } from 'hono/cookie';

import {
  formatSecureCookieName,
  getCookieDomain,
  useSecureCookies,
} from '@documenso/lib/constants/auth';
import { appLog } from '@documenso/lib/utils/debugger';
import { env } from '@documenso/lib/utils/env';

import { AUTH_SESSION_LIFETIME } from '../../config';
import { extractCookieFromHeaders } from '../utils/cookies';
import { generateSessionToken } from './session';

export const sessionCookieName = formatSecureCookieName('sessionId');
export const csrfCookieName = formatSecureCookieName('csrfToken');

const getAuthSecret = () => {
  const authSecret = env('NEXTAUTH_SECRET');

  if (!authSecret) {
    throw new Error('NEXTAUTH_SECRET is not set');
  }

  return authSecret;
};

/**
 * Generic auth cookie options.
 *
 * Deliberately has NO `expires`: a date computed here would be evaluated once,
 * when the module loads, and every cookie issued after the process had been up
 * for AUTH_SESSION_LIFETIME (30 days) would arrive already expired — the browser
 * drops it and the user lands back on /signin after a "successful" sign-in.
 * Use `getSessionCookieOptions()` for the session cookie, which stamps the
 * expiry at the moment the cookie is set.
 */
export const sessionCookieOptions = {
  httpOnly: true,
  path: '/',
  sameSite: useSecureCookies ? 'none' : 'lax',
  secure: useSecureCookies,
  domain: getCookieDomain(),
} as const;

/** Session cookie options with an expiry computed now, not at module load. */
export const getSessionCookieOptions = (now: number = Date.now()) =>
  ({
    ...sessionCookieOptions,
    expires: new Date(now + AUTH_SESSION_LIFETIME),
  }) as const;

export const extractSessionCookieFromHeaders = (headers: Headers): string | null => {
  return extractCookieFromHeaders(sessionCookieName, headers);
};

/**
 * Get the session cookie attached to the request headers.
 *
 * @param c - The Hono context.
 * @returns The session ID or null if no session cookie is found.
 */
export const getSessionCookie = async (c: Context): Promise<string | null> => {
  const sessionId = await getSignedCookie(c, getAuthSecret(), sessionCookieName);

  return sessionId || null;
};

/**
 * Set the session cookie into the Hono context.
 *
 * @param c - The Hono context.
 * @param sessionToken - The session token to set.
 */
export const setSessionCookie = async (c: Context, sessionToken: string) => {
  await setSignedCookie(
    c,
    sessionCookieName,
    sessionToken,
    getAuthSecret(),
    getSessionCookieOptions(),
  ).catch((err) => {
    appLog('SetSessionCookie', `Error setting signed cookie: ${err}`);

    throw err;
  });
};

/**
 * Set the session cookie into the Hono context.
 *
 * @param c - The Hono context.
 * @param sessionToken - The session token to set.
 */
export const deleteSessionCookie = (c: Context) => {
  deleteCookie(c, sessionCookieName, sessionCookieOptions);
};

export const getCsrfCookie = async (c: Context) => {
  const csrfToken = await getSignedCookie(c, getAuthSecret(), csrfCookieName);

  return csrfToken || null;
};

export const setCsrfCookie = async (c: Context) => {
  const csrfToken = generateSessionToken();

  await setSignedCookie(c, csrfCookieName, csrfToken, getAuthSecret(), {
    ...sessionCookieOptions,

    // Explicity set to undefined for session lived cookie.
    expires: undefined,
    maxAge: undefined,
  });

  return csrfToken;
};
