import { SubscriptionStatus } from '@prisma/client';

import { onSubscriptionUpdated } from '@documenso/ee/server-only/stripe/webhook/on-subscription-updated';
import { stripe } from '@documenso/lib/server-only/stripe';

import { getSubscriptionsByUserId } from '../subscription/get-subscriptions-by-user-id';

export type UpdateSubscriptionPlanOptions = {
  userId: number;
  priceId: string;
};

/**
 * Switches a user's active subscription to a different price (upgrade or
 * downgrade), letting Stripe handle proration, and syncs the result back
 * into the local database immediately rather than waiting for a webhook.
 */
export const updateSubscriptionPlan = async ({ userId, priceId }: UpdateSubscriptionPlanOptions) => {
  const subscriptions = await getSubscriptionsByUserId({ userId });

  const activeSubscription = subscriptions.find(
    (subscription) => subscription.status === SubscriptionStatus.ACTIVE,
  );

  if (!activeSubscription) {
    throw new Error('No active subscription found');
  }

  const stripeSubscription = await stripe.subscriptions.retrieve(activeSubscription.planId);
  const currentItem = stripeSubscription.items.data[0];

  const updatedSubscription = await stripe.subscriptions.update(activeSubscription.planId, {
    items: [
      {
        id: currentItem.id,
        price: priceId,
      },
    ],
    proration_behavior: 'create_prorations',
  });

  await onSubscriptionUpdated({ userId, subscription: updatedSubscription });

  return updatedSubscription;
};
