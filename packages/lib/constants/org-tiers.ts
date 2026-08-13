import type { OrgSeatTier } from '@prisma/client';

export type OrgTierLimits = {
  name: string;
  minSeats: number;
  /** `null` means unlimited — resolve per-consumer (e.g. `Infinity` for in-memory checks, a sentinel int for Prisma columns). */
  documents: number | null;
  recipients: number | null;
  directTemplates: number | null;
  /**
   * Whether DMS is bundled into this tier for free. Always `false` now — DMS
   * is a paid add-on for every tier (see `ORG_DOC_BLOCK_SIZE` below for the
   * other org-level add-on). Kept as an explicit field rather than deleted so
   * `getOrgSeatLimits`'s bundling check stays uniform across tiers rather
   * than special-casing "no tier ever bundles it."
   */
  dmsEnabled: boolean;
};

/**
 * Single source of truth for org seat tier *limits* — seat minimums and
 * document/recipient/template quotas. Pricing is deliberately NOT here: it's
 * Stripe-authoritative, same pattern as the individual/team plans
 * (`get-prices-by-interval.ts`) — see `getOrgSeatPrice` in
 * `packages/ee/server-only/stripe/get-org-seat-price.ts`, which reads live
 * Price amounts from Stripe by Product metadata instead of the app pushing a
 * hardcoded cents value into Stripe. Changing what a plan *costs* is a Stripe
 * dashboard change; changing what a plan *includes* is a change here.
 *
 * Previously duplicated (with drifting representations of "unlimited":
 * `Infinity`, `999999`, `'∞'`) across `limits/server.ts`, `org-router.ts`, and
 * `org+/billing.tsx`.
 *
 * Consolidated from 3 tiers (Starter/Pro/Enterprise) to 2 (Business/Enterprise) —
 * Business absorbs Starter's seat range and inherits Pro's old quotas as its
 * starting point, per the billing roadmap's Phase 5.
 */
export const ORG_SEAT_TIERS: Record<OrgSeatTier, OrgTierLimits> = {
  BUSINESS: {
    name: 'Business',
    minSeats: 2,
    documents: 150,
    recipients: 500,
    directTemplates: 20,
    dmsEnabled: false,
  },
  ENTERPRISE: {
    name: 'Enterprise',
    minSeats: 2,
    documents: null,
    recipients: null,
    directTemplates: null,
    dmsEnabled: false,
  },
};

/** Business-only add-on: an extra 100 documents/mo, stacked as many times as purchased. Purely a limit — its price is Stripe-authoritative, same as everything else priced. */
export const ORG_DOC_BLOCK_SIZE = 100;

/**
 * Marketing copy for the DMS add-on, shown alongside its (Stripe-authoritative)
 * price wherever it's offered on the org billing page. Copied verbatim from
 * the Stripe product ("Document Manager Add-On") rather than fetched live,
 * since Stripe Product descriptions aren't structured enough to reuse as UI
 * copy directly. Keep in sync manually if the Stripe product copy changes.
 */
export const ORG_DMS_ADDON_DESCRIPTION =
  'Document Manager add-on — email documents into your organization inbox, OCR-extract the data, and route them for review and signing.';

export const ORG_DMS_ADDON_FEATURES = [
  'Bulk document upload',
  'OCR extraction queue (BMS ML)',
  'Full-text search',
  'Custom filing structure',
  'Favorites',
  'Approval workflows',
  'Retrieval requests',
  'Retention policies',
  'Activity log',
  'Compliance templates',
  'AI Agent base access',
];

/** `OrgSeatPlan.documentsPerMonth`/`recipientsPerMonth`/`directTemplates` are non-nullable Prisma Ints and can't store `Infinity`. */
export const ORG_UNLIMITED_SENTINEL = 999999;

export type OrgBillingInterval = 'month' | 'year';
