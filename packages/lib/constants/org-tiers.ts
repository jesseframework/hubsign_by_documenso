import type { OrgSeatTier } from '@prisma/client';

export type OrgTierLimits = {
  name: string;
  /** Price per seat per month, in cents. */
  priceCents: number;
  /** % off (priceCents * 12) when billed yearly instead of monthly. */
  yearlyDiscountPercent: number;
  minSeats: number;
  /** `null` means unlimited — resolve per-consumer (e.g. `Infinity` for in-memory checks, a sentinel int for Prisma columns). */
  documents: number | null;
  recipients: number | null;
  directTemplates: number | null;
  dmsEnabled: boolean;
};

/**
 * Single source of truth for org seat tier pricing/limits. Previously duplicated
 * (with drifting representations of "unlimited": `Infinity`, `999999`, `'∞'`) across
 * `limits/server.ts`, `org-router.ts`, and `org+/billing.tsx`.
 *
 * Consolidated from 3 tiers (Starter/Pro/Enterprise) to 2 (Business/Enterprise) —
 * Business absorbs Starter's seat range and inherits Pro's old quotas as its
 * starting point, per the billing roadmap's Phase 5.
 */
export const ORG_SEAT_TIERS: Record<OrgSeatTier, OrgTierLimits> = {
  BUSINESS: {
    name: 'Business',
    priceCents: 3000,
    yearlyDiscountPercent: 10,
    minSeats: 5,
    documents: 100,
    recipients: 500,
    directTemplates: 20,
    dmsEnabled: false,
  },
  ENTERPRISE: {
    name: 'Enterprise',
    priceCents: 5500,
    yearlyDiscountPercent: 12,
    minSeats: 20,
    documents: null,
    recipients: null,
    directTemplates: null,
    dmsEnabled: true,
  },
};

export const ORG_DMS_ADDON_PRICE_CENTS = 1500;
/** Business is the only tier where DMS is a separate add-on — Enterprise bundles it into the tier price/discount above. */
export const ORG_DMS_ADDON_YEARLY_DISCOUNT_PERCENT = 10;

/** `OrgSeatPlan.documentsPerMonth`/`recipientsPerMonth`/`directTemplates` are non-nullable Prisma Ints and can't store `Infinity`. */
export const ORG_UNLIMITED_SENTINEL = 999999;

/** % off (monthlyPriceCents * 12) applied when billed yearly, rounded to the nearest cent. */
export const getOrgYearlyPriceCents = (monthlyPriceCents: number, discountPercent: number) =>
  Math.round(monthlyPriceCents * 12 * (1 - discountPercent / 100));

export type OrgBillingInterval = 'month' | 'year';
