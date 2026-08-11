import type { OrgSeatTier } from '@prisma/client';
import type Stripe from 'stripe';

import type { OrgBillingInterval } from '@documenso/lib/constants/org-tiers';
import { stripe } from '@documenso/lib/server-only/stripe';

export type PriceWithProduct = Stripe.Price & { product: Stripe.Product };

export type OrgSeatPriceType = 'org_seat' | 'org_dms' | 'org_doc_block';

export type GetOrgSeatPriceOptions = {
  type: OrgSeatPriceType;
  tier: OrgSeatTier;
  interval: OrgBillingInterval;
  /**
   * Only meaningful for `{ type: 'org_seat', tier: 'ENTERPRISE' }` — selects
   * which of the two Enterprise Prices this deployment charges (see
   * `DEPLOYMENT_TYPE`). Ignored for every other `{type, tier}` combination.
   */
  deployment?: 'shared' | 'dedicated';
};

/**
 * Org seat/DMS/doc-block pricing is Stripe-authoritative — same pattern as
 * the individual/team plans (`get-prices-by-interval.ts`): the live amount in
 * Stripe is what customers pay, read here by Product metadata rather than
 * pushed into Stripe from a hardcoded value in this app (that was the org
 * seat billing's old design; it's been replaced with this so a price change
 * is a Stripe dashboard edit, not a code deploy).
 *
 * One search call, shared across every lookup made against its result —
 * callers that need several combinations (e.g. `getSeatPricing`, which needs
 * up to 10) should fetch this once and match against it directly rather than
 * calling `getOrgSeatPrice` repeatedly, which would re-fetch every time.
 */
export const searchActiveOrgPrices = async (): Promise<PriceWithProduct[]> => {
  const { data: prices } = await stripe.prices.search({
    query: `active:'true' type:'recurring'`,
    expand: ['data.product'],
    limit: 100,
  });

  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return prices.filter((price) => (price.product as Stripe.Product).active) as PriceWithProduct[];
};

export const matchOrgPrice = (
  prices: PriceWithProduct[],
  { type, tier, interval, deployment }: GetOrgSeatPriceOptions,
): PriceWithProduct | null =>
  prices.find(
    (price) =>
      price.product.metadata?.type === type &&
      price.product.metadata?.tier === tier &&
      price.recurring?.interval === interval &&
      (deployment === undefined || price.product.metadata?.deployment === deployment),
  ) ?? null;

/**
 * Single-combination convenience wrapper over `searchActiveOrgPrices` +
 * `matchOrgPrice`. Returns `null` if no matching active Price exists —
 * callers should treat that as a configuration problem (the relevant
 * Product/Price hasn't been set up in Stripe yet), not silently create one.
 */
export const getOrgSeatPrice = async (options: GetOrgSeatPriceOptions): Promise<PriceWithProduct | null> => {
  const prices = await searchActiveOrgPrices();

  return matchOrgPrice(prices, options);
};
