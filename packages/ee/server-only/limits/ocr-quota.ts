import type { OcrUsageSource } from '@prisma/client';

import { resolveOrgTierOcrPages } from '@documenso/lib/constants/org-tiers';
import { prisma } from '@documenso/prisma';

export type GetOrgOcrQuotaResult = {
  quota: number;
  remaining: number;
};

/**
 * Smart OCR (BMS ML) page quota for an org, summed across every
 * `OrgSeatPlan` it currently holds — deliberately org-wide, not per seat
 * holder. Two of the three OCR triggers (inbound-email ingest, a signer's
 * own attachment upload) have no acting user at all, so `organizationId` is
 * the only anchor every trigger shares; `documents`/`recipients` stay
 * per-user in `getOrgSeatLimits` because every path that consumes those
 * does have one.
 *
 * Billing interval is locked uniformly across every tier an org holds (see
 * `purchaseSeats`/`changePlan`'s own "a single Stripe subscription can't
 * mix monthly/yearly items" invariant) — so in practice every plan's own
 * usage window agrees. This takes the earliest (most inclusive) window
 * across plans rather than assuming exact agreement, so a brief
 * transitional mismatch (e.g. mid-`changePlan`) undercounts remaining
 * quota rather than overcounting it.
 */
export const getOrgOcrQuota = async ({
  organizationId,
}: {
  organizationId: number;
}): Promise<GetOrgOcrQuotaResult> => {
  const seatPlans = await prisma.orgSeatPlan.findMany({
    where: { organizationId },
    select: { tier: true, billingInterval: true, periodStart: true, createdAt: true },
  });

  const startOfCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

  if (seatPlans.length === 0) {
    // No seat at all — org-scoped Free fallback, matching
    // `getOrgSeatLimits`'s own no-seat-assigned treatment.
    const usage = await sumProcessedPages({ organizationId, windowStart: startOfCalendarMonth });
    const quota = 30; // FREE_PLAN_LIMITS.ocrPages — see constants.ts, kept in sync manually.
    return { quota, remaining: Math.max(quota - usage, 0) };
  }

  let quota = 0;
  let windowStart = startOfCalendarMonth;

  for (const plan of seatPlans) {
    const isAnnual = plan.billingInterval === 'year';
    const planPages = resolveOrgTierOcrPages(plan.tier) ?? Infinity;

    quota += isAnnual ? planPages * 12 : planPages;

    const planWindowStart = isAnnual
      ? (plan.periodStart ?? plan.createdAt)
      : startOfCalendarMonth;

    if (planWindowStart < windowStart) {
      windowStart = planWindowStart;
    }
  }

  const usage = await sumProcessedPages({ organizationId, windowStart });

  return { quota, remaining: Math.max(quota - usage, 0) };
};

const sumProcessedPages = async ({
  organizationId,
  windowStart,
}: {
  organizationId: number;
  windowStart: Date;
}): Promise<number> => {
  const { _sum } = await prisma.orgOcrUsage.aggregate({
    where: { organizationId, status: 'PROCESSED', createdAt: { gte: windowStart } },
    _sum: { pageCount: true },
  });

  return _sum.pageCount ?? 0;
};

export type OcrQuotaDecision = { allowed: true } | { allowed: false; usageId: string };

/**
 * Checks the org's current Smart OCR quota; if there's room, does nothing
 * (the caller proceeds to the real BMS ML call). If not, records a `QUEUED`
 * `OrgOcrUsage` row and tells the caller to skip the BMS ML call entirely —
 * soft-stop, not a hard block, per the confirmed design: OCR pauses, nothing
 * else about the document/signing flow breaks. The drain job re-attempts
 * queued rows once quota frees up.
 */
export const assertOcrQuotaOrQueue = async ({
  organizationId,
  pageCount,
  source,
  sourceId,
}: {
  organizationId: number;
  pageCount: number;
  source: OcrUsageSource;
  sourceId: string;
}): Promise<OcrQuotaDecision> => {
  const { remaining } = await getOrgOcrQuota({ organizationId });

  if (!Number.isFinite(remaining) || remaining >= pageCount) {
    return { allowed: true };
  }

  const usage = await prisma.orgOcrUsage.create({
    data: { organizationId, source, sourceId, pageCount, status: 'QUEUED' },
  });

  return { allowed: false, usageId: usage.id };
};

/**
 * Records a successful BMS ML call against the org's quota — a fresh row
 * for a normal (non-drain) run, or an in-place update of the existing
 * `QUEUED` row when this call came from the drain job (`existingUsageId`
 * set), so draining a queued item never double-counts it.
 */
export const recordOcrPagesProcessed = async ({
  organizationId,
  pageCount,
  source,
  sourceId,
  triggeredById,
  existingUsageId,
}: {
  organizationId: number;
  pageCount: number;
  source: OcrUsageSource;
  sourceId: string;
  triggeredById?: number | null;
  existingUsageId?: string;
}): Promise<void> => {
  if (existingUsageId) {
    await prisma.orgOcrUsage.update({
      where: { id: existingUsageId },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
    return;
  }

  await prisma.orgOcrUsage.create({
    data: {
      organizationId,
      source,
      sourceId,
      pageCount,
      triggeredById,
      status: 'PROCESSED',
      processedAt: new Date(),
    },
  });
};
