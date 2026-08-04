import { ORG_SEAT_TIERS } from '@documenso/lib/constants/org-tiers';
import type { Stripe } from '@documenso/lib/server-only/stripe';

/**
 * Newer Stripe API versions move `current_period_end` from the subscription
 * onto its items — mirrors the same fallback used by `onSubscriptionUpdated`
 * and `onOrgSubscriptionUpdated`.
 */
export const getSubscriptionPeriodEndISO = (subscription: Stripe.Subscription): string | undefined => {
  const item = subscription.items.data[0];

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const itemPeriodEnd = (item as unknown as { current_period_end?: number })?.current_period_end;

  const periodEndSeconds = itemPeriodEnd ?? subscription.current_period_end;

  return periodEndSeconds ? new Date(periodEndSeconds * 1000).toISOString() : undefined;
};

/**
 * Org seat prices are resolved from the live subscription's items, not
 * `subscription.metadata.quantity` — that's only set once, at first-purchase
 * checkout, and goes stale the moment a top-up changes the actual quantity
 * (top-ups update the Stripe items directly, never that metadata field).
 * Interval is read the same way (an item's `price.recurring.interval`)
 * rather than assumed, now that org seats support both monthly and yearly.
 *
 * An org's subscription can hold items for more than one tier at once
 * (mixed licensing) — `subscription.metadata.tier` identifies which tier
 * *this particular purchase* was for, so this only sums that tier's own
 * items (matched via each item's product metadata, same as
 * `onOrgSubscriptionUpdated`), not the org's combined total across tiers —
 * otherwise the email would show one tier's name next to another tier's
 * price.
 */
export const resolveOrgPlanNameAndPrice = (subscription: Stripe.Subscription) => {
  const tier = subscription.metadata?.tier as keyof typeof ORG_SEAT_TIERS | undefined;

  const itemsForTier = subscription.items.data.filter((item) => {
    const { product } = item.price;
    return typeof product !== 'string' && !product.deleted && product.metadata?.tier === tier;
  });

  const seatItem =
    itemsForTier.find((item) => {
      const { product } = item.price;
      return typeof product !== 'string' && !product.deleted && product.metadata?.type === 'org_seat';
    }) ?? subscription.items.data[0];

  const quantity = seatItem?.quantity ?? 1;
  const interval = seatItem?.price.recurring?.interval === 'year' ? 'year' : 'month';

  const tierConfig = tier ? ORG_SEAT_TIERS[tier] : undefined;

  const planName = tierConfig
    ? `${tierConfig.name} (${quantity} seat${quantity > 1 ? 's' : ''})`
    : 'Organization Plan';

  // Sum just this tier's own line items rather than recomputing from
  // `ORG_SEAT_TIERS` — the live subscription is the source of truth for
  // what's actually billed for this tier (avoids drift from local config).
  const items = itemsForTier.length > 0 ? itemsForTier : subscription.items.data;
  const totalCents = items.reduce(
    (sum, item) => sum + (item.price.unit_amount ?? 0) * (item.quantity ?? 0),
    0,
  );

  const priceFormatted = `$${(totalCents / 100).toFixed(2)}/${interval}`;

  return { planName, priceFormatted };
};
