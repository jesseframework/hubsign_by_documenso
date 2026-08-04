import { DocumentSource, SubscriptionStatus } from '@prisma/client';
import { DateTime } from 'luxon';

import { IS_BILLING_ENABLED } from '@documenso/lib/constants/app';
import { ORG_SEAT_TIERS } from '@documenso/lib/constants/org-tiers';
import { prisma } from '@documenso/prisma';

import { getDocumentRelatedPrices } from '../stripe/get-document-related-prices.ts';
import { FREE_PLAN_LIMITS, SELFHOSTED_PLAN_LIMITS, TEAM_PLAN_LIMITS } from './constants';
import { ERROR_CODES } from './errors';
import type { TLimitsResponseSchema, TLimitsSchema } from './schema';
import { ZLimitsSchema } from './schema';

/**
 * Check if user is in an organization with an assigned seat.
 * If so, use the seat's plan limits instead of personal subscription.
 */
const getOrgSeatLimits = async (email: string): Promise<TLimitsResponseSchema | null> => {
  const user = await prisma.user.findFirst({
    where: { email },
    include: {
      organizationMemberships: true,
    },
  });

  if (!user || user.organizationMemberships.length === 0) return null;

  const membership = user.organizationMemberships[0];

  // If no seat assigned, user is in org but has no plan → treat as free
  if (!membership.seatTier) {
    return {
      quota: { ...FREE_PLAN_LIMITS, dmsEnabled: false },
      remaining: { ...FREE_PLAN_LIMITS, dmsEnabled: false },
    };
  }

  // Map seat tier to limits, resolving the canonical table's `null` ("unlimited")
  // to `Infinity` for in-memory quota arithmetic.
  const tierConfig = ORG_SEAT_TIERS[membership.seatTier];

  const seatLimits: TLimitsSchema = tierConfig
    ? {
        documents: tierConfig.documents ?? Infinity,
        recipients: tierConfig.recipients ?? Infinity,
        directTemplates: tierConfig.directTemplates ?? Infinity,
        dmsEnabled: tierConfig.dmsEnabled,
      }
    : structuredClone(FREE_PLAN_LIMITS);

  // DMS addon overrides dmsEnabled
  if (membership.dmsAddon) {
    seatLimits.dmsEnabled = true;
  }

  // Count usage this month
  const [documents, directTemplates] = await Promise.all([
    prisma.document.count({
      where: {
        userId: user.id,
        createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        source: { not: 'TEMPLATE_DIRECT_LINK' },
      },
    }),
    prisma.template.count({
      where: {
        userId: user.id,
        directLink: { isNot: null },
      },
    }),
  ]);

  const remaining = structuredClone(seatLimits);
  remaining.documents = Math.max(remaining.documents - documents, 0);
  remaining.directTemplates = Math.max(remaining.directTemplates - directTemplates, 0);

  return {
    quota: seatLimits,
    remaining,
  };
};

export type GetServerLimitsOptions = {
  email: string;
  teamId?: number | null;
};

export const getServerLimits = async ({
  email,
  teamId,
}: GetServerLimitsOptions): Promise<TLimitsResponseSchema> => {
  if (!IS_BILLING_ENABLED()) {
    return {
      quota: SELFHOSTED_PLAN_LIMITS,
      remaining: SELFHOSTED_PLAN_LIMITS,
    };
  }

  if (!email) {
    throw new Error(ERROR_CODES.UNAUTHORIZED);
  }

  // Check if user is in an org with an assigned seat — use org seat limits
  const orgSeatLimits = await getOrgSeatLimits(email);
  if (orgSeatLimits) {
    return orgSeatLimits;
  }

  return teamId ? handleTeamLimits({ email, teamId }) : handleUserLimits({ email });
};

type HandleUserLimitsOptions = {
  email: string;
};

const handleUserLimits = async ({ email }: HandleUserLimitsOptions) => {
  const user = await prisma.user.findFirst({
    where: {
      email,
    },
    include: {
      subscriptions: true,
    },
  });

  if (!user) {
    throw new Error(ERROR_CODES.USER_FETCH_FAILED);
  }

  let quota = structuredClone(FREE_PLAN_LIMITS);
  let remaining = structuredClone(FREE_PLAN_LIMITS);

  const activeSubscriptions = user.subscriptions.filter(
    ({ status }) => status === SubscriptionStatus.ACTIVE,
  );

  if (activeSubscriptions.length > 0) {
    const documentPlanPrices = await getDocumentRelatedPrices();

    for (const subscription of activeSubscriptions) {
      const price = documentPlanPrices.find((price) => price.id === subscription.priceId);

      if (!price || typeof price.product === 'string' || price.product.deleted) {
        continue;
      }

      const productMetadata = 'metadata' in price.product ? price.product.metadata : {};
      const currentQuota = ZLimitsSchema.parse(productMetadata);

      // If this is a DMS add-on, just merge the dmsEnabled flag
      if (currentQuota.dmsEnabled) {
        quota.dmsEnabled = true;
        remaining.dmsEnabled = true;
      }

      // Use the subscription with the highest quota.
      if (currentQuota.documents > quota.documents && currentQuota.recipients > quota.recipients) {
        const dmsWasEnabled = quota.dmsEnabled;
        quota = currentQuota;
        remaining = structuredClone(quota);
        // Preserve DMS flag from other subscriptions
        if (dmsWasEnabled) {
          quota.dmsEnabled = true;
          remaining.dmsEnabled = true;
        }
      }
    }

    // Assume all active subscriptions provide unlimited direct templates.
    remaining.directTemplates = Infinity;
  }

  const [documents, directTemplates] = await Promise.all([
    prisma.document.count({
      where: {
        userId: user.id,
        teamId: null,
        createdAt: {
          gte: DateTime.utc().startOf('month').toJSDate(),
        },
        source: {
          not: DocumentSource.TEMPLATE_DIRECT_LINK,
        },
      },
    }),
    prisma.template.count({
      where: {
        userId: user.id,
        teamId: null,
        directLink: {
          isNot: null,
        },
      },
    }),
  ]);

  remaining.documents = Math.max(remaining.documents - documents, 0);
  remaining.directTemplates = Math.max(remaining.directTemplates - directTemplates, 0);

  return {
    quota,
    remaining,
  };
};

type HandleTeamLimitsOptions = {
  email: string;
  teamId: number;
};

const handleTeamLimits = async ({ email, teamId }: HandleTeamLimitsOptions) => {
  const team = await prisma.team.findFirst({
    where: {
      id: teamId,
      members: {
        some: {
          user: {
            email,
          },
        },
      },
    },
    include: {
      subscription: true,
    },
  });

  if (!team) {
    throw new Error('Team not found');
  }

  const { subscription } = team;

  if (subscription && subscription.status === SubscriptionStatus.INACTIVE) {
    return {
      quota: {
        documents: 0,
        recipients: 0,
        directTemplates: 0,
        dmsEnabled: false,
      },
      remaining: {
        documents: 0,
        recipients: 0,
        directTemplates: 0,
        dmsEnabled: false,
      },
    };
  }

  return {
    quota: structuredClone(TEAM_PLAN_LIMITS),
    remaining: structuredClone(TEAM_PLAN_LIMITS),
  };
};
