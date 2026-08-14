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
  ORG_DOC_BLOCK_SIZE,
  ORG_SEAT_TIERS,
  resolveOrgTierDocuments,
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
import { OrgAdminGuard } from '~/components/general/org-admin-guard';
import { RedeemLicenseKeyCard } from '~/components/general/redeem-license-key-card';

export function meta() {
  return appMetaTags('Organization Billing');
}

const TIER_COLORS: Record<keyof typeof ORG_SEAT_TIERS, string> = {
  TEAM: 'text-emerald-600',
  BUSINESS: 'text-blue-600',
  ENTERPRISE: 'text-amber-600',
};

// Member seat-badge background/text pairing per tier — a separate palette
// from `TIER_COLORS` (which is a bare text accent used elsewhere) since
// badges need a matching background too.
const TIER_BADGE_CLASSES: Record<keyof typeof ORG_SEAT_TIERS, string> = {
  TEAM: 'bg-emerald-50 text-emerald-700',
  BUSINESS: 'bg-blue-50 text-blue-700',
  ENTERPRISE: 'bg-amber-50 text-amber-700',
};

// Display-friendly view over the canonical `ORG_SEAT_TIERS` table (limits
// only — '∞' instead of `null`, plus a UI-only accent color per tier).
// Pricing is Stripe-authoritative (see `trpc.org.getSeatPricing`), not part
// of this table. Document allowance isn't here — Enterprise's is
// deployment-aware (see `resolveOrgTierDocuments`/`docsForTier` below) and a
// module-level constant can't be reactive to that.
const TIER_CONFIG = Object.fromEntries(
  Object.entries(ORG_SEAT_TIERS).map(([tier, config]) => [
    tier,
    {
      name: config.name,
      color: TIER_COLORS[tier as keyof typeof ORG_SEAT_TIERS],
      minSeats: config.minSeats,
      maxSeats: config.maxSeats,
      dmsAddonAvailable: config.dmsAddonAvailable,
    },
  ]),
) as Record<
  keyof typeof ORG_SEAT_TIERS,
  {
    name: string;
    color: string;
    minSeats: number;
    maxSeats: number | undefined;
    dmsAddonAvailable: boolean;
  }
>;

// Deployment-aware document allowance for display — `resolveOrgTierDocuments`
// defaults to reading `DEPLOYMENT_TYPE()` itself, so this is correct
// immediately on render with no dependency on `getSeatPricing` resolving.
const docsForTier = (tier: string) =>
  resolveOrgTierDocuments(tier as keyof typeof ORG_SEAT_TIERS) ?? '∞';

type SeatPricing =
  | {
      seat: Record<'TEAM' | 'BUSINESS' | 'ENTERPRISE', { month: number | null; year: number | null }>;
      dms: Record<'TEAM' | 'BUSINESS' | 'ENTERPRISE', { month: number | null; year: number | null }>;
      docBlock: { month: number | null; year: number | null };
      deployment: 'shared' | 'dedicated';
    }
  | undefined;

// Every price display reads through these rather than the raw query result
// directly, so a still-loading/missing Price consistently shows as $0 instead
// of each call site needing its own optional-chaining fallback.
const seatPriceFor = (pricing: SeatPricing, tier: string, interval: string) => {
  const amounts = pricing?.seat[tier as keyof NonNullable<SeatPricing>['seat']];
  return ((interval === 'year' ? amounts?.year : amounts?.month) ?? 0) / 100;
};

const dmsPriceFor = (pricing: SeatPricing, tier: string, interval: string) => {
  const amounts = pricing?.dms[tier as keyof NonNullable<SeatPricing>['dms']];
  return ((interval === 'year' ? amounts?.year : amounts?.month) ?? 0) / 100;
};

const docBlockPriceFor = (pricing: SeatPricing, interval: string) =>
  ((interval === 'year' ? pricing?.docBlock.year : pricing?.docBlock.month) ?? 0) / 100;

// Static marketing copy (not per-render state), so this lives outside the
// page component — shown wherever DMS is offered or already included, since
// a bare `title=` tooltip can't render a bulleted feature list.
const DmsFeaturesHoverCard = () => (
  <HoverCard openDelay={120} closeDelay={120}>
    <HoverCardTrigger asChild>
      <button type="button" className="inline-flex items-center" aria-label="What's included with Repositories">
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

function OrgBillingPage() {
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
  const { data: pricing } = trpc.org.getSeatPricing.useQuery();
  const setupBilling = trpc.org.setupBilling.useMutation();
  const manageBilling = trpc.org.manageBilling.useMutation();

  const [buyTier, setBuyTier] = useState<string>('BUSINESS');
  const [buyQty, setBuyQty] = useState(ORG_SEAT_TIERS.BUSINESS.minSeats);
  const [buyInterval, setBuyInterval] = useState<OrgBillingInterval>('month');
  const [buyDms, setBuyDms] = useState(false);
  // Business-only: number of +100/mo document volume blocks to add.
  const [buyDocBlocks, setBuyDocBlocks] = useState(0);
  const [showBuy, setShowBuy] = useState(false);
  const [embeddedClientSecret, setEmbeddedClientSecret] = useState<string | null>(null);
  // Per-member tier choice for "Give seat", only shown/needed when the org
  // has 2+ tiers with open seats — keyed by member id since each unseated
  // row picks independently.
  const [giveSeatTier, setGiveSeatTier] = useState<Record<string, string>>({});

  // An org can hold more than one tier at once now (mixed licensing, like
  // Business + Enterprise seats in one org — see `purchaseSeats`), so
  // "is this a top-up" depends on which tier is *currently selected* in the
  // form, not whether the org has a plan at all.
  const hasAnySeatPlan = Boolean(seatPlans && seatPlans.length > 0);
  const existingPlanForSelectedTier = seatPlans?.find((p) => p.tier === buyTier);
  const isTopUpForSelectedTier = Boolean(existingPlanForSelectedTier);

  // Once DMS is part of the *selected tier's* plan, top-ups can't opt out of
  // it (the server keeps it on regardless — see `dmsNowEnabled` in
  // `purchaseSeats`), so the checkbox is locked on rather than defaulting to
  // unchecked and showing a price that doesn't match what's actually charged.
  const dmsLockedOn = Boolean(existingPlanForSelectedTier?.dmsEnabled);

  // Billing interval is locked org-wide the moment *any* tier has been
  // purchased — a single Stripe subscription can't mix monthly/yearly items
  // across tiers, even if the tiers themselves can coexist.
  useEffect(() => {
    if (seatPlans && seatPlans.length > 0) {
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      setBuyInterval((seatPlans[0].billingInterval as OrgBillingInterval | undefined) ?? 'month');
    }
  }, [seatPlans]);

  // Arrived from a marketing-site plan CTA, forwarded here (via org
  // creation) with `?plan=<tier>` — preselect and open the purchase form
  // rather than auto-charging, since seat quantity still needs user input.
  // Waits for `seatPlans` to load so it doesn't reopen the form for a tier
  // the org already holds.
  useEffect(() => {
    const plan = searchParams.get('plan')?.toUpperCase();
    if (!seatPlans || !plan || !(plan in TIER_CONFIG)) return;

    const alreadyHasTier = seatPlans.some((p) => p.tier === plan);
    if (!alreadyHasTier) {
      setBuyTier(plan);
      setShowBuy(true);
    }

    setSearchParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatPlans]);

  // Keep quantity/DMS defaults in sync with whichever tier is currently
  // selected: topping up an existing tier resets to a single additional
  // seat mirroring its current DMS status; picking a tier with no plan yet
  // resets to that tier's minimum. DMS is never auto-selected — it's a paid
  // add-on on every tier now, not bundled into Enterprise.
  useEffect(() => {
    if (existingPlanForSelectedTier) {
      setBuyDms(existingPlanForSelectedTier.dmsEnabled);
      setBuyQty(1);
    } else {
      setBuyDms(false);
      setBuyQty(TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.minSeats ?? 1);
    }
    setBuyDocBlocks(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyTier, existingPlanForSelectedTier?.dmsEnabled]);

  // A single conflict dialog covers both flows that can strand an active
  // personal subscription: purchasing seats (the admin auto-consumes seat #1)
  // and manually assigning a seat to another member.
  const [pendingConflict, setPendingConflict] = useState<
    | {
        kind: 'purchase';
        quantity: number;
        dmsEnabled: boolean;
        docBlocks: number;
        planName: string;
        priceFormatted: string;
      }
    | { kind: 'assign'; memberId: string; tier: string; planName: string; priceFormatted: string }
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

  const cancelSeatPlan = trpc.org.cancelSeatPlan.useMutation({
    onSuccess: () => {
      void utils.org.getSeatPlans.invalidate();
      void utils.org.getMyOrganization.invalidate();
      setPendingCancelTier(null);
      toast({ title: _(msg`Plan cancelled`) });
    },
    onError: (err) => {
      toast({ title: _(msg`Error`), description: err.message, variant: 'destructive' });
    },
  });

  // A tier can only be cancelled with zero assigned seats — confirmed via a
  // dialog since it's a real, billed cancellation, not a reversible toggle.
  const [pendingCancelTier, setPendingCancelTier] = useState<string | null>(null);

  // Checks whether purchasing would strand the admin's own active personal
  // subscription (they auto-consume seat #1 if they don't already have one).
  const handlePurchaseClick = async () => {
    if (!membership) return;

    const minSeats = isTopUpForSelectedTier ? 1 : TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.minSeats ?? 1;
    const finalQty = Math.max(buyQty, minSeats);
    const docBlocks = buyTier === 'BUSINESS' ? buyDocBlocks : 0;

    if (!membership.seatTier) {
      const conflict = await utils.org.getMemberBillingConflict.fetch({ memberId: membership.id });

      if (conflict.hasActivePlan) {
        setPendingConflict({
          kind: 'purchase',
          quantity: finalQty,
          dmsEnabled: buyDms,
          docBlocks,
          planName: conflict.planName,
          priceFormatted: conflict.priceFormatted,
        });
        return;
      }
    }

    void purchaseSeats.mutateAsync({
      tier: buyTier as 'BUSINESS' | 'ENTERPRISE' | 'TEAM',
      quantity: finalQty,
      docBlocks,
      interval: buyInterval,
      dmsEnabled: buyDms,
    });
  };

  // Checks whether the target member has an active personal subscription
  // before assigning an org seat (which would supersede it) — shows a
  // confirmation dialog if so, otherwise assigns directly.
  const handleGiveSeat = async (memberId: string, tier: string) => {
    const conflict = await utils.org.getMemberBillingConflict.fetch({ memberId });

    if (conflict.hasActivePlan) {
      setPendingConflict({
        kind: 'assign',
        memberId,
        tier,
        planName: conflict.planName,
        priceFormatted: conflict.priceFormatted,
      });
      return;
    }

    void assignSeat.mutateAsync({ memberId, tier: tier as 'BUSINESS' | 'ENTERPRISE' | 'TEAM' });
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

  // Tiers with at least one open seat — when there's more than one, "Give
  // seat" needs to ask which tier rather than assuming the org's only one.
  const availableTiers = seatPlans?.filter((p) => p.assigned < p.quantity) ?? [];

  // Calculate totals — every tier still shares one `billingInterval` (a
  // single Stripe subscription can't mix monthly/yearly items), even though
  // an org can now hold more than one tier at once.
  const totalSeats = seatPlans?.reduce((sum, p) => sum + p.quantity, 0) ?? 0;
  const assignedSeats = seatPlans?.reduce((sum, p) => sum + p.assigned, 0) ?? 0;
  const orgInterval = seatPlans?.[0]?.billingInterval ?? 'month';
  const billedTotal =
    seatPlans?.reduce((sum, p) => {
      const seatPrice = seatPriceFor(pricing, p.tier, p.billingInterval);
      const dmsPrice = p.dmsEnabled ? dmsPriceFor(pricing, p.tier, p.billingInterval) : 0;
      const docBlockCost = p.docBlockQuantity * docBlockPriceFor(pricing, p.billingInterval);
      return sum + (seatPrice + dmsPrice) * p.quantity + docBlockCost;
    }, 0) ?? 0;

  // Computed from the two independent live Stripe prices rather than a
  // config discount percent — pricing is Stripe-authoritative now, so
  // "yearly saves X%" is whatever those two numbers actually imply.
  const buyTierMonthlyPrice = seatPriceFor(pricing, buyTier, 'month');
  const buyTierYearlyPricePerMonth = seatPriceFor(pricing, buyTier, 'year') / 12;
  const buyTierYearlySavingsPercent =
    buyTierMonthlyPrice > 0
      ? Math.round((1 - buyTierYearlyPricePerMonth / buyTierMonthlyPrice) * 100)
      : 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold"><Trans>Organization Billing</Trans></h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          <Trans>Purchase seats and assign plans to members.</Trans>
        </p>
      </div>

      {isAdmin && <RedeemLicenseKeyCard organizationId={org.id} />}

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
            {seatPriceFor(pricing, membership.seatTier, orgInterval) +
              (membership.dmsAddon ? dmsPriceFor(pricing, membership.seatTier, orgInterval) : 0)}
            /{orgInterval === 'year' ? 'yr' : 'mo'}
            {membership.dmsAddon && (
              <>
                {' '}
                · Repositories included <DmsFeaturesHoverCard />
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
                {/* An org can hold more than one tier at once (mixed licensing) —
                    always selectable, whether picking a tier to top up or a new
                    one to add alongside whatever the org already has. */}
                <select
                  className="mt-1 block h-8 rounded-md border border-border bg-background px-2 text-[13px]"
                  value={buyTier}
                  onChange={(e) => setBuyTier(e.target.value as keyof typeof TIER_CONFIG)}
                >
                  {Object.entries(TIER_CONFIG).map(([tier, config]) => {
                    const existingPlan = seatPlans?.find((p) => p.tier === tier);
                    return (
                      <option key={tier} value={tier}>
                        {config.name} — ${seatPriceFor(pricing, tier, 'month')}/seat/mo (
                        {docsForTier(tier) === '∞'
                          ? 'unlimited'
                          : `${docsForTier(tier)} signature requests`}
                        {existingPlan
                          ? `, ${existingPlan.quantity} seats active`
                          : `, min ${config.minSeats} seat${config.minSeats > 1 ? 's' : ''}`}
                        {config.maxSeats !== undefined && `, max ${config.maxSeats} seats`}
                        )
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Billing</label>
                {hasAnySeatPlan ? (
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
                      Yearly{buyTierYearlySavingsPercent > 0 && ` · Save ${buyTierYearlySavingsPercent}%`}
                    </button>
                  </div>
                )}
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">
                  {isTopUpForSelectedTier
                    ? 'Additional seats'
                    : `Quantity (min ${TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.minSeats ?? 1})`}
                </label>
                <Input
                  className="mt-1 h-8 w-20 text-[13px]"
                  type="number"
                  min={isTopUpForSelectedTier ? 1 : TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.minSeats ?? 1}
                  max={TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.maxSeats ?? 100}
                  value={buyQty}
                  onChange={(e) => setBuyQty(Number(e.target.value))}
                />
              </div>
              {/* Repositories (DMS) is a paid add-on, but not every tier can
                  buy it — Team deliberately can't, that's the fence that
                  pushes growing teams to Business rather than an oversight. */}
              {TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.dmsAddonAvailable ? (
                <>
                  <label
                    className="flex items-center gap-1.5 text-[12px]"
                    title={
                      dmsLockedOn
                        ? "Your plan includes Repositories — it can't be removed when buying additional seats."
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
                      + Repositories Add-On (${dmsPriceFor(pricing, buyTier, buyInterval)}/seat/
                      {buyInterval === 'year' ? 'yr' : 'mo'})
                    </span>
                  </label>
                  <div className="-ml-2">
                    <DmsFeaturesHoverCard />
                  </div>
                </>
              ) : (
                <span className="text-[12px] text-muted-foreground">
                  Repositories available on Business and up.
                </span>
              )}
              {buyTier === 'BUSINESS' && (
                <div>
                  <label className="text-[12px] font-medium text-muted-foreground">
                    + Doc blocks (+{ORG_DOC_BLOCK_SIZE}/mo each, $
                    {docBlockPriceFor(pricing, buyInterval)}/{buyInterval === 'year' ? 'yr' : 'mo'})
                  </label>
                  <Input
                    className="mt-1 h-8 w-20 text-[13px]"
                    type="number"
                    min={0}
                    max={100}
                    value={buyDocBlocks}
                    onChange={(e) => setBuyDocBlocks(Math.max(0, Number(e.target.value)))}
                  />
                </div>
              )}
              <div className="text-[13px] font-medium text-muted-foreground">
                = $
                {buyQty * (seatPriceFor(pricing, buyTier, buyInterval) + (buyDms ? dmsPriceFor(pricing, buyTier, buyInterval) : 0)) +
                  (buyTier === 'BUSINESS' ? buyDocBlocks * docBlockPriceFor(pricing, buyInterval) : 0)}
                /{buyInterval === 'year' ? 'year' : 'month'}
              </div>
              <Button
                size="sm"
                onClick={() => void handlePurchaseClick()}
                loading={purchaseSeats.isPending}
                disabled={
                  buyQty < (isTopUpForSelectedTier ? 1 : TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.minSeats ?? 1) ||
                  (existingPlanForSelectedTier?.quantity ?? 0) + buyQty >
                    (TIER_CONFIG[buyTier as keyof typeof TIER_CONFIG]?.maxSeats ?? Infinity)
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
              // All-in per-seat rate (base + DMS if purchased) — shown
              // consistently everywhere a per-seat price appears, so it
              // never contradicts the all-in total or the "Your Plan" card.
              const dmsPrice = plan.dmsEnabled ? dmsPriceFor(pricing, plan.tier, plan.billingInterval) : 0;
              const allInSeatPrice = seatPriceFor(pricing, plan.tier, plan.billingInterval) + dmsPrice;
              const docBlockCost = plan.docBlockQuantity * docBlockPriceFor(pricing, plan.billingInterval);
              const planDocs = docsForTier(plan.tier);
              const effectiveDocs =
                typeof planDocs === 'number'
                  ? planDocs + plan.docBlockQuantity * ORG_DOC_BLOCK_SIZE
                  : planDocs;
              return (
                <div key={plan.id} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`text-[14px] font-semibold ${config?.color || ''}`}>
                      {config?.name || plan.tier}
                    </div>
                    <span className="inline-flex items-center gap-1 text-[12px] text-muted-foreground">
                      ${allInSeatPrice}/seat/
                      {plan.billingInterval === 'year' ? 'yr' : 'mo'} · {effectiveDocs} signature requests/mo
                      {plan.docBlockQuantity > 0 && ` (+${plan.docBlockQuantity} block${plan.docBlockQuantity > 1 ? 's' : ''})`}
                      {plan.dmsEnabled && (
                        <>
                          {' '}
                          · Repositories add-on <DmsFeaturesHoverCard />
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
                      ${allInSeatPrice * plan.quantity + docBlockCost}
                      /{plan.billingInterval === 'year' ? 'yr' : 'mo'}
                    </span>
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={plan.assigned > 0}
                        title={
                          plan.assigned > 0
                            ? 'Unassign every member on this tier before cancelling it.'
                            : undefined
                        }
                        onClick={() => setPendingCancelTier(plan.tier)}
                      >
                        <Trans>Cancel plan</Trans>
                      </Button>
                    )}
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
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                      TIER_BADGE_CLASSES[member.seatTier as keyof typeof TIER_BADGE_CLASSES]
                    }`}
                  >
                    {member.seatTier}
                    {member.dmsAddon && ' + Repositories'}
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">No seat</span>
                )}

                {isAdmin && !member.seatTier && availableTiers.length > 1 && (
                  <select
                    className="h-8 rounded-md border border-border bg-background px-1.5 text-[12px]"
                    value={giveSeatTier[member.id] ?? availableTiers[0].tier}
                    onChange={(e) =>
                      setGiveSeatTier((prev) => ({ ...prev, [member.id]: e.target.value }))
                    }
                  >
                    {availableTiers.map((plan) => (
                      <option key={plan.tier} value={plan.tier}>
                        {plan.tier}
                      </option>
                    ))}
                  </select>
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
                        const tier = giveSeatTier[member.id] ?? availableTiers[0]?.tier ?? 'BUSINESS';
                        void handleGiveSeat(member.id, tier);
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
                    tier: pendingConflict.tier as 'BUSINESS' | 'ENTERPRISE' | 'TEAM',
                    acknowledgeCancelPersonalPlan: true,
                  });
                } else if (pendingConflict?.kind === 'purchase') {
                  void purchaseSeats.mutateAsync({
                    tier: buyTier as 'BUSINESS' | 'ENTERPRISE' | 'TEAM',
                    quantity: pendingConflict.quantity,
                    docBlocks: pendingConflict.docBlocks,
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

      <AlertDialog
        open={pendingCancelTier !== null}
        onOpenChange={(open) => {
          if (!open) setPendingCancelTier(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <Trans>Cancel {pendingCancelTier ? TIER_CONFIG[pendingCancelTier as keyof typeof TIER_CONFIG]?.name : ''}?</Trans>
            </AlertDialogTitle>
            <AlertDialogDescription>
              <Trans>
                This cancels the plan immediately — unused time is credited to the account
                balance, not refunded to the card. This can't be undone; buying the tier again
                later starts a new plan.
              </Trans>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingCancelTier(null)}>
              <Trans>Keep plan</Trans>
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingCancelTier) {
                  void cancelSeatPlan.mutateAsync({
                    tier: pendingCancelTier as 'BUSINESS' | 'ENTERPRISE' | 'TEAM',
                  });
                }
              }}
            >
              <Trans>Cancel plan</Trans>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Administrative screen: withheld from ordinary members. The sidebar also
 * hides the link, but that alone would leave the URL directly reachable.
 */
export default function OrgBillingPageRoute() {
  return (
    <OrgAdminGuard>
      <OrgBillingPage />
    </OrgAdminGuard>
  );
}
