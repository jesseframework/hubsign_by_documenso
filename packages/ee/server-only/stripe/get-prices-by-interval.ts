import type Stripe from 'stripe';

import type { STRIPE_PLAN_TYPE } from '@documenso/lib/constants/billing';
import { stripe } from '@documenso/lib/server-only/stripe';

// Utility type to handle usage of the `expand` option.
export type PriceWithProduct = Stripe.Price & { product: Stripe.Product };

// Only month/year are ever legitimate customer-facing billing intervals —
// deliberately narrower than Stripe's own `day`/`week`/`month`/`year` so a
// stray non-month/year test Price (tagged with the same `plan` metadata as a
// real product) can never surface as a selectable interval on a billing page
// again, regardless of what's active in Stripe.
export type PriceIntervals = Record<'month' | 'year', PriceWithProduct[]>;

export type GetPricesByIntervalOptions = {
  /**
   * Filter products by their meta 'plan' attribute.
   */
  plans?: STRIPE_PLAN_TYPE[];
};

export const getPricesByInterval = async ({ plans }: GetPricesByIntervalOptions = {}) => {
  let { data: prices } = await stripe.prices.search({
    query: `active:'true' type:'recurring'`,
    expand: ['data.product'],
    limit: 100,
  });

  prices = prices.filter((price) => {
    // We use `expand` to get the product, but it's not typed as part of the Price type.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const product = price.product as Stripe.Product;

    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const filter = !plans || plans.includes(product.metadata?.plan as STRIPE_PLAN_TYPE);

    // Filter out prices for products that are not active.
    return product.active && filter;
  });

  const intervals: PriceIntervals = {
    month: [],
    year: [],
  };

  // Add each price to the correct interval — silently drops anything that
  // isn't month/year (e.g. a `day` test-verification price) rather than
  // surfacing it.
  for (const price of prices) {
    if (price.recurring?.interval === 'month' || price.recurring?.interval === 'year') {
      // We use `expand` to get the product, but it's not typed as part of the Price type.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      intervals[price.recurring.interval].push(price as PriceWithProduct);
    }
  }

  // Order all prices by unit_amount.
  intervals.month.sort((a, b) => Number(a.unit_amount) - Number(b.unit_amount));
  intervals.year.sort((a, b) => Number(a.unit_amount) - Number(b.unit_amount));

  return intervals;
};
