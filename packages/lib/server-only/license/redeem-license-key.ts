/**
 * Redeem a WorkHub-minted HubSign license key and apply the grant locally.
 *
 * Flow: guard (no active paid Stripe plan) → POST the key to WorkHub's redeem
 * API (which verifies signature + single-use + pinned subject) → apply the
 * returned grant to HubSign's own entitlement state, reusing the existing
 * tier/limits machinery.
 *
 * Product decisions:
 *   • A key applies ONLY IF the org/user has no active Stripe subscription.
 *   • Expiry = grace period, then fail closed to Free (the limits resolver
 *     enforces this — see limits/server.ts + LICENSE_GRACE_DAYS).
 *
 * The caller picks the path: pass organizationId for an ORG (seat-plan) grant
 * (redeemed on the org billing page); omit it for an INDIVIDUAL grant.
 */
import { OrganizationRole, OrgSeatTier, SubscriptionStatus } from '@prisma/client';

import {
  ORG_SEAT_TIERS,
  ORG_UNLIMITED_SENTINEL,
  resolveOrgTierDocuments,
} from '@documenso/lib/constants/org-tiers';
import { prisma } from '@documenso/prisma';

import {
  redeemWorkHubLicenseKey,
  WorkHubLicenseError,
  type WorkHubLicenseGrant,
} from './workhub-client';

export class LicenseRedeemError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'LicenseRedeemError';
  }
}

function mapWorkHubError(err: unknown): LicenseRedeemError {
  if (err instanceof WorkHubLicenseError) {
    const friendly: Record<string, string> = {
      invalid_key: 'That license key is not valid.',
      subject_mismatch: 'That key was issued for a different account.',
      already_redeemed: 'That license key has already been used.',
      revoked: 'That license key has been revoked.',
      unknown_key: 'That license key is not recognised.',
      not_configured: 'License activation is not configured on this deployment.',
      unreachable: 'Could not reach the licensing service. Please try again.',
    };
    return new LicenseRedeemError(friendly[err.code] ?? err.message, err.code);
  }
  return new LicenseRedeemError('License activation failed.', 'unknown');
}

function grantEnablesDms(grant: WorkHubLicenseGrant): boolean {
  return grant.tier === 'enterprise' || grant.addons.includes('dms');
}

export type RedeemLicenseKeyOptions = {
  key: string;
  userId: number;
  /** Provided → org (seat-plan) grant; omitted → individual grant. */
  organizationId?: number;
};

export async function redeemLicenseKey(
  opts: RedeemLicenseKeyOptions,
): Promise<{ grant: WorkHubLicenseGrant }> {
  const user = await prisma.user.findUnique({ where: { id: opts.userId } });
  if (!user) throw new LicenseRedeemError('User not found.', 'user_not_found');

  return opts.organizationId != null
    ? redeemOrgGrant(opts.key, user.id, opts.organizationId)
    : redeemIndividualGrant(opts.key, user.id, user.email);
}

async function redeemOrgGrant(key: string, userId: number, organizationId: number) {
  // Authorization — only an org admin may activate a key for the org.
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
  });
  if (!membership) throw new LicenseRedeemError('You are not a member of this organization.', 'not_member');
  if (membership.role !== OrganizationRole.ORG_ADMIN) {
    throw new LicenseRedeemError('Only an organization admin can redeem a license key.', 'not_admin');
  }

  // Guard — a key only activates a free/inactive org (never overrides a paid plan).
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new LicenseRedeemError('Organization not found.', 'org_not_found');
  if (org.billingStatus === 'active') {
    throw new LicenseRedeemError(
      'This organization already has an active paid subscription; a license key can only activate a free organization.',
      'already_paid',
    );
  }

  let grant: WorkHubLicenseGrant;
  try {
    grant = await redeemWorkHubLicenseKey(key, String(organizationId));
  } catch (err) {
    throw mapWorkHubError(err);
  }
  if (grant.grantType !== 'org') {
    throw new LicenseRedeemError('That key is an individual key — redeem it on your personal billing page.', 'wrong_grant_type');
  }

  const tier: OrgSeatTier = grant.tier === 'enterprise' ? OrgSeatTier.ENTERPRISE : OrgSeatTier.BUSINESS;
  const limits = ORG_SEAT_TIERS[tier];
  const dms = grantEnablesDms(grant);
  const expiresAt = new Date(grant.expiresAt);
  const seats = grant.seats ?? 1;

  await prisma.$transaction(async (tx) => {
    // One license-sourced plan per org — reuse the existing row if a prior
    // (expired) grant is on file, else create it. `source` + `expiresAt` are
    // what the limits resolver checks for expiry.
    const planData = {
      tier,
      documentsPerMonth: resolveOrgTierDocuments(tier) ?? ORG_UNLIMITED_SENTINEL,
      recipientsPerMonth: limits.recipients ?? ORG_UNLIMITED_SENTINEL,
      directTemplates: limits.directTemplates ?? ORG_UNLIMITED_SENTINEL,
      dmsEnabled: dms,
      quantity: seats,
      billingInterval: 'month',
      // Irrelevant in practice — always 'month' above, and getOrgSeatLimits
      // only ever reads periodStart for an annual plan — set anyway so the
      // row is self-describing.
      periodStart: new Date(),
      source: 'license_key',
      expiresAt,
    };
    const existing = await tx.orgSeatPlan.findFirst({ where: { organizationId, source: 'license_key' } });
    if (existing) {
      await tx.orgSeatPlan.update({ where: { id: existing.id }, data: planData });
    } else {
      await tx.orgSeatPlan.create({ data: { ...planData, organizationId } });
    }

    // The grant takes effect via the member's seat — the resolver reads
    // membership.seatTier + dmsAddon. Assign the redeeming admin; other seats
    // (up to `quantity`) are assigned by the admin as normal.
    await tx.organizationMember.update({
      where: { id: membership.id },
      data: { seatTier: tier, dmsAddon: dms },
    });

    await tx.licenseKeyRedemption.create({
      data: {
        jti: grant.jti,
        grantType: 'org',
        subject: String(organizationId),
        tier: grant.tier,
        addons: grant.addons,
        seats,
        days: grant.days,
        expiresAt,
        organizationId,
        redeemedByUserId: userId,
      },
    });
  });

  return { grant };
}

async function redeemIndividualGrant(key: string, userId: number, email: string) {
  // Guard — a key only activates a free account (never overrides a paid plan).
  const activeStripe = await prisma.subscription.findFirst({
    where: { userId, status: SubscriptionStatus.ACTIVE, source: 'stripe' },
  });
  if (activeStripe) {
    throw new LicenseRedeemError(
      'You already have an active paid subscription; a license key can only activate a free account.',
      'already_paid',
    );
  }

  let grant: WorkHubLicenseGrant;
  try {
    grant = await redeemWorkHubLicenseKey(key, email);
  } catch (err) {
    throw mapWorkHubError(err);
  }
  if (grant.grantType !== 'individual') {
    throw new LicenseRedeemError('That key is an organization key — redeem it on the organization billing page.', 'wrong_grant_type');
  }

  const expiresAt = new Date(grant.expiresAt);

  await prisma.$transaction(async (tx) => {
    // A license-sourced subscription: no Stripe price, so the resolver derives
    // the quota from licenseTier/licenseAddons; periodEnd carries the expiry.
    await tx.subscription.create({
      data: {
        status: SubscriptionStatus.ACTIVE,
        planId: `license:${grant.jti}`, // synthetic, unique (planId is @unique)
        priceId: '',
        periodEnd: expiresAt,
        userId,
        source: 'license_key',
        licenseTier: grant.tier,
        licenseAddons: grant.addons,
      },
    });

    await tx.licenseKeyRedemption.create({
      data: {
        jti: grant.jti,
        grantType: 'individual',
        subject: email,
        tier: grant.tier,
        addons: grant.addons,
        seats: null,
        days: grant.days,
        expiresAt,
        userId,
        redeemedByUserId: userId,
      },
    });
  });

  return { grant };
}
