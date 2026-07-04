import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import React from 'react';

import type { Session } from '@prisma/client';
import { useLocation } from 'react-router';

import { authClient } from '@documenso/auth/client';
import type { SessionUser } from '@documenso/auth/server/lib/session/session';
import { type TGetTeamsResponse } from '@documenso/lib/server-only/team/get-teams';
import { trpc } from '@documenso/trpc/client';

export type AppSession = {
  session: Session;
  user: SessionUser;
  teams: TGetTeamsResponse;
};

interface SessionProviderProps {
  children: React.ReactNode;
  initialSession: AppSession | null;
}

interface SessionContextValue {
  sessionData: AppSession | null;
  refreshSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export const useSession = () => {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }

  if (!context.sessionData) {
    throw new Error('Session not found');
  }

  return {
    ...context.sessionData,
    refreshSession: context.refreshSession,
  };
};

export const useOptionalSession = () => {
  const context = useContext(SessionContext);

  if (!context) {
    throw new Error('useOptionalSession must be used within a SessionProvider');
  }

  return context;
};

export const SessionProvider = ({ children, initialSession }: SessionProviderProps) => {
  const [session, setSession] = useState<AppSession | null>(initialSession);

  const location = useLocation();

  const refreshSession = useCallback(async () => {
    const newSession = await authClient.getSession();

    if (!newSession.isAuthenticated) {
      // Session was lost mid-app (expired, signed out, or kicked out by single-session
      // enforcement). Redirect to signin with a friendly reason instead of letting
      // useSession() throw "Session not found" which crashes the React tree.
      if (typeof window !== 'undefined') {
        const path = window.location.pathname;
        // Pages where this redirect should NOT fire:
        // - Auth pages (signin/signup/forgot/reset/verify) — already public
        // - Unverified account page — reached after a signin attempt with an
        //   unverified email; the user isn't authenticated yet so this check
        //   would otherwise immediately bounce them back to signin
        // - Recipient signing routes (/sign/...) — recipients aren't logged in
        // - Public share routes (/share/...) — public access
        // - Internal htmltopdf routes (/__htmltopdf/*) — server-side rendered
        //   for cert/audit-log generation by Playwright with no session
        const isPublicRoute =
          path.startsWith('/signin') ||
          path.startsWith('/signup') ||
          path.startsWith('/forgot-password') ||
          path.startsWith('/reset-password') ||
          path.startsWith('/verify-email') ||
          path.startsWith('/unverified-account') ||
          path.startsWith('/sign/') ||
          path.startsWith('/share/') ||
          path.startsWith('/__htmltopdf');

        if (!isPublicRoute) {
          window.location.href = '/signin?reason=session-ended';
          return;
        }
      }
      setSession(null);
      return;
    }

    const teams = await trpc.team.getTeams.query().catch(() => {
      // Todo: (RR7) Log
      return [];
    });

    setSession({
      session: newSession.session,
      user: newSession.user,
      teams,
    });
  }, []);

  useEffect(() => {
    const onFocus = () => {
      void refreshSession();
    };

    window.addEventListener('focus', onFocus);

    return () => {
      window.removeEventListener('focus', onFocus);
    };
  }, [refreshSession]);

  /**
   * Refresh session in background on navigation.
   */
  useEffect(() => {
    void refreshSession();
  }, [location.pathname]);

  return (
    <SessionContext.Provider
      value={{
        sessionData: session,
        refreshSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};
