import { Trans } from '@lingui/react/macro';
import { Braces, CreditCard, Globe2Icon, Lock, User, Users, Webhook } from 'lucide-react';
import { useLocation, Link } from 'react-router';

import { IS_BILLING_ENABLED } from '@documenso/lib/constants/app';
import { cn } from '@documenso/ui/lib/utils';

const navItems = [
  { to: '/settings/profile', icon: User, label: <Trans>Profile</Trans> },
  { to: '/settings/public-profile', icon: Globe2Icon, label: <Trans>Public Profile</Trans> },
  { to: '/settings/teams', icon: Users, label: <Trans>Teams</Trans> },
  { to: '/settings/security', icon: Lock, label: <Trans>Security</Trans> },
  { to: '/settings/tokens', icon: Braces, label: <Trans>API Tokens</Trans> },
  { to: '/settings/webhooks', icon: Webhook, label: <Trans>Webhooks</Trans> },
];

export const SettingsDesktopNav = () => {
  const { pathname } = useLocation();
  const isBillingEnabled = IS_BILLING_ENABLED();

  const allItems = isBillingEnabled
    ? [...navItems, { to: '/settings/billing', icon: CreditCard, label: <Trans>Billing</Trans> }]
    : navItems;

  return (
    <nav className="flex flex-col gap-0.5">
      {allItems.map((item) => {
        const isActive = pathname?.startsWith(item.to);
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
  );
};
