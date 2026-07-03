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
 * Admin layout. The section nav now lives in the app sidebar (expandable under
 * "Admin"); this keeps the admin gate and the content card wrapper.
 */
export default function AdminLayout() {
  return (
    <div className="w-full">
      <div className="rounded-[var(--r)] border border-border bg-card p-4 sm:p-6">
        <Outlet />
      </div>
    </div>
  );
}
