import { Outlet, redirect } from 'react-router';

import { getSession } from '@documenso/auth/server/lib/utils/get-session';
import { isAdmin } from '@documenso/lib/utils/is-admin';

import type { Route } from './+types/_layout';

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await getSession(request);

  if (!user || !isAdmin(user)) {
    throw redirect('/documents');
  }
}

/**
 * Admin layout. Keeps the admin gate; the rail, content card and the chrome
 * that marks this as a separate platform-level context come from `ConsoleShell`.
 */
export default function AdminLayout() {
  return <Outlet />;
}
