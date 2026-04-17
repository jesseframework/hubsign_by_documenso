import { Trans } from '@lingui/react/macro';
import {
  ActivityIcon,
  ArchiveIcon,
  CheckSquareIcon,
  ClockIcon,
  CpuIcon,
  FileSearchIcon,
  FolderTreeIcon,
  HeartIcon,
  LayoutDashboardIcon,
  ClipboardListIcon,
  LockIcon,
  BotIcon,
  SettingsIcon,
  ShieldCheckIcon,
  UploadCloudIcon,
} from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';

import { useLimits } from '@documenso/ee/server-only/limits/provider/client';
import { IS_BILLING_ENABLED } from '@documenso/lib/constants/app';
import { cn } from '@documenso/ui/lib/utils';
import { Button } from '@documenso/ui/primitives/button';

const navItems = [
  { to: '/dms', icon: LayoutDashboardIcon, label: <Trans>Dashboard</Trans>, exact: true },
  { to: '/dms/documents', icon: ArchiveIcon, label: <Trans>Documents</Trans> },
  { to: '/dms/bulk-upload', icon: UploadCloudIcon, label: <Trans>Bulk Upload</Trans> },
  { to: '/dms/ocr-queue', icon: CpuIcon, label: <Trans>OCR Queue</Trans> },
  { to: '/dms/search', icon: FileSearchIcon, label: <Trans>Search</Trans> },
  { to: '/dms/filing', icon: FolderTreeIcon, label: <Trans>Filing Structure</Trans> },
  { to: '/dms/favorites', icon: HeartIcon, label: <Trans>Favorites</Trans> },
  { to: '/dms/approvals', icon: CheckSquareIcon, label: <Trans>Approvals</Trans> },
  { to: '/dms/retrievals', icon: ClipboardListIcon, label: <Trans>Retrievals</Trans> },
  { to: '/dms/retention', icon: ClockIcon, label: <Trans>Retention</Trans> },
  { to: '/dms/activity', icon: ActivityIcon, label: <Trans>Activity</Trans> },
  { to: '/dms/compliance', icon: ShieldCheckIcon, label: <Trans>Compliance</Trans> },
  { to: '/dms/ai', icon: BotIcon, label: <Trans>AI Agent</Trans> },
  { to: '/dms/settings', icon:
SettingsIcon, label: <Trans>Settings</Trans> },
];

export default function DmsLayout() {
  const { pathname } = useLocation();
  const { quota } = useLimits();
  const isBillingEnabled = IS_BILLING_ENABLED();

  // Gate: if billing is enabled and DMS is not in the subscription, show upgrade prompt
  if (isBillingEnabled && !quota.dmsEnabled) {
    return (
      <div className="w-full">
        <div className="flex flex-col items-center justify-center py-20">
          <div className="rounded-[var(--r)] border border-border bg-card p-8 text-center shadow-sm" style={{ maxWidth: 480 }}>
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <LockIcon className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold">
              <Trans>Document Manager</Trans>
            </h2>
            <p className="mt-2 text-[14px] text-muted-foreground">
              <Trans>
                The Document Manager module is an enterprise add-on that provides full document lifecycle management — filing, retention, compliance, workflows, and more.
              </Trans>
            </p>
            <div className="mt-6">
              <Button asChild>
                <Link to="/settings/billing">
                  <Trans>Upgrade Your Plan</Trans>
                </Link>
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              <Trans>Contact sales for enterprise pricing.</Trans>
            </p>
          </div>
        </div>
      </div>
    );
  }

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
