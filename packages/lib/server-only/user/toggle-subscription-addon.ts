import { SubscriptionStatus } from '@prisma/client';

import { onSubscriptionUpdated } from '@documenso/ee/server-only/stripe/webhook/on-subscription-updated';
import { stripe } from '@documenso/lib/server-only/stripe';

import { getSubscriptionsByUserId } from '../subscription/get-subscriptions-by-user-id';

export type ToggleSubscriptionAddonOptions = {
  userId: number;
  priceId: string;
  action: 'add' | 'remove';
};

/**
 * Adds or removes a stackable add-on (e.g. the Document Manager add-on) as a
 * second item on a user's existing subscription, leaving the primary plan
 * item untouched. Unlike `updateSubscriptionPlan`, this never replaces the
 * subscription's primary price.
 */
export const toggleSubscriptionAddon = async ({
  userId,
  priceId,
  action,
}: ToggleSubscriptionAddonOptions) => {
  const subscriptions = await getSubscriptionsByUserId({ userId });

  const activeSubscription = subscriptions.find(
    (subscription) => subscription.status === SubscriptionStatus.ACTIVE,
  );

  if (!activeSubscription) {
    throw new Error('No active subscription found');
  }

  const stripeSubscription = await stripe.subscriptions.retrieve(activeSubscription.planId);

  const existingItem = stripeSubscription.items.data.find((item) => item.price.id === priceId);

  let updatedSubscription = stripeSubscription;

  if (action === 'add' && !existingItem) {
    updatedSubscription = await stripe.subscriptions.update(activeSubscription.planId, {
      items: [{ price: priceId }],
      proration_behavior: 'create_prorations',
    });
  }

  if (action === 'remove' && existingItem) {
    updatedSubscription = await stripe.subscriptions.update(activeSubscription.planId, {
      items: [{ id: existingItem.id, deleted: true }],
      proration_behavior: 'create_prorations',
    });
  }

  await onSubscriptionUpdated({ userId, subscription: updatedSubscription });

  return updatedSubscription;
};
