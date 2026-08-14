import type { OrgSeatTier } from '@prisma/client';
import { match } from 'ts-pattern';

import {
  ORG_SEAT_TIERS,
  ORG_UNLIMITED_SENTINEL,
  resolveOrgTierDocuments,
} from '@documenso/lib/constants/org-tiers';
import { stripe } from '@documenso/lib/server-only/stripe';
import type { Stripe } from '@documenso/lib/server-only/stripe';
import { prisma } from '@documenso/prisma';

export type OnOrgSubscriptionUpdatedOptions = {
  organizationId: number;
  subscription: Stripe.Subscription;
};

const isOrgSeatTier = (value: unknown): value is OrgSeatTier =>
  typeof value === 'string' && value in ORG_SEAT_TIERS;

export const onOrgSubscriptionUpdated = async ({
  organizationId,
  subscription: passedInSubscription,
}: OnOrgSubscriptionUpdatedOptions) => {
  // Re-fetch with product data expanded regardless of what the caller passed
  // in — an org's subscription can now hold items for more than one tier at
  // once, so classifying them requires each item's own product metadata
  // (`{ type, tier, interval }`, Stripe-authoritative — see `getOrgSeatPrice`),
  // not a single subscription-level `tier`/array position. Not every call site
  // expands this (the `customer.subscription.updated` webhook branch hands
  // over the raw, unexpanded event payload), so this makes the function
  // correct regardless of caller rather than relying on caller discipline.
  const subscription = await stripe.subscriptions.retrieve(passedInSubscription.id, {
    expand: ['items.data.price.product'],
  });

  const billingStatus = match(subscription.status)
    .with('active', () => 'active')
    .with('past_due', () => 'past_due')
    .otherwise(() => 'inactive');

  type ClassifiedItem = { item: Stripe.SubscriptionItem; type: string; tier: OrgSeatTier };

  const classifiedItems: ClassifiedItem[] = subscription.items.data.flatMap((item) => {
    const { product } = item.price;
    if (typeof product === 'string' || product.deleted) return [];
    const { type, tier } = product.metadata ?? {};
    if (
      (type !== 'org_seat' && type !== 'org_dms' && type !== 'org_doc_block') ||
      !isOrgSeatTier(tier)
    ) {
      return [];
    }
    return [{ item, type, tier }];
  });

  // Mirrors `onSubscriptionUpdated`'s fallback: newer Stripe API versions move
  // `current_period_end` from the subscription onto its items.
  const anyItem = subscription.items.data[0];
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const itemPeriodEnd = (anyItem as unknown as { current_period_end?: number })?.current_period_end;
  const periodEndSeconds = itemPeriodEnd ?? subscription.current_period_end;
  const periodEnd = periodEndSeconds ? new Date(periodEndSeconds * 1000) : undefined;

  // Aggregate across every tier on this subscription — `Organization` only
  // ever tracked a single seat price/count, which stops being meaningful
  // once an org can hold more than one tier at once. `OrgSeatPlan` (below)
  // is the per-tier source of truth now; these fields are kept only for
  // rough backward-compatible display (total seats, subscription status).
  const totalSeatCount = classifiedItems
    .filter((c) => c.type === 'org_seat')
    .reduce((sum, c) => sum + (c.item.quantity ?? 0), 0);

  await prisma.organization.update({
    where: { id: organizationId },
    data: {
      stripeSubscriptionId: subscription.id,
      seatCount: totalSeatCount,
      billingStatus,
      periodEnd,
    },
  });

  // `OrgSeatPlan` rows are only ever written here, from confirmed Stripe
  // state — never optimistically from `purchaseSeats` itself, whether it's
  // the first purchase (checkout) or a top-up (direct item update). Both
  // land here as `checkout.session.completed` / `customer.subscription.updated`.
  const tiersOnThisSubscription = new Set(classifiedItems.map((c) => c.tier));

  // A tier can leave the subscription entirely — cancelled in-app (see
  // `cancelSeatPlan`) or removed directly via the Stripe billing portal —
  // and this sync is the one place that's ever true, so it's the one place
  // that should drop the now-stale `OrgSeatPlan` row rather than leaving it
  // to linger with no matching Stripe item behind it. Scoped to
  // `source: 'stripe'` — a license-key-granted plan isn't reflected on the
  // Stripe subscription at all and must never be touched by this sync.
  await prisma.orgSeatPlan.deleteMany({
    where: {
      organizationId,
      source: 'stripe',
      tier: { notIn: Array.from(tiersOnThisSubscription) },
    },
  });

  for (const tier of tiersOnThisSubscription) {
    const seatItem = classifiedItems.find((c) => c.tier === tier && c.type === 'org_seat')?.item;
    const dmsItem = classifiedItems.find((c) => c.tier === tier && c.type === 'org_dms')?.item;
    const docBlockItem = classifiedItems.find((c) => c.tier === tier && c.type === 'org_doc_block')?.item;

    if (!seatItem) continue;

    const tierLimits = ORG_SEAT_TIERS[tier];
    const dmsEnabled = tierLimits.dmsEnabled || Boolean(dmsItem);

    const seatPlanData = {
      documentsPerMonth: resolveOrgTierDocuments(tier) ?? ORG_UNLIMITED_SENTINEL,
      recipientsPerMonth: tierLimits.recipients ?? ORG_UNLIMITED_SENTINEL,
      directTemplates: tierLimits.directTemplates ?? ORG_UNLIMITED_SENTINEL,
      dmsEnabled,
      // Item quantity directly *is* the block count (independent of seat
      // count) — set that way in `purchaseSeats`.
      docBlockQuantity: docBlockItem?.quantity ?? 0,
      quantity: seatItem.quantity ?? 0,
      billingInterval: seatItem.price.recurring?.interval === 'year' ? 'year' : 'month',
      stripePriceId: seatItem.price.id,
    };

    const existingSeatPlan = await prisma.orgSeatPlan.findFirst({
      where: { organizationId, tier },
    });

    const seatPlan = existingSeatPlan
      ? await prisma.orgSeatPlan.update({
          where: { id: existingSeatPlan.id },
          data: seatPlanData,
        })
      : await prisma.orgSeatPlan.create({
          data: { ...seatPlanData, tier, organizationId },
        });

    // `dmsAddon` is set on each member at the moment they're assigned a
    // seat — if DMS gets enabled (or disabled) on this tier's plan *after*
    // that, already-seated members never see it reflected without this:
    // keep every member currently on this tier in sync with its current
    // `dmsEnabled` state, not just whoever triggered this particular sync.
    await prisma.organizationMember.updateMany({
      where: { organizationId, seatTier: tier },
      data: { dmsAddon: dmsEnabled },
    });

    // Only present on the first-purchase (checkout) path — a top-up already
    // self-assigns synchronously in `purchaseSeats` since it doesn't need to
    // wait on a webhook. Idempotent: skipped if the member is already seated.
    // Metadata's `tier` here means "which tier to auto-assign the purchasing
    // member to" specifically — not "the subscription's tier" (there can be
    // more than one now) — so this only fires for the tier that matches it.
    const purchasingMemberId = subscription.metadata?.purchasingMemberId;
    const purchasingMemberTier = subscription.metadata?.tier;

    if (purchasingMemberId && purchasingMemberTier === tier) {
      const purchasingMember = await prisma.organizationMember.findUnique({
        where: { id: purchasingMemberId },
      });

      if (
        purchasingMember &&
        !purchasingMember.seatTier &&
        seatPlan.assigned < seatPlan.quantity
      ) {
        await prisma.orgSeatPlan.update({
          where: { id: seatPlan.id },
          data: { assigned: { increment: 1 } },
        });

        await prisma.organizationMember.update({
          where: { id: purchasingMemberId },
          data: { seatTier: tier, dmsAddon: dmsEnabled },
        });
      }
    }
  }
};
