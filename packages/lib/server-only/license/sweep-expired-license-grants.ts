/**
 * Daily sweep of expired license grants. The limits resolver already fails
 * closed lazily on read, so this is cleanup — it stops expired grants from
 * lingering as "active" and releases seats they held.
 *
 *   • Individual: license Subscriptions past their grace window → INACTIVE.
 *   • Org: license OrgSeatPlans past grace → release the member seats they
 *     granted (unless the org has since taken a paid plan) and remove the stale
 *     plan row (audit lives in LicenseKeyRedemption).
 *
 * Idempotent — safe to run repeatedly.
 */
import { SubscriptionStatus } from '@prisma/client';

import { LICENSE_GRACE_DAYS } from '@documenso/ee/server-only/limits/constants';
import { prisma } from '@documenso/prisma';

export async function sweepExpiredLicenseGrants() {
  const cutoff = new Date(Date.now() - LICENSE_GRACE_DAYS * 24 * 60 * 60 * 1000);

  // 1. Individual license subscriptions past grace → INACTIVE.
  const deactivated = await prisma.subscription.updateMany({
    where: {
      source: 'license_key',
      status: SubscriptionStatus.ACTIVE,
      periodEnd: { lt: cutoff },
    },
    data: { status: SubscriptionStatus.INACTIVE },
  });

  // 2. Org license plans past grace → release seats + drop the stale plan.
  const expiredOrgPlans = await prisma.orgSeatPlan.findMany({
    where: { source: 'license_key', expiresAt: { lt: cutoff } },
    select: { id: true, organizationId: true },
  });

  let seatsReleased = 0;
  for (const plan of expiredOrgPlans) {
    const org = await prisma.organization.findUnique({
      where: { id: plan.organizationId },
      select: { billingStatus: true },
    });
    const orgHasPaidPlan = org?.billingStatus === 'active';

    await prisma.$transaction(async (tx) => {
      if (!orgHasPaidPlan) {
        const released = await tx.organizationMember.updateMany({
          where: { organizationId: plan.organizationId, seatTier: { not: null } },
          data: { seatTier: null, dmsAddon: false },
        });
        seatsReleased += released.count;
      }
      await tx.orgSeatPlan.delete({ where: { id: plan.id } });
    });
  }

  return {
    individualSubscriptionsDeactivated: deactivated.count,
    orgPlansExpired: expiredOrgPlans.length,
    memberSeatsReleased: seatsReleased,
  };
}
