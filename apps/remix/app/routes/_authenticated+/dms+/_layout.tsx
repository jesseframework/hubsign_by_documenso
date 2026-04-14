import { Trans } from '@lingui/react/macro';
import {
  ActivityIcon,
  ArchiveIcon,
  CheckSquareIcon,
  ClockIcon,
  FileSearchIcon,
  FolderTreeIcon,
  HeartIcon,
  LayoutDashboardIcon,
  ClipboardListIcon,
  SettingsIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';

import { cn } from '@documenso/ui/lib/utils';

const navItems = [
  { to: '/dms', icon: LayoutDashboardIcon, label: <Trans>Dashboard</Trans>, exact: true },
  { to: '/dms/documents', icon: ArchiveIcon, label: <Trans>Documents</Trans> },
  { to: '/dms/search', icon: FileSearchIcon, label: <Trans>Search</Trans> },
  { to: '/dms/filing', icon: FolderTreeIcon, label: <Trans>Filing Structure</Trans> },
  { to: '/dms/favorites', icon: HeartIcon, label: <Trans>Favorites</Trans> },
  { to: '/dms/approvals', icon: CheckSquareIcon, label: <Trans>Approvals</Trans> },
  { to: '/dms/retrievals', icon: ClipboardListIcon, label: <Trans>Retrievals</Trans> },
  { to: '/dms/retention', icon: ClockIcon, label: <Trans>Retention</Trans> },
  { to: '/dms/activity', icon: ActivityIcon, label: <Trans>Activity</Trans> },
  { to: '/dms/compliance', icon: ShieldCheckIcon, label: <Trans>Compliance</Trans> },
  { to: '/dms/settings', icon: SettingsIcon, label: <Trans>Settings</Trans> },
];

export default function DmsLayout() {
  const { pathname } = useLocation();

  return (
    <div className="w-full">
      <h1 className="text-xl font-semibold tracking-tight">
        <Trans>Document Manager</Trans>
      </h1>

      <div className="mt-5 flex gap-6">
        {/* Desktop nav */}
        <div className="hidden w-[200px] flex-shrink-0 md:block">
          <div className="sticky top-20 rounded-[var(--r)] border border-border bg-card p-2">
            <nav className="flex flex-col gap-0.5">
              {navItems.map((item) => {
                const isActive = item.exact
                  ? pathname === item.to
                  : pathname.startsWith(item.to);
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
        <div className="scrollbar-hide mb-4 w-full overflow-x-auto md:hidden">
          <div className="inline-flex gap-1 rounded-[var(--r)] border border-border bg-card p-1.5">
            {navItems.map((item) => {
              const isActive = item.exact
                ? pathname === item.to
                : pathname.startsWith(item.to);
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
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
