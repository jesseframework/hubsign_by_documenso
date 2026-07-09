import type { OrgSeatTier } from '@prisma/client';

import type { OrgBillingInterval } from '@documenso/lib/constants/org-tiers';
import { stripe } from '@documenso/lib/server-only/stripe';

export type GetOrCreateOrgPriceOptions = {
  type: 'org_seat' | 'org_dms';
  tier: OrgSeatTier;
  interval: OrgBillingInterval;
  unitAmountCents: number;
  productName: string;
};

/**
 * The single place any org seat/DMS Stripe Price is ever created. Looks up an
 * existing active Price tagged with this exact `{ type, tier, interval }` via
 * `list` (not `.search` — the search index has a propagation delay that would
 * reintroduce the duplicate-Product/Price race this replaces) before creating
 * a new one, so repeated purchases across orgs reuse the same Price instead of
 * spawning a fresh Product/Price every time.
 */
export const getOrCreateOrgPrice = async ({
  type,
  tier,
  interval,
  unitAmountCents,
  productName,
}: GetOrCreateOrgPriceOptions): Promise<string> => {
  const products = await stripe.products.list({ active: true, limit: 100 });

  const existingProduct = products.data.find(
    (product) =>
      product.metadata?.type === type &&
      product.metadata?.tier === tier &&
      product.metadata?.interval === interval,
  );

  if (existingProduct) {
    const prices = await stripe.prices.list({ product: existingProduct.id, active: true, limit: 10 });

    const existingPrice = prices.data.find(
      (price) => price.unit_amount === unitAmountCents && price.recurring?.interval === interval,
    );

    if (existingPrice) {
      return existingPrice.id;
    }

    // Amount changed since this product was created (e.g. pricing config
    // updated) — new Price on the same Product, Stripe Prices are immutable.
    const newPrice = await stripe.prices.create({
      currency: 'usd',
      unit_amount: unitAmountCents,
      recurring: { interval },
      product: existingProduct.id,
    });

    return newPrice.id;
  }

  const product = await stripe.products.create({
    name: productName,
    metadata: { type, tier, interval },
  });

  const price = await stripe.prices.create({
    currency: 'usd',
    unit_amount: unitAmountCents,
    recurring: { interval },
    product: product.id,
  });

  return price.id;
};
