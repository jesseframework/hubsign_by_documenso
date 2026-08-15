import { prisma } from '@documenso/prisma';

export type OnOrgSubscriptionDeletedOptions = {
  organizationId: number;
};

export const onOrgSubscriptionDeleted = async ({
  organizationId,
}: OnOrgSubscriptionDeletedOptions) => {
  // Clearing `stripeSubscriptionId` (not just flipping `billingStatus`)
  // matters: `purchaseSeats` decides whether to top up an existing
  // subscription or start a fresh Checkout session purely by whether this
  // field is set. Leaving it pointed at the now-canceled subscription would
  // make the next purchase attempt try to update a dead subscription, which
  // Stripe rejects — the org would be unable to ever buy a plan again.
  await prisma.organization.update({
    where: {
      id: organizationId,
    },
    data: {
      billingStatus: 'inactive',
      stripeSubscriptionId: null,
      seatCount: 0,
    },
  });
};
