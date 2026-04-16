import { Trans } from '@lingui/react/macro';
import {
  CreditCardIcon,
  UsersIcon,
  ArchiveIcon,
  CheckCircleIcon,
} from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Organization Billing');
}

export default function OrgBillingPage() {
  const { data: membership, isLoading } = trpc.org.getMyOrganization.useQuery();

  if (isLoading) {
    return <div className="py-12 text-center text-muted-foreground">Loading...</div>;
  }

  if (!membership) {
    return (
      <div className="py-12 text-center text-muted-foreground">
        <CreditCardIcon className="mx-auto mb-3 h-10 w-10 opacity-30" />
        <p><Trans>Create an organization first.</Trans></p>
      </div>
    );
  }

  const org = membership.organization;
  const isAdmin = membership.role === 'ORG_ADMIN';
  const memberCount = org.members.length;
  const seatPrice = 25;
  const dmsPrice = 15;
  const totalMonthly = (memberCount * seatPrice) + dmsPrice;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold"><Trans>Organization Billing</Trans></h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          <Trans>Manage billing for {org.name}. Per-seat pricing with DMS add-on.</Trans>
        </p>
      </div>

      {/* Current Plan Summary */}
      <div className="rounded-[var(--r)] border border-border bg-card p-5">
        <h3 className="text-[15px] font-semibold"><Trans>Current Plan</Trans></h3>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2 text-primary">
              <UsersIcon className="h-4 w-4" />
              <span className="text-[11px] font-semibold uppercase">Seats</span>
            </div>
            <p className="mt-2 text-2xl font-semibold">{memberCount}</p>
            <p className="text-[11px] text-muted-foreground">${seatPrice}/seat/month</p>
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2 text-green-600">
              <ArchiveIcon className="h-4 w-4" />
              <span className="text-[11px] font-semibold uppercase">DMS</span>
            </div>
            <p className="mt-2 text-2xl font-semibold">Active</p>
            <p className="text-[11px] text-muted-foreground">${dmsPrice}/month flat</p>
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2 text-amber-600">
              <CreditCardIcon className="h-4 w-4" />
              <span className="text-[11px] font-semibold uppercase">Monthly</span>
            </div>
            <p className="mt-2 text-2xl font-semibold">${totalMonthly}</p>
            <p className="text-[11px] text-muted-foreground">
              ({memberCount} × ${seatPrice}) + ${dmsPrice}
            </p>
          </div>

          <div className="rounded-md border border-border p-3">
            <div className="flex items-center gap-2 text-blue-600">
              <CheckCircleIcon className="h-4 w-4" />
              <span className="text-[11px] font-semibold uppercase">Annual</span>
            </div>
            <p className="mt-2 text-2xl font-semibold">${Math.round(totalMonthly * 10)}</p>
            <p className="text-[11px] text-muted-foreground">Save ~17% with annual</p>
          </div>
        </div>
      </div>

      {/* Seat Details */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-[14px] font-semibold"><Trans>Seat Allocation</Trans></h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <Trans>Each member in your organization uses one seat. Add or remove members from the Members page.</Trans>
          </p>
        </div>

        <div className="divide-y divide-border">
          {org.members.map((member) => (
            <div key={member.id} className="flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {(member.user.name || member.user.email)[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-[13px] font-medium">{member.user.name || 'Unnamed'}</p>
                  <p className="text-[11px] text-muted-foreground">{member.user.email}</p>
                </div>
              </div>
              <div className="text-right">
                <span className="text-[12px] font-medium">${seatPrice}/mo</span>
                <p className="text-[10px] text-muted-foreground">{member.role.replace(/_/g, ' ')}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-3">
          <span className="text-[13px] font-semibold">Total</span>
          <span className="text-[14px] font-semibold">${memberCount * seatPrice}/month for {memberCount} seats</span>
        </div>
      </div>

      {/* Pricing Breakdown */}
      <div className="rounded-[var(--r)] border border-border bg-card p-5">
        <h3 className="text-[15px] font-semibold"><Trans>Pricing Details</Trans></h3>

        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <span className="text-[13px]">HubSign Organization Seat</span>
            <span className="text-[13px] font-medium">${seatPrice}/user/month</span>
          </div>
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <span className="text-[13px]">Document Manager (DMS) Add-On</span>
            <span className="text-[13px] font-medium">${dmsPrice}/month (flat)</span>
          </div>
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <span className="text-[13px] text-muted-foreground">Includes</span>
            <span className="text-[12px] text-muted-foreground">Unlimited documents, filing, workflows, compliance</span>
          </div>
        </div>

        {isAdmin && (
          <div className="mt-4 flex gap-2">
            <Button asChild>
              <a href="/settings/billing">
                <Trans>Manage Subscription</Trans>
              </a>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
