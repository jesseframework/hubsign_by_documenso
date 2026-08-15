import type { OrgSeatTier } from '@prisma/client';

import { DEPLOYMENT_TYPE } from './app';

export type OrgTierLimits = {
  name: string;
  minSeats: number;
  /** Seat ceiling for this tier — `undefined` means no cap (Business/Enterprise). Team caps at 20 as a guardrail, not a billing meter. */
  maxSeats?: number;
  /** `null` means unlimited — resolve per-consumer (e.g. `Infinity` for in-memory checks, a sentinel int for Prisma columns). Enterprise's canonical value here is the *dedicated*-deployment one; on a shared deployment it's overridden — see `resolveOrgTierDocuments`. */
  documents: number | null;
  recipients: number | null;
  directTemplates: number | null;
  /**
   * Whether DMS ("Repositories") is bundled into this tier for free. Always
   * `false` now — DMS is a paid add-on for every tier that offers it (see
   * `dmsAddonAvailable` below for which do, and `ORG_DOC_BLOCK_SIZE` below
   * for the other org-level add-on). Kept as an explicit field rather than
   * deleted so `getOrgSeatLimits`'s bundling check stays uniform across
   * tiers rather than special-casing "no tier ever bundles it."
   */
  dmsEnabled: boolean;
  /**
   * Whether DMS ("Repositories") can be purchased as a paid add-on at all on
   * this tier. Distinct from `dmsEnabled` (which is about free bundling,
   * always `false`) — this is the actual purchasability fence. `false` on
   * Team by design: it's the deliberate upgrade path to Business, not an
   * oversight.
   */
  dmsAddonAvailable: boolean;
  /**
   * `true` means this tier is billed as one flat monthly/yearly price per
   * org, regardless of headcount — no purchased seat quantity, no cap.
   * Mechanically: every Stripe subscription item for this tier (seat and
   * Repositories add-on alike) always uses `quantity: 1`; a Stripe Price's
   * `unit_amount` doesn't itself know "per seat" vs "flat," that's entirely
   * about what quantity gets passed when the item is created. `false` means
   * the older purchased-quantity-with-cap model (Team only) — buy N seats
   * upfront, `minSeats`/`maxSeats` enforce a real range.
   */
  flatRate: boolean;
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
  TEAM: {
    name: 'Team',
    minSeats: 2,
    maxSeats: 20,
    // documents/recipients/directTemplates below 50/150/8 are the only
    // doc-sourced figure (documents); recipients/directTemplates are
    // proportional judgment calls scaled from Business's 500/20 — revisit if
    // product has stronger opinions.
    documents: 50,
    recipients: 150,
    directTemplates: 8,
    dmsEnabled: false,
    dmsAddonAvailable: false,
    flatRate: false,
  },
  BUSINESS: {
    name: 'Business',
    // `minSeats` is vestigial for a `flatRate` tier — there's no purchased
    // quantity left to enforce a minimum on. Kept on the type (rather than
    // made optional) so every tier has a uniform shape; `purchaseSeats` and
    // the purchase-quantity UI both skip it when `flatRate` is true.
    minSeats: 2,
    documents: 150,
    recipients: 500,
    directTemplates: 20,
    dmsEnabled: false,
    dmsAddonAvailable: true,
    flatRate: true,
  },
  ENTERPRISE: {
    name: 'Enterprise',
    minSeats: 2,
    documents: null,
    recipients: null,
    directTemplates: null,
    dmsEnabled: false,
    dmsAddonAvailable: true,
    flatRate: true,
  },
};

/**
 * Enterprise's document allowance is deployment-aware: the shared
 * multi-tenant instance (app.hubsign.io) meters it at 500/mo, matching what's
 * actually sold there; a dedicated single-tenant deployment (a separate
 * instance of this same codebase, per customer) stays unlimited —
 * `ORG_SEAT_TIERS.ENTERPRISE.documents` above (`null`) is that dedicated/
 * canonical value. Must agree with the deployment-conditional Enterprise seat
 * *price* lookup (`GetOrgSeatPriceOptions.deployment`) — a shared instance
 * charging the 500/mo price while silently still granting unlimited documents
 * would be a real mismatch between what's sold and what's enforced.
 */
export const resolveOrgTierDocuments = (
  tier: OrgSeatTier,
  deployment: 'shared' | 'dedicated' = DEPLOYMENT_TYPE(),
): number | null =>
  tier === 'ENTERPRISE' && deployment === 'shared' ? 500 : ORG_SEAT_TIERS[tier].documents;

/** Business-only add-on: an extra 100 documents/mo, stacked as many times as purchased. Purely a limit — its price is Stripe-authoritative, same as everything else priced. */
export const ORG_DOC_BLOCK_SIZE = 100;

/**
 * Marketing copy for the DMS add-on, shown alongside its (Stripe-authoritative)
 * price wherever it's offered on the org billing page. Rather than fetched
 * live from the Stripe product description (not structured enough to reuse
 * as UI copy directly). Keep in sync manually if the underlying feature set
 * changes. User-facing name is "Repositories" (renamed from "DMS"/"Document
 * Manager" in copy only — internal identifiers like `dmsEnabled` and this
 * constant's own name are unchanged).
 */
export const ORG_DMS_ADDON_DESCRIPTION =
  'Repositories add-on — email documents into your organization inbox, OCR-extract the data, and route them for review and signing.';

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
