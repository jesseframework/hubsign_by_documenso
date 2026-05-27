import type { Context } from 'hono';
import { redirect } from 'react-router';

import { AppError } from '@documenso/lib/errors/app-error';

import { AuthenticationErrorCode } from '../errors/error-codes';
import type { SessionValidationResult } from '../session/session';
import { validateSessionToken } from '../session/session';
import { getSessionCookie } from '../session/session-cookies';

export const getSession = async (c: Context | Request) => {
  const ctx = mapRequestToContextForCookie(c);
  const sessionId = await getSessionCookie(ctx);
  const { session, user } = sessionId
    ? await validateSessionToken(sessionId)
    : { session: null, user: null };

  if (session && user) {
    return { session, user };
  }

  if (c instanceof Request) {
    // For tRPC / API routes, throw an AppError so the tRPC error handler can
    // serialize it as a 401 — throwing a redirect Response here would crash tRPC.
    // For page loaders, redirect to signin. Only show the "session ended"
    // banner when a session cookie was actually present (the user had a
    // session that's now invalid). For users with no cookie — never signed
    // in, explicitly signed out, or arriving from a password-reset email —
    // a plain /signin avoids the misleading expiry message.
    const url = new URL(c.url);
    const isApiRoute =
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/trpc/');

    if (isApiRoute) {
      throw new AppError(AuthenticationErrorCode.Unauthorized);
    }

    throw redirect(sessionId ? '/signin?reason=session-ended' : '/signin');
  }

  throw new AppError(AuthenticationErrorCode.Unauthorized);
};

export const getOptionalSession = async (
  c: Context | Request,
): Promise<SessionValidationResult> => {
  const sessionId = await getSessionCookie(mapRequestToContextForCookie(c));

  if (!sessionId) {
    return {
      isAuthenticated: false,
      session: null,
      user: null,
    };
  }

  return await validateSessionToken(sessionId);
};

/**
 * Todo: (RR7) Rethink, this is pretty sketchy.
 */
const mapRequestToContextForCookie = (c: Context | Request) => {
  if (c instanceof Request) {
    const partialContext = {
      req: {
        raw: c,
      },
    };

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    return partialContext as unknown as Context;
  }

  return c;
};
