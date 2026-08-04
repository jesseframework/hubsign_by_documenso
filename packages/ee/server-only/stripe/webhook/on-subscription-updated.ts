import type { Prisma } from '@prisma/client';
import { SubscriptionStatus } from '@prisma/client';
import { match } from 'ts-pattern';

import type { Stripe } from '@documenso/lib/server-only/stripe';
import { prisma } from '@documenso/prisma';

export type OnSubscriptionUpdatedOptions = {
  userId?: number;
  teamId?: number;
  subscription: Stripe.Subscription;
};

export const onSubscriptionUpdated = async ({
  userId,
  teamId,
  subscription,
}: OnSubscriptionUpdatedOptions) => {
  await prisma.subscription.upsert(
    mapStripeSubscriptionToPrismaUpsertAction(subscription, userId, teamId),
  );
};

export const mapStripeSubscriptionToPrismaUpsertAction = (
  subscription: Stripe.Subscription,
  userId?: number,
  teamId?: number,
): Prisma.SubscriptionUpsertArgs => {
  if ((!userId && !teamId) || (userId && teamId)) {
    throw new Error('Either userId or teamId must be provided.');
  }

  const status = match(subscription.status)
    .with('active', () => SubscriptionStatus.ACTIVE)
    .with('past_due', () => SubscriptionStatus.PAST_DUE)
    .otherwise(() => SubscriptionStatus.INACTIVE);

  const subscriptionItem = subscription.items.data[0];

  // Newer Stripe API versions return the billing period on the subscription
  // item rather than the top-level subscription object. Prefer the item's
  // value, falling back to the top-level field for older API versions.
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  const itemPeriodEnd = (subscriptionItem as unknown as { current_period_end?: number })
    .current_period_end;

  const periodEnd = new Date((itemPeriodEnd ?? subscription.current_period_end) * 1000);

  return {
    where: {
      planId: subscription.id,
    },
    create: {
      status: status,
      planId: subscription.id,
      priceId: subscriptionItem.price.id,
      periodEnd,
      userId: userId ?? null,
      teamId: teamId ?? null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
    update: {
      status: status,
      planId: subscription.id,
      priceId: subscriptionItem.price.id,
      periodEnd,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    },
  };
};
