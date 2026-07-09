import { useEffect, useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  ArchiveIcon,
  CheckCircleIcon,
  CreditCardIcon,
  InfoIcon,
  PlusIcon,
  UsersIcon,
} from 'lucide-react';
import { useSearchParams } from 'react-router';

import {
  ORG_DMS_ADDON_DESCRIPTION,
  ORG_DMS_ADDON_FEATURES,
  ORG_DMS_ADDON_PRICE_CENTS,
  ORG_DMS_ADDON_YEARLY_DISCOUNT_PERCENT,
  ORG_SEAT_TIERS,
  getOrgYearlyPriceCents,
} from '@documenso/lib/constants/org-tiers';
import type { OrgBillingInterval } from '@documenso/lib/constants/org-tiers';
import { trpc } from '@documenso/trpc/react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@documenso/ui/primitives/alert-dialog';
import { Button } from '@documenso/ui/primitives/button';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@documenso/ui/primitives/hover-card';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { EmbeddedCheckoutForm } from '~/components/general/embedded-checkout-form';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Organization Billing');
}

const TIER_COLORS: Record<keyof typeof ORG_SEAT_TIERS, string> = {
  BUSINESS: 'text-blue-600',
  ENTERPRISE: 'text-amber-600',
};

// Display-friendly view over the canonical `ORG_SEAT_TIERS` table (dollars instead
// of cents, '∞' instead of `null`, plus a UI-only accent color per tier).
const TIER_CONFIG = Object.fromEntries(
  Object.entries(ORG_SEAT_TIERS).map(([tier, config]) => [
    tier,
    {
      name: config.name,
      price: config.priceCents / 100,
      yearlyPrice: getOrgYearlyPriceCents(config.priceCents, config.yearlyDiscountPercent) / 100,
      yearlyDiscountPercent: config.yearlyDiscountPercent,
      docs: config.documents ?? '∞',
      color: TIER_COLORS[tier as keyof typeof ORG_SEAT_TIERS],
      minSeats: config.minSeats,
    },
  ]),
) as Record<
  keyof typeof ORG_SEAT_TIERS,
  {
    name: string;
    price: number;
    yearlyPrice: number;
    yearlyDiscountPercent: number;
    docs: number | string;
    color: string;
    minSeats: number;
  }
>;

const DMS_ADDON_PRICE = ORG_DMS_ADDON_PRICE_CENTS / 100;
const DMS_ADDON_YEARLY_PRICE =
  getOrgYearlyPriceCents(ORG_DMS_ADDON_PRICE_CENTS, ORG_DMS_ADDON_YEARLY_DISCOUNT_PERCENT) / 100;

const seatPriceFor = (tier: string, interval: string) => {
  const config = TIER_CONFIG[tier as keyof typeof TIER_CONFIG];
  return interval === 'year' ? config?.yearlyPrice ?? 0 : config?.price ?? 0;
};

// Static marketing copy (not per-render state), so this lives outside the
// page component — shown wherever DMS is offered or already included, since
// a bare `title=` tooltip can't render a bulleted feature list.
const DmsFeaturesHoverCard = () => (
  <HoverCard openDelay={120} closeDelay={120}>
    <HoverCardTrigger asChild>
      <button type="button" className="inline-flex items-center" aria-label="What's included with DMS">
        <InfoIcon className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
    </HoverCardTrigger>
    <HoverCardContent align="start" className="w-72 p-3 text-[12px]">
      <p className="mb-2 text-muted-foreground">{ORG_DMS_ADDON_DESCRIPTION}</p>
      <p className="mb-1 font-semibold">Includes:</p>
      <ul className="divide-y">
        {ORG_DMS_ADDON_FEATURES.map((feature) => (
          <li key={feature} className="py-1.5 text-muted-foreground">
            {feature}
          </li>
        ))}
      </ul>
    </HoverCardContent>
  </HoverCard>
);

const dmsPriceFor = (interval: string) => (interval === 'year' ? DMS_ADDON_YEARLY_PRICE : DMS_ADDON_PRICE);

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

  const [buyTier, setBuyTier] = useState<string>('BUSINESS');
  const [buyQty, setBuyQty] = useState(ORG_SEAT_TIERS.BUSINESS.minSeats);
  const [buyInterval, setBuyInterval] = useState<OrgBillingInterval>('month');
  const [buyDms, setBuyDms] = useState(false);
  const [showBuy, setShowBuy] = useState(false);
  const [embeddedClientSecret, setEmbeddedClientSecret] = useState<string | null>(null);

  // Once the org has a seat plan, purchases are top-ups — no picking a tier
  // or interval (only one of each is possible per org) and no minimum (the
  // tier minimum only applies to establishing it in the first place).
  const isTopUp = Boolean(seatPlans && seatPlans.length > 0);

  // Once DMS is part of the org's plan, top-ups can't opt out of it (the
  // server keeps it on regardless — see `dmsNowEnabled` in `purchaseSeats`),
  // so the checkbox is locked on rather than defaulting to unchecked and
  // showing a price that doesn't match what's actually charged.
  const dmsLockedOn = isTopUp && Boolean(seatPlans?.[0]?.dmsEnabled);

  // An org can only be on one seat tier — and one billing interval — at a
  // time (a single Stripe subscription can't mix monthly/yearly items).
  // Once either exists, lock `buyTier`/`buyInterval` to match and default
  // quantity to a single top-up seat instead of the first-purchase minimum.
  useEffect(() => {
    if (seatPlans && seatPlans.length > 0) {
      setBuyTier(seatPlans[0].tier);
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      setBuyInterval((seatPlans[0].billingInterval as OrgBillingInterval | undefined) ?? 'month');
      setBuyDms(seatPlans[0].dmsEnabled);
      setBuyQty(1);
    }
  }, [seatPlans]);

  // A single conflict dialog covers both flows that can strand an active
  // personal subscription: purchasing seats (the admin auto-consumes seat #1)
  // and manually assigning a seat to another member.
  const [pendingConflict, setPendingConflict] = useState<
    | { kind: 'purchase'; quantity: number; dmsEnabled: boolean; planName: string; priceFormatted: string }
    | { kind: 'assign'; memberId: string; planName: string; priceFormatted: string }
    | null
  >(null);

  const purchaseSeats = trpc.org.purchaseSeats.useMutation({
    onSuccess: (result) => {
      // If Stripe returned a client secret, render the embedded checkout
      // form inline instead of leaving the page.
      if (result && typeof result === 'object' && 'clientSecret' in result && result.clientSecret) {
        setEmbeddedClientSecret(result.clientSecret as string);
        return;
      }

      void utils.org.getSeatPlans.invalidate();
      void utils.org.getMyOrganization.invalidate();

      setShowBuy(false);
      setBuyQty(1);
      setBuyDms(false);
      toast({ title: _(msg`Seats purchased`) });
    },
    onError: (err) => {
      toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' });
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

  const unassignSeat = trpc.org.unassignSeat.useMutation({
    onSuccess: () => {
      void utils.org.getMyOrganization.invalidate();
      void utils.org.getSeatPlans.invalidate();
      toast({ title: _(msg`Seat removed`) });
    },
    onError: (err) => {
      toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' });
    },
  });

  // Checks whether purchasing would strand the admin's own active personal
  // subscription (they auto-consume seat #1 if they don't already have one).
  const handlePurchaseClick = async () => {
    if (!membership) return;

    const minSeats = isTopUp ? 1 : TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.minSeats ?? 1;
    const finalQty = Math.max(buyQty, minSeats);
    const dmsEnabled = buyTier === 'ENTERPRISE' ? true : buyDms;

    if (!membership.seatTier) {
      const conflict = await utils.org.getMemberBillingConflict.fetch({ memberId: membership.id });

      if (conflict.hasActivePlan) {
        setPendingConflict({
          kind: 'purchase',
          quantity: finalQty,
          dmsEnabled,
          planName: conflict.planName,
          priceFormatted: conflict.priceFormatted,
        });
        return;
      }
    }

    void purchaseSeats.mutateAsync({
      tier: buyTier as 'BUSINESS' | 'ENTERPRISE',
      quantity: finalQty,
      interval: buyInterval,
      dmsEnabled,
    });
  };

  // Checks whether the target member has an active personal subscription
  // before assigning an org seat (which would supersede it) — shows a
  // confirmation dialog if so, otherwise assigns directly.
  const handleGiveSeat = async (memberId: string) => {
    const conflict = await utils.org.getMemberBillingConflict.fetch({ memberId });

    if (conflict.hasActivePlan) {
      setPendingConflict({
        kind: 'assign',
        memberId,
        planName: conflict.planName,
        priceFormatted: conflict.priceFormatted,
      });
      return;
    }

    void assignSeat.mutateAsync({ memberId });
  };

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

  // Mirrors the server's "ask another admin" guard in assignSeat/unassignSeat —
  // it only blocks self-targeting when someone else could actually do it,
  // otherwise a sole admin would have nobody to ask and be stuck.
  const hasOtherOrgAdmin = org.members.some(
    (m) => m.id !== membership.id && m.role === 'ORG_ADMIN',
  );
  const hasOtherEligibleAssignAdmin = org.members.some(
    (m) => m.id !== membership.id && (m.role === 'ORG_ADMIN' || m.role === 'DMS_ADMIN'),
  );

  // Calculate totals — an org is on exactly one tier/interval at a time, so
  // every `seatPlans` row shares the same `billingInterval` in practice.
  const totalSeats = seatPlans?.reduce((sum, p) => sum + p.quantity, 0) ?? 0;
  const assignedSeats = seatPlans?.reduce((sum, p) => sum + p.assigned, 0) ?? 0;
  const orgInterval = seatPlans?.[0]?.billingInterval ?? 'month';
  const billedTotal =
    seatPlans?.reduce((sum, p) => {
      const seatPrice = seatPriceFor(p.tier, p.billingInterval);
      const dmsPrice = p.dmsEnabled && p.tier !== 'ENTERPRISE' ? dmsPriceFor(p.billingInterval) : 0;
      return sum + (seatPrice + dmsPrice) * p.quantity;
    }, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold"><Trans>Organization Billing</Trans></h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          <Trans>Purchase seats and assign plans to members.</Trans>
        </p>
      </div>

      {/* Your Plan — org seat limits supersede personal billing entirely, so
          this is the one place that actually reflects what governs you. */}
      <div className="rounded-[var(--r)] border border-border bg-card p-3">
        <span className="text-[10px] font-semibold uppercase text-muted-foreground">
          <Trans>Your Plan</Trans>
        </span>
        {membership.seatTier ? (
          <p className="mt-1 text-[13px]">
            <span className={TIER_CONFIG[membership.seatTier as keyof typeof TIER_CONFIG]?.color}>
              {TIER_CONFIG[membership.seatTier as keyof typeof TIER_CONFIG]?.name}
            </span>{' '}
            — $
            {seatPriceFor(membership.seatTier, orgInterval) +
              (membership.dmsAddon && membership.seatTier !== 'ENTERPRISE'
                ? dmsPriceFor(orgInterval)
                : 0)}
            /{orgInterval === 'year' ? 'yr' : 'mo'}
            {membership.dmsAddon && (
              <>
                {' '}
                · DMS included <DmsFeaturesHoverCard />
              </>
            )}
          </p>
        ) : (
          <p className="mt-1 text-[13px] text-muted-foreground">
            <Trans>You don't have a seat assigned — ask your org admin.</Trans>
          </p>
        )}
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
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">
            {orgInterval === 'year' ? 'Yearly' : 'Monthly'}
          </span>
          <p className="mt-1 text-2xl font-semibold">${billedTotal}</p>
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

        {/* Embedded checkout */}
        {embeddedClientSecret && (
          <div className="border-b border-border bg-muted/30 p-4">
            <Button
              variant="ghost"
              size="sm"
              className="mb-4"
              onClick={() => {
                setEmbeddedClientSecret(null);
                setShowBuy(false);
                void utils.org.getSeatPlans.invalidate();
                void utils.org.getMyOrganization.invalidate();
              }}
            >
              <Trans>Back to plans</Trans>
            </Button>

            <EmbeddedCheckoutForm clientSecret={embeddedClientSecret} />
          </div>
        )}

        {/* Purchase form */}
        {!embeddedClientSecret && showBuy && (
          <div className="border-b border-border bg-muted/30 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Plan Tier</label>
                {seatPlans && seatPlans.length > 0 ? (
                  // An org can only be on one seat tier at a time — once seats
                  // exist, the tier is fixed; this purchase just adds more.
                  <div className="mt-1 flex h-8 items-center rounded-md border border-border bg-muted px-2 text-[13px]">
                    {TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.name} — $
                    {seatPriceFor(buyTier, buyInterval) +
                      (buyDms && buyTier !== 'ENTERPRISE' ? dmsPriceFor(buyInterval) : 0)}
                    /seat/{buyInterval === 'year' ? 'yr' : 'mo'}
                  </div>
                ) : (
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
                    {Object.entries(TIER_CONFIG).map(([tier, config]) => (
                      <option key={tier} value={tier}>
                        {config.name} — ${config.price}/seat/mo (
                        {config.docs === '∞' ? 'unlimited' : `${config.docs} docs`}
                        {tier === 'ENTERPRISE' ? ' + DMS' : ''}, min {config.minSeats} seat
                        {config.minSeats > 1 ? 's' : ''})
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Billing</label>
                {isTopUp ? (
                  // Interval is locked with the tier — a single Stripe
                  // subscription can't mix monthly/yearly items.
                  <div className="mt-1 flex h-8 items-center rounded-md border border-border bg-muted px-2 text-[13px]">
                    {buyInterval === 'year' ? 'Yearly' : 'Monthly'}
                  </div>
                ) : (
                  <div className="mt-1 flex h-8 overflow-hidden rounded-md border border-border text-[13px]">
                    <button
                      type="button"
                      className={`px-2.5 ${
                        buyInterval === 'month' ? 'bg-primary text-primary-foreground' : 'bg-background'
                      }`}
                      onClick={() => setBuyInterval('month')}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      className={`border-l border-border px-2.5 ${
                        buyInterval === 'year' ? 'bg-primary text-primary-foreground' : 'bg-background'
                      }`}
                      onClick={() => setBuyInterval('year')}
                    >
                      Yearly · Save {TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.yearlyDiscountPercent}%
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  {isTopUp
                    ? 'Additional seats'
                    : `Quantity (min ${TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.minSeats ?? 1})`}
                </label>
                <Input
                  className="mt-1 h-8 w-20 text-[13px]"
                  type="number"
                  min={isTopUp ? 1 : TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.minSeats ?? 1}
                  max={100}
                  value={buyQty}
                  onChange={(e) => setBuyQty(Number(e.target.value))}
                />
              </div>
              {buyTier !== 'ENTERPRISE' && (
                <label
                  className="flex items-center gap-1.5 text-[12px]"
                  title={
                    dmsLockedOn
                      ? "Your plan includes DMS — it can't be removed when buying additional seats."
                      : undefined
                  }
                >
                  <input
                    type="checkbox"
                    checked={buyDms}
                    disabled={dmsLockedOn}
                    onChange={(e) => setBuyDms(e.target.checked)}
                    className="rounded"
                  />
                  <span className="font-medium text-muted-foreground">
                    + DMS Add-On (${dmsPriceFor(buyInterval)}/seat/{buyInterval === 'year' ? 'yr' : 'mo'})
                  </span>
                </label>
              )}
              {buyTier !== 'ENTERPRISE' && (
                <div className="-ml-2">
                  <DmsFeaturesHoverCard />
                </div>
              )}
              <div className="text-[13px] font-medium text-muted-foreground">
                = $
                {buyQty *
                  (seatPriceFor(buyTier, buyInterval) +
                    (buyDms && buyTier !== 'ENTERPRISE' ? dmsPriceFor(buyInterval) : 0))}
                /{buyInterval === 'year' ? 'year' : 'month'}
              </div>
              <Button
                size="sm"
                onClick={() => void handlePurchaseClick()}
                loading={purchaseSeats.isPending}
                disabled={
                  buyQty < (isTopUp ? 1 : TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.minSeats ?? 1)
                }
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
              // All-in per-seat rate (base + DMS if included) — shown
              // consistently everywhere a per-seat price appears, so it
              // never contradicts the all-in total or the "Your Plan" card.
              const allInSeatPrice =
                seatPriceFor(plan.tier, plan.billingInterval) +
                (plan.dmsEnabled && plan.tier !== 'ENTERPRISE' ? dmsPriceFor(plan.billingInterval) : 0);
              return (
                <div key={plan.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`text-[14px] font-semibold ${config?.color || ''}`}>
                      {config?.name || plan.tier}
                    </div>
                    <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                      ${allInSeatPrice}/seat/
                      {plan.billingInterval === 'year' ? 'yr' : 'mo'} · {config?.docs} docs/mo
                      {plan.dmsEnabled && (
                        <>
                          {' '}
                          · DMS included <DmsFeaturesHoverCard />
                        </>
                      )}
                      {plan.billingInterval === 'year' && ' · Yearly'}
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
                      $
                      {(seatPriceFor(plan.tier, plan.billingInterval) +
                        (plan.dmsEnabled && plan.tier !== 'ENTERPRISE'
                          ? dmsPriceFor(plan.billingInterval)
                          : 0)) *
                        plan.quantity}
                      /{plan.billingInterval === 'year' ? 'yr' : 'mo'}
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
          {org.members.map((member) => {
            const isSelf = member.id === membership.id;
            const isSelfBlocked =
              isSelf && (member.seatTier ? hasOtherOrgAdmin : hasOtherEligibleAssignAdmin);

            return (
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
                    : 'bg-blue-50 text-blue-700'
                  }`}>
                    {member.seatTier}
                    {member.dmsAddon && ' + DMS'}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">No seat</span>
                )}

                {isAdmin && (
                  <Button
                    size="sm"
                    variant={member.seatTier ? 'outline' : 'default'}
                    disabled={isSelfBlocked}
                    title={
                      isSelfBlocked
                        ? "You can't change your own seat assignment — ask another admin to do it."
                        : undefined
                    }
                    onClick={() => {
                      if (member.seatTier) {
                        void unassignSeat.mutateAsync({ memberId: member.id });
                      } else {
                        void handleGiveSeat(member.id);
                      }
                    }}
                  >
                    {member.seatTier ? <Trans>Remove seat</Trans> : <Trans>Give seat</Trans>}
                  </Button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      </div>

      <AlertDialog
        open={pendingConflict !== null}
        onOpenChange={(open) => {
          if (!open) setPendingConflict(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Cancel personal plan?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingConflict && (
                <Trans>
                  {pendingConflict.kind === 'purchase' ? 'You have' : 'This member has'} an active{' '}
                  <strong>{pendingConflict.planName}</strong> personal subscription (
                  {pendingConflict.priceFormatted}).{' '}
                  {pendingConflict.kind === 'purchase'
                    ? 'Purchasing seats will assign you the first one and cancel your personal plan'
                    : 'Assigning them an org seat will cancel it'}{' '}
                  immediately — unused time is credited to the account balance, not refunded to
                  the card. Continue?
                </Trans>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingConflict(null)}>
              <Trans>Cancel</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingConflict?.kind === 'assign') {
                  void assignSeat.mutateAsync({
                    memberId: pendingConflict.memberId,
                    acknowledgeCancelPersonalPlan: true,
                  });
                } else if (pendingConflict?.kind === 'purchase') {
                  void purchaseSeats.mutateAsync({
                    tier: buyTier as 'BUSINESS' | 'ENTERPRISE',
                    quantity: pendingConflict.quantity,
                    interval: buyInterval,
                    dmsEnabled: pendingConflict.dmsEnabled,
                    acknowledgeCancelPersonalPlan: true,
                  });
                }
                setPendingConflict(null);
              }}
            >
              <Trans>Cancel plan & continue</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
