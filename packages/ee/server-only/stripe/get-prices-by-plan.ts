import type Stripe from 'stripe';

import type { STRIPE_PLAN_TYPE } from '@documenso/lib/constants/billing';
import { stripe } from '@documenso/lib/server-only/stripe';

type PlanType = (typeof STRIPE_PLAN_TYPE)[keyof typeof STRIPE_PLAN_TYPE];

export const getPricesByPlan = async (plan: PlanType | PlanType[]) => {
  const planTypes: string[] = typeof plan === 'string' ? [plan] : plan;

  const prices = await stripe.prices.list({
    expand: ['data.product'],
    limit: 100,
  });

  // Product-level metadata, not Price-level — matches every other plan-type
  // filter in the codebase (see `getPricesByInterval`). A Price rotated
  // without also re-tagging its own metadata (only the parent Product's)
  // would otherwise silently fall out of this list — which is exactly what
  // happened to the Individual price, showing "Free Plan" for an actually-
  // active subscription.
  return prices.data.filter((price) => {
    // We use `expand` to get the product, but it's not typed as part of the Price type.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const product = price.product as Stripe.Product;

    return price.type === 'recurring' && planTypes.includes(product.metadata?.plan ?? '');
  });
};
