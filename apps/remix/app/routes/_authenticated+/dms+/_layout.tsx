import { Trans } from '@lingui/react/macro';
import { LockIcon } from 'lucide-react';
import { Link, Outlet } from 'react-router';

import { useLimits } from '@documenso/ee/server-only/limits/provider/client';
import { IS_BILLING_ENABLED } from '@documenso/lib/constants/app';
import { Button } from '@documenso/ui/primitives/button';

/**
 * Document Manager layout. The section nav now lives in the app sidebar
 * (expandable under "Doc Manager"), so this only gates access and renders the
 * page full-width.
 */
export default function DmsLayout() {
  const { quota } = useLimits();
  const isBillingEnabled = IS_BILLING_ENABLED();

  // Gate: if billing is enabled and DMS is not in the subscription, show upgrade prompt.
  if (isBillingEnabled && !quota.dmsEnabled) {
    return (
      <div className="w-full">
        <div className="flex flex-col items-center justify-center py-20">
          <div
            className="rounded-[var(--r)] border border-border bg-card p-8 text-center shadow-sm"
            style={{ maxWidth: 480 }}
          >
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <LockIcon className="h-8 w-8 text-primary" />
            </div>
            <h2 className="text-xl font-semibold">
              <Trans>Document Manager</Trans>
            </h2>
            <p className="mt-2 text-[14px] text-muted-foreground">
              <Trans>
                The Document Manager module is an enterprise add-on that provides full document
                lifecycle management — filing, retention, compliance, workflows, and more.
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
      <Outlet />
    </div>
  );
}
