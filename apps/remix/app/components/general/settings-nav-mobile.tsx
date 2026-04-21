import { Trans } from '@lingui/react/macro';
import { Bell, Braces, CreditCard, Globe2Icon, Lock, User, Users, Webhook } from 'lucide-react';
import { Link, useLocation } from 'react-router';

import { IS_BILLING_ENABLED } from '@documenso/lib/constants/app';
import { cn } from '@documenso/ui/lib/utils';

const navItems = [
  { to: '/settings/profile', icon: User, label: <Trans>Profile</Trans> },
  { to: '/settings/public-profile', icon: Globe2Icon, label: <Trans>Public Profile</Trans> },
  { to: '/settings/teams', icon: Users, label: <Trans>Teams</Trans> },
  { to: '/settings/security', icon: Lock, label: <Trans>Security</Trans> },
  { to: '/settings/notifications', icon: Bell, label: <Trans>Notifications</Trans> },
  { to: '/settings/tokens', icon: Braces, label: <Trans>API Tokens</Trans> },
  { to: '/settings/webhooks', icon: Webhook, label: <Trans>Webhooks</Trans> },
];

export const SettingsMobileNav = () => {
  const { pathname } = useLocation();
  const isBillingEnabled = IS_BILLING_ENABLED();

  const allItems = isBillingEnabled
    ? [...navItems, { to: '/settings/billing', icon: CreditCard, label: <Trans>Billing</Trans> }]
    : navItems;

  return (
    <div className="scrollbar-hide flex gap-1 overflow-x-auto rounded-[var(--r)] border border-border bg-card p-1.5">
      {allItems.map((item) => {
        const isActive = pathname?.startsWith(item.to);
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
  );
};
