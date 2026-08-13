import { createCookie } from 'react-router';

import { useSecureCookies } from '@documenso/lib/constants/auth';

export const langCookie = createCookie('lang', {
  path: '/',
  maxAge: 60 * 60 * 24 * 365 * 2,
  httpOnly: true,
  sameSite: 'lax',
  // Shares the rule with the session cookies rather than checking NODE_ENV,
  // which is unset in the production container — see `useSecureCookies`.
  secure: useSecureCookies,
});
