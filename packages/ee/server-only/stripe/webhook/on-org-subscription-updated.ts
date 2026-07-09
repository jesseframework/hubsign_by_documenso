import type { OrgSeatTier } from '@prisma/client';
import { match } from 'ts-pattern';

import { ORG_SEAT_TIERS, ORG_UNLIMITED_SENTINEL } from '@documenso/lib/constants/org-tiers';
import type { Stripe } from '@documenso/lib/server-only/stripe';
import { prisma } from '@documenso/prisma';

export type OnOrgSubscriptionUpdatedOptions = {
  organizationId: number;
  subscription: Stripe.Subscription;
};

export const onOrgSubscriptionUpdated = async ({
  organizationId,
  subscription,
}: OnOrgSubscriptionUpdatedOptions) => {
  const billingStatus = match(subscription.status)
    .with('active', () => 'active')
    .with('past_due', () => 'past_due')
    .otherwise(() => 'inactive');

  // `purchaseSeats` (org-router.ts) tags the *product* metadata with
  // `{ type: 'org_seat' | 'org_dms' }`, not the price — and Stripe doesn't
  // expand product data on a plain `subscriptions.retrieve()` call, so price
  // metadata is empty here regardless. Use the subscription's own metadata
  // (set at checkout time) and the deterministic item order `purchaseSeats`
  // constructs instead: seat item is always items[0], the optional DMS
  // add-on (when `dmsEnabled`) is always items[1].
  const dmsEnabled = subscription.metadata?.dmsEnabled === 'true';

  const seatItem = subscription.items.data[0];
  const dmsItem = dmsEnabled ? subscription.items.data[1] : undefined;

  // Mirrors `onSubscriptionUpdated`'s fallback: newer Stripe API versions move
  // `current_period_end` from the subscription onto its items.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const itemPeriodEnd = (seatItem as unknown as { current_period_end?: number })
    ?.current_period_end;

  const periodEndSeconds = itemPeriodEnd ?? subscription.current_period_end;
  const periodEnd = periodEndSeconds ? new Date(periodEndSeconds * 1000) : undefined;

  await prisma.organization.update({
    where: {
      id: organizationId,
    },
    data: {
      stripeSubscriptionId: subscription.id,
      stripeSeatPriceId: seatItem?.price.id,
      stripeDmsPriceId: dmsItem?.price.id,
      seatCount: seatItem?.quantity ?? 0,
      billingStatus,
      periodEnd,
    },
  });

  // `OrgSeatPlan`/seat assignment are only ever written here, from confirmed
  // Stripe state — never optimistically from `purchaseSeats` itself, whether
  // it's the first purchase (checkout) or a top-up (direct quantity update).
  // Both land here as `checkout.session.completed` / `customer.subscription.updated`.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const tier = subscription.metadata?.tier as OrgSeatTier | undefined;

  if (tier && tier in ORG_SEAT_TIERS && seatItem) {
    const tierLimits = ORG_SEAT_TIERS[tier];

    const seatPlanData = {
      documentsPerMonth: tierLimits.documents ?? ORG_UNLIMITED_SENTINEL,
      recipientsPerMonth: tierLimits.recipients ?? ORG_UNLIMITED_SENTINEL,
      directTemplates: tierLimits.directTemplates ?? ORG_UNLIMITED_SENTINEL,
      dmsEnabled,
      quantity: seatItem.quantity ?? 0,
      // Falls back to "month" for pre-yearly-billing subscriptions whose
      // metadata predates this field.
      billingInterval: subscription.metadata?.interval === 'year' ? 'year' : 'month',
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
    // seat — if DMS gets enabled (or disabled) on the org's plan *after*
    // that, already-seated members never see it reflected without this:
    // keep every member currently on this tier in sync with its current
    // `dmsEnabled` state, not just whoever triggered this particular sync.
    await prisma.organizationMember.updateMany({
      where: { organizationId, seatTier: tier },
      data: { dmsAddon: tier === 'ENTERPRISE' ? true : dmsEnabled },
    });

    // Only present on the first-purchase (checkout) path — a top-up already
    // self-assigns synchronously in `purchaseSeats` since it doesn't need to
    // wait on a webhook. Idempotent: skipped if the member is already seated.
    const purchasingMemberId = subscription.metadata?.purchasingMemberId;

    if (purchasingMemberId) {
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
          data: {
            seatTier: tier,
            dmsAddon: tier === 'ENTERPRISE' ? true : dmsEnabled,
          },
        });
      }
    }
  }
};
