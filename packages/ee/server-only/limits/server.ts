import { DocumentSource, SubscriptionStatus } from '@prisma/client';
import { DateTime } from 'luxon';

import { IS_BILLING_ENABLED } from '@documenso/lib/constants/app';
import {
  ORG_SEAT_TIERS,
  resolveDocBlockSize,
  resolveOrgTierDocuments,
} from '@documenso/lib/constants/org-tiers';
import { prisma } from '@documenso/prisma';

import { getDocumentRelatedPrices } from '../stripe/get-document-related-prices.ts';
import {
  FREE_PLAN_LIMITS,
  INDIVIDUAL_LICENSE_LIMITS,
  LICENSE_GRACE_DAYS,
  SELFHOSTED_PLAN_LIMITS,
  TEAM_PLAN_LIMITS,
} from './constants';
import { ERROR_CODES } from './errors';
import { getOrgOcrQuota } from './ocr-quota';
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

  // License-key grants expire. If this org's plan is a license grant past its
  // grace window, fail closed to Free — ignoring any seatTier the grant set.
  // Normal Stripe plans (source='stripe') carry no expiresAt here.
  const licensePlan = await prisma.orgSeatPlan.findFirst({
    where: { organizationId: membership.organizationId, source: 'license_key' },
  });
  if (licensePlan?.expiresAt) {
    const graceMs = LICENSE_GRACE_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() > licensePlan.expiresAt.getTime() + graceMs) {
      // Fail closed to Free — UNLESS a paid (Stripe) plan has since backed the
      // seat (an org may buy a plan after a trial lapses). Only queried on the
      // rare expired-license path, so no cost for normal members.
      const paidPlan = await prisma.orgSeatPlan.findFirst({
        where: { organizationId: membership.organizationId, source: 'stripe' },
      });
      if (!paidPlan) {
        // OCR quota is org-wide (see getOrgOcrQuota) — even though this
        // member has no usable seat, the org itself may hold other plans
        // generating real Smart OCR usage.
        const ocrQuota = await getOrgOcrQuota({ organizationId: membership.organizationId });
        return {
          quota: { ...FREE_PLAN_LIMITS, dmsEnabled: false, ocrPages: ocrQuota.quota },
          remaining: { ...FREE_PLAN_LIMITS, dmsEnabled: false, ocrPages: ocrQuota.remaining },
        };
      }
    }
  }

  // If no seat assigned, user is in org but has no plan → treat as free
  if (!membership.seatTier) {
    const ocrQuota = await getOrgOcrQuota({ organizationId: membership.organizationId });
    return {
      quota: { ...FREE_PLAN_LIMITS, dmsEnabled: false, ocrPages: ocrQuota.quota },
      remaining: { ...FREE_PLAN_LIMITS, dmsEnabled: false, ocrPages: ocrQuota.remaining },
    };
  }

  // Map seat tier to limits, resolving the canonical table's `null` ("unlimited")
  // to `Infinity` for in-memory quota arithmetic.
  const tierConfig = ORG_SEAT_TIERS[membership.seatTier];

  // Needed unconditionally whenever a tier applies (not just for the
  // doc-block addition, as before) — `billingInterval`/`periodStart` decide
  // whether this org pools its quota annually.
  const seatPlan = tierConfig
    ? await prisma.orgSeatPlan.findFirst({
        where: { organizationId: membership.organizationId, tier: membership.seatTier },
        select: { docBlockQuantity: true, billingInterval: true, periodStart: true, createdAt: true },
      })
    : null;

  const period: 'month' | 'year' = seatPlan?.billingInterval === 'year' ? 'year' : 'month';

  const seatLimits: TLimitsSchema = tierConfig
    ? {
        documents: resolveOrgTierDocuments(membership.seatTier) ?? Infinity,
        recipients: tierConfig.recipients ?? Infinity,
        directTemplates: tierConfig.directTemplates ?? Infinity,
        dmsEnabled: tierConfig.dmsEnabled,
        period,
        // Overwritten below with the org-wide value from getOrgOcrQuota —
        // this placeholder just satisfies TLimitsSchema's shape.
        ocrPages: 0,
      }
    : structuredClone(FREE_PLAN_LIMITS);

  // Annual plans get the full year's allowance as one pool, not the same
  // monthly cap a monthly plan gets (HubSign-Pricing-Plan.md §2 rule 4) —
  // every tier's stated yearly figure is exactly its monthly figure × 12
  // (Business 150×12=1,800, Team 50×12=600, Enterprise Shared 500×12=6,000 —
  // verified against the doc), so no new per-tier config is needed here.
  if (period === 'year' && tierConfig && Number.isFinite(seatLimits.documents)) {
    seatLimits.documents *= 12;
  }

  // DMS addon overrides dmsEnabled
  if (membership.dmsAddon) {
    seatLimits.dmsEnabled = true;
  }

  // Purchased document volume blocks stack on top of the tier's base quota —
  // already `Infinity` for unlimited tiers (Enterprise Dedicated), so this is
  // a no-op there. This `Number.isFinite` guard is `resolveDocBlocksAvailable`'s
  // condition in disguise (same underlying `resolveOrgTierDocuments` call),
  // so it already correctly includes Enterprise Shared with no extra check.
  // Blocks pool annually too, same ×12 as the base quota, for consistency.
  if (tierConfig && Number.isFinite(seatLimits.documents) && seatPlan?.docBlockQuantity) {
    const blockSize = resolveDocBlockSize(membership.seatTier) * (period === 'year' ? 12 : 1);
    seatLimits.documents += seatPlan.docBlockQuantity * blockSize;
  }

  // Count usage this month (or this pooled year, for an annual plan) —
  // signature requests are counted at send, not creation (a saved draft
  // costs nothing), and `sentAt` is set once so a resend/reminder never
  // re-counts the same document. See `sendDocument`.
  const startOfCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const usageWindowStart =
    period === 'year'
      ? (seatPlan?.periodStart ?? seatPlan?.createdAt ?? startOfCalendarMonth)
      : startOfCalendarMonth;

  const [documents, directTemplates] = await Promise.all([
    prisma.document.count({
      where: {
        userId: user.id,
        sentAt: { gte: usageWindowStart },
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

  // Smart OCR quota is org-wide (see getOrgOcrQuota's own doc comment) —
  // deliberately not scoped to this member's own usage the way
  // documents/directTemplates are, since two of the three OCR triggers have
  // no acting user at all to scope by.
  const ocrQuota = await getOrgOcrQuota({ organizationId: membership.organizationId });
  seatLimits.ocrPages = ocrQuota.quota;

  const remaining = structuredClone(seatLimits);
  remaining.documents = Math.max(remaining.documents - documents, 0);
  remaining.directTemplates = Math.max(remaining.directTemplates - directTemplates, 0);
  remaining.ocrPages = ocrQuota.remaining;

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
      // License-key subscription — no Stripe price. Derive the quota from the
      // grant's tier/add-ons and honour the grace-then-close expiry.
      if (subscription.source === 'license_key') {
        const graceMs = LICENSE_GRACE_DAYS * 24 * 60 * 60 * 1000;
        if (subscription.periodEnd && Date.now() > subscription.periodEnd.getTime() + graceMs) {
          continue; // expired past grace → contributes nothing (fail closed to Free)
        }
        const licenseQuota = structuredClone(INDIVIDUAL_LICENSE_LIMITS);
        if (subscription.licenseAddons.includes('dms')) {
          licenseQuota.dmsEnabled = true;
          quota.dmsEnabled = true;
          remaining.dmsEnabled = true;
        }
        if (licenseQuota.documents > quota.documents && licenseQuota.recipients > quota.recipients) {
          const dmsWasEnabled = quota.dmsEnabled;
          quota = licenseQuota;
          remaining = structuredClone(quota);
          if (dmsWasEnabled) {
            quota.dmsEnabled = true;
            remaining.dmsEnabled = true;
          }
        }
        continue;
      }

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

  // Signature requests are counted at send, not creation — see
  // `getOrgSeatLimits` above and `sendDocument` for why.
  const [documents, directTemplates] = await Promise.all([
    prisma.document.count({
      where: {
        userId: user.id,
        teamId: null,
        sentAt: {
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
        period: 'month' as const,
        ocrPages: 0,
      },
      remaining: {
        documents: 0,
        recipients: 0,
        directTemplates: 0,
        dmsEnabled: false,
        period: 'month' as const,
        ocrPages: 0,
      },
    };
  }

  return {
    quota: structuredClone(TEAM_PLAN_LIMITS),
    remaining: structuredClone(TEAM_PLAN_LIMITS),
  };
};
