import { Trans } from '@lingui/react/macro';
import {
  BuildingIcon,
  CreditCardIcon,
  SettingsIcon,
  ShieldIcon,
  Trash2Icon,
  UsersIcon,
} from 'lucide-react';
import { Link, Outlet, useLocation } from 'react-router';

import { cn } from '@documenso/ui/lib/utils';

const navItems = [
  { to: '/org/settings', icon: BuildingIcon, label: <Trans>Settings</Trans> },
  { to: '/org/members', icon: UsersIcon, label: <Trans>Members</Trans> },
  { to: '/org/permissions', icon: ShieldIcon, label: <Trans>DMS Permissions</Trans> },
  { to: '/org/billing', icon: CreditCardIcon, label: <Trans>Billing</Trans> },
  { to: '/org/recycle-bin', icon: Trash2Icon, label: <Trans>Recycle Bin</Trans> },
];

export default function OrgLayout() {
  const { pathname } = useLocation();

  return (
    <div className="w-full">
      <h1 className="text-xl font-semibold tracking-tight">
        <Trans>Organization</Trans>
      </h1>

      <div className="mt-5 flex gap-6">
        <div className="hidden w-[200px] flex-shrink-0 md:block">
          <div className="sticky top-20 rounded-[var(--r)] border border-border bg-card p-2">
            <nav className="flex flex-col gap-0.5">
              {navItems.map((item) => {
                const isActive = pathname.startsWith(item.to);
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

        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
