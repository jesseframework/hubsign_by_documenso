import { getPortalSession } from '@documenso/ee/server-only/stripe/get-portal-session';
import { IS_BILLING_ENABLED } from '@documenso/lib/constants/app';
import { TEAM_MEMBER_ROLE_PERMISSIONS_MAP } from '@documenso/lib/constants/teams';
import { prisma } from '@documenso/prisma';

import { AppError, AppErrorCode } from '../../errors/app-error';

export type CreateTeamBillingPortalOptions = {
  userId: number;
  teamId: number;
};

export const createTeamBillingPortal = async ({
  userId,
  teamId,
}: CreateTeamBillingPortalOptions) => {
  if (!IS_BILLING_ENABLED()) {
    // See create-billing-portal.ts's identical fix (F-19) — a clean 400
    // instead of an unhandled 500 for this expected, named state.
    throw new AppError(AppErrorCode.NOT_SETUP, { message: 'Billing is not enabled' });
  }

  const team = await prisma.team.findFirstOrThrow({
    where: {
      id: teamId,
      members: {
        some: {
          userId,
          role: {
            in: TEAM_MEMBER_ROLE_PERMISSIONS_MAP['MANAGE_BILLING'],
          },
        },
      },
    },
    include: {
      subscription: true,
    },
  });

  if (!team.subscription) {
    throw new Error('Team has no subscription');
  }

  if (!team.customerId) {
    throw new Error('Team has no customerId');
  }

  return getPortalSession({
    customerId: team.customerId,
  });
};
