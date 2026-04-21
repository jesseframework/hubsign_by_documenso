import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  ArchiveIcon,
  CheckCircleIcon,
  CreditCardIcon,
  PlusIcon,
  UsersIcon,
} from 'lucide-react';
import { useSearchParams } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Organization Billing');
}

const TIER_CONFIG = {
  STARTER: { name: 'Starter', price: 15, docs: 20, color: 'text-blue-600', minSeats: 2 },
  PRO: { name: 'Pro', price: 25, docs: 100, color: 'text-purple-600', minSeats: 1 },
  ENTERPRISE: { name: 'Enterprise', price: 45, docs: '∞', color: 'text-amber-600', minSeats: 5 },
};

export default function OrgBillingPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();
  const [searchParams, setSearchParams] = useSearchParams();

  // Handle Stripe redirect results
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      toast({ title: _(msg`Payment successful! Your seats have been activated.`) });
      void utils.org.getSeatPlans.invalidate();
      void utils.org.getMyOrganization.invalidate();
      setSearchParams({}, { replace: true });
    } else if (searchParams.get('canceled') === 'true') {
      toast({ title: _(msg`Payment canceled`), variant: 'destructive' });
      setSearchParams({}, { replace: true });
    }
  }, []);

  const { data: membership, isLoading } = trpc.org.getMyOrganization.useQuery();
  const { data: seatPlans } = trpc.org.getSeatPlans.useQuery();
  const setupBilling = trpc.org.setupBilling.useMutation();
  const manageBilling = trpc.org.manageBilling.useMutation();

  const [buyTier, setBuyTier] = useState<string>('PRO');
  const [buyQty, setBuyQty] = useState(1);
  const [buyDms, setBuyDms] = useState(false);
  const [showBuy, setShowBuy] = useState(false);

  const purchaseSeats = trpc.org.purchaseSeats.useMutation({
    onSuccess: (result) => {
      void utils.org.getSeatPlans.invalidate();
      void utils.org.getMyOrganization.invalidate();

      // If Stripe returned a checkout URL, redirect to it
      if (result && typeof result === 'object' && 'url' in result && result.url) {
        window.location.href = result.url as string;
        return;
      }

      setShowBuy(false);
      setBuyQty(1);
      setBuyDms(false);
      toast({ title: _(msg`Seats purchased`) });
    },
  });

  const assignSeat = trpc.org.assignSeat.useMutation({
    onSuccess: () => {
      void utils.org.getMyOrganization.invalidate();
      void utils.org.getSeatPlans.invalidate();
      toast({ title: _(msg`Seat assigned`) });
    },
    onError: (err) => {
      toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' });
    },
  });

  if (isLoading) return <div className="py-12 text-center text-muted-foreground">Loading...</div>;

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

  // Calculate totals
  const totalSeats = seatPlans?.reduce((sum, p) => sum + p.quantity, 0) ?? 0;
  const assignedSeats = seatPlans?.reduce((sum, p) => sum + p.assigned, 0) ?? 0;
  const monthlyTotal = seatPlans?.reduce((sum, p) => sum + (TIER_CONFIG[p.tier as keyof typeof TIER_CONFIG]?.price ?? 0) * p.quantity, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold"><Trans>Organization Billing</Trans></h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          <Trans>Purchase seats and assign plans to members.</Trans>
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-[var(--r)] border border-border bg-card p-3">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">Total Seats</span>
          <p className="mt-1 text-2xl font-semibold">{totalSeats}</p>
        </div>
        <div className="rounded-[var(--r)] border border-border bg-card p-3">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">Assigned</span>
          <p className="mt-1 text-2xl font-semibold">{assignedSeats} / {totalSeats}</p>
        </div>
        <div className="rounded-[var(--r)] border border-border bg-card p-3">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">Available</span>
          <p className="mt-1 text-2xl font-semibold text-green-600">{totalSeats - assignedSeats}</p>
        </div>
        <div className="rounded-[var(--r)] border border-border bg-card p-3">
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">Monthly</span>
          <p className="mt-1 text-2xl font-semibold">${monthlyTotal}</p>
        </div>
      </div>

      {/* Seat Plans */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="text-[14px] font-semibold"><Trans>Seat Plans</Trans></h3>
          {isAdmin && (
            <Button size="sm" className="gap-1.5" onClick={() => setShowBuy(true)}>
              <PlusIcon className="h-3.5 w-3.5" />
              Purchase Seats
            </Button>
          )}
        </div>

        {/* Purchase form */}
        {showBuy && (
          <div className="border-b border-border bg-muted/30 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Plan Tier</label>
                <select
                  className="mt-1 block h-8 rounded-md border border-border bg-background px-2 text-[13px]"
                  value={buyTier}
                  onChange={(e) => {
                    const newTier = e.target.value as keyof typeof TIER_CONFIG;
                    setBuyTier(newTier);
                    // Enterprise always includes DMS
                    if (newTier === 'ENTERPRISE') setBuyDms(true);
                    // Enforce minimum seats for the selected tier
                    const minSeats = TIER_CONFIG[newTier]?.minSeats ?? 1;
                    if (buyQty < minSeats) setBuyQty(minSeats);
                  }}
                >
                  <option value="STARTER">Starter — $15/seat/mo (20 docs, min 2 seats)</option>
                  <option value="PRO">Pro — $25/seat/mo (100 docs, min 1 seat)</option>
                  <option value="ENTERPRISE">Enterprise — $45/seat/mo (unlimited + DMS, min 5 seats)</option>
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  Quantity (min {TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.minSeats ?? 1})
                </label>
                <Input
                  className="mt-1 h-8 w-20 text-[13px]"
                  type="number"
                  min={TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.minSeats ?? 1}
                  max={100}
                  value={buyQty}
                  onChange={(e) => setBuyQty(Number(e.target.value))}
                />
              </div>
              {buyTier !== 'ENTERPRISE' && (
                <label className="flex items-center gap-1.5 text-[12px]">
                  <input
                    type="checkbox"
                    checked={buyDms}
                    onChange={(e) => setBuyDms(e.target.checked)}
                    className="rounded"
                  />
                  <span className="font-medium text-muted-foreground">+ DMS Add-On ($15/seat/mo)</span>
                </label>
              )}
              <div className="text-[13px] font-medium text-muted-foreground">
                = ${buyQty * ((TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.price ?? 0) + (buyDms && buyTier !== 'ENTERPRISE' ? 15 : 0))}/month
              </div>
              <Button
                size="sm"
                onClick={() => {
                  const minSeats = TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.minSeats ?? 1;
                  const finalQty = Math.max(buyQty, minSeats);
                  void purchaseSeats.mutateAsync({
                    tier: buyTier as 'STARTER' | 'PRO' | 'ENTERPRISE',
                    quantity: finalQty,
                    dmsEnabled: buyTier === 'ENTERPRISE' ? true : buyDms,
                  });
                }}
                loading={purchaseSeats.isPending}
                disabled={buyQty < (TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.minSeats ?? 1)}
              >
                Purchase
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowBuy(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Plans table */}
        {seatPlans && seatPlans.length > 0 ? (
          <div className="divide-y divide-border">
            {seatPlans.map((plan) => {
              const config = TIER_CONFIG[plan.tier as keyof typeof TIER_CONFIG];
              return (
                <div key={plan.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`text-[14px] font-semibold ${config?.color || ''}`}>
                      {config?.name || plan.tier}
                    </div>
                    <span className="text-[12px] text-muted-foreground">
                      ${config?.price}/seat/mo · {config?.docs} docs/mo
                      {plan.dmsEnabled && ' · DMS included'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <span className="text-[13px] font-medium">{plan.assigned} / {plan.quantity} assigned</span>
                      <p className="text-[11px] text-muted-foreground">
                        {plan.quantity - plan.assigned} available
                      </p>
                    </div>
                    <span className="text-[13px] font-semibold">
                      ${(config?.price ?? 0) * plan.quantity}/mo
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="py-8 text-center text-[13px] text-muted-foreground">
            No seats purchased yet. Click "Purchase Seats" to get started.
          </div>
        )}
      </div>

      {/* Member Seat Assignment */}
      <div className="rounded-[var(--r)] border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-[14px] font-semibold"><Trans>Member Seat Assignment</Trans></h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <Trans>Assign a plan tier to each member. Members without a seat have no access.</Trans>
          </p>
        </div>

        <div className="divide-y divide-border">
          {org.members.map((member) => (
            <div key={member.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {(member.user.name || member.user.email)[0].toUpperCase()}
                </div>
                <div>
                  <p className="text-[13px] font-medium">{member.user.name || member.user.email}</p>
                  <p className="text-[10px] text-muted-foreground">{member.role.replace(/_/g, ' ')}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {member.seatTier ? (
                  <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                    member.seatTier === 'ENTERPRISE' ? 'bg-amber-50 text-amber-700'
                    : member.seatTier === 'PRO' ? 'bg-purple-50 text-purple-700'
                    : 'bg-blue-50 text-blue-700'
                  }`}>
                    {member.seatTier}
                    {member.dmsAddon && ' + DMS'}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">No seat</span>
                )}

                {isAdmin && (
                  <>
                    <select
                      className="h-7 rounded-md border border-border bg-background px-2 text-[11px]"
                      value={member.seatTier || ''}
                      onChange={(e) => {
                        const tier = e.target.value;
                        if (tier) {
                          void assignSeat.mutateAsync({
                            memberId: member.id,
                            tier: tier as 'STARTER' | 'PRO' | 'ENTERPRISE',
                            dmsAddon: tier === 'ENTERPRISE' ? true : member.dmsAddon,
                          });
                        }
                      }}
                    >
                      <option value="">No seat</option>
                      <option value="STARTER">Starter</option>
                      <option value="PRO">Pro</option>
                      <option value="PRO" disabled style={{ display: 'none' }}>Pro + DMS</option>
                      <option value="ENTERPRISE">Enterprise (+ DMS)</option>
                    </select>

                    {member.seatTier && member.seatTier !== 'ENTERPRISE' && (
                      <label className="flex items-center gap-1 text-[10px]">
                        <input
                          type="checkbox"
                          checked={member.dmsAddon}
                          onChange={(e) => {
                            void assignSeat.mutateAsync({
                              memberId: member.id,
                              tier: member.seatTier as 'STARTER' | 'PRO' | 'ENTERPRISE',
                              dmsAddon: e.target.checked,
                            });
                          }}
                          className="rounded"
                        />
                        <span className="font-medium text-muted-foreground">DMS</span>
                      </label>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
