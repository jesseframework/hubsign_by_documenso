import type { Context } from 'hono';
import { redirect } from 'react-router';

import { AppError } from '@documenso/lib/errors/app-error';

import { AuthenticationErrorCode } from '../errors/error-codes';
import type { SessionValidationResult } from '../session/session';
import { validateSessionToken } from '../session/session';
import { getSessionCookie } from '../session/session-cookies';

export const getSession = async (c: Context | Request) => {
  const { session, user } = await getOptionalSession(mapRequestToContextForCookie(c));

  if (session && user) {
    return { session, user };
  }

  if (c instanceof Request) {
    // For tRPC / API routes, throw an AppError so the tRPC error handler can
    // serialize it as a 401 — throwing a redirect Response here would crash tRPC.
    // For page loaders, throw a redirect to the signin page so the user gets a
    // friendly "session ended" banner instead of a 500 error.
    const url = new URL(c.url);
    const isApiRoute =
      url.pathname.startsWith('/api/') ||
      url.pathname.startsWith('/trpc/');

    if (isApiRoute) {
      throw new AppError(AuthenticationErrorCode.Unauthorized);
    }

    throw redirect('/signin?reason=session-ended');
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
