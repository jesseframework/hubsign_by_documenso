import { Trans } from '@lingui/react/macro';
import { BarChart3, FileStack, Settings, Trophy, Users, Wallet2 } from 'lucide-react';
import { Link, Outlet, redirect, useLocation } from 'react-router';

import { getSession } from '@documenso/auth/server/lib/utils/get-session';
import { isAdmin } from '@documenso/lib/utils/is-admin';
import { cn } from '@documenso/ui/lib/utils';

import type { Route } from './+types/_layout';

export async function loader({ request }: Route.LoaderArgs) {
  const { user } = await getSession(request);

  if (!user || !isAdmin(user)) {
    throw redirect('/documents');
  }
}

const navItems = [
  { to: '/admin/stats', icon: BarChart3, label: <Trans>Stats</Trans> },
  { to: '/admin/users', icon: Users, label: <Trans>Users</Trans> },
  { to: '/admin/documents', icon: FileStack, label: <Trans>Documents</Trans> },
  { to: '/admin/subscriptions', icon: Wallet2, label: <Trans>Subscriptions</Trans> },
  { to: '/admin/leaderboard', icon: Trophy, label: <Trans>Leaderboard</Trans> },
  { to: '/admin/site-settings', icon: Settings, label: <Trans>Site Settings</Trans>, match: '/admin/banner' },
];

export default function AdminLayout() {
  const { pathname } = useLocation();

  return (
    <div className="w-full">
      <h1 className="text-xl font-semibold tracking-tight">
        <Trans>Admin</Trans>
      </h1>

      <div className="mt-5 flex gap-6">
        {/* Desktop nav */}
        <div className="hidden w-[220px] flex-shrink-0 md:block">
          <div className="sticky top-20 rounded-[var(--r)] border border-border bg-card p-2">
            <nav className="flex flex-col gap-0.5">
              {navItems.map((item) => {
                const isActive = pathname?.startsWith(item.to) || (item.match && pathname?.startsWith(item.match));
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={cn(
                      'flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                      isActive && 'bg-primary/10 text-primary',
                    )}
                  >
                    <item.icon className="h-4 w-4 flex-shrink-0" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Mobile nav */}
        <div className="scrollbar-hide mb-4 flex gap-1 overflow-x-auto rounded-[var(--r)] border border-border bg-card p-1.5 md:hidden">
          {navItems.map((item) => {
            const isActive = pathname?.startsWith(item.to) || (item.match && pathname?.startsWith(item.match));
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground transition-colors',
                  isActive && 'bg-primary/10 text-primary',
                )}
              >
                <item.icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="rounded-[var(--r)] border border-border bg-card p-4 sm:p-6">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  );
}
