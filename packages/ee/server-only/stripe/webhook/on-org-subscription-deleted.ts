import { prisma } from '@documenso/prisma';

export type OnOrgSubscriptionDeletedOptions = {
  organizationId: number;
};

export const onOrgSubscriptionDeleted = async ({
  organizationId,
}: OnOrgSubscriptionDeletedOptions) => {
  await prisma.organization.update({
    where: {
      id: organizationId,
    },
    data: {
      billingStatus: 'inactive',
    },
  });
};
