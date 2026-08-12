import { createElement } from 'react';

import { msg } from '@lingui/core/macro';
import { SubscriptionStatus } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { DateTime } from 'luxon';
import { z } from 'zod';

import {
  getOrgSeatPrice,
  matchOrgPrice,
  searchActiveOrgPrices,
} from '@documenso/lib/server-only/stripe/get-org-seat-price';
import { onOrgSubscriptionUpdated } from '@documenso/ee/server-only/stripe/webhook/on-org-subscription-updated';
import { onSubscriptionDeleted } from '@documenso/ee/server-only/stripe/webhook/on-subscription-deleted';
import {
  getSubscriptionPeriodEndISO,
  resolveOrgPlanNameAndPrice,
} from '@documenso/ee/server-only/stripe/webhook/resolve-org-plan-price';
import { DEPLOYMENT_TYPE, IS_BILLING_ENABLED, NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { normalizeClaimableDomains } from '@documenso/lib/constants/public-email-domains';
import { PUBLIC_EMAIL_DOMAINS } from '@documenso/lib/constants/public-email-domains';
import { getI18nInstance } from '@documenso/lib/client-only/providers/i18n-server';
import {
  ORG_SEAT_TIERS,
  ORG_UNLIMITED_SENTINEL,
} from '@documenso/lib/constants/org-tiers';
import type { OrgBillingInterval } from '@documenso/lib/constants/org-tiers';
import { env } from '@documenso/lib/utils/env';
import { renderEmailWithI18N } from '@documenso/lib/utils/render-email-with-i18n';
import crypto from 'crypto';

import { mailer } from '@documenso/email/mailer';
import { OrgMemberInviteEmailTemplate } from '@documenso/email/templates/org-member-invite';
import { OrgMemberWelcomeEmailTemplate } from '@documenso/email/templates/org-member-welcome';
import { ONE_DAY } from '@documenso/lib/constants/time';
import { jobs } from '@documenso/lib/jobs/client';
import {
  LicenseRedeemError,
  redeemLicenseKey,
} from '@documenso/lib/server-only/license/redeem-license-key';
import { stripe } from '@documenso/lib/server-only/stripe';
import { getSigningBottlenecks } from '@documenso/lib/server-only/document/bottlenecks';
import { getOrganizationDueDates } from '@documenso/lib/server-only/inbox/invoice-due';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure, router } from '../trpc';

/**
 * Resolves the human plan name/price for a Stripe price, expanding the product
 * since `metadata`/`name` live there. Mirrors the same small helper duplicated
 * in `handler.ts` and `run-due-renewal-reminders.ts` this session.
 *
 * A user can end up with more than one locally-`ACTIVE` `Subscription` row
 * (e.g. leftover test data, or a live/test Stripe key mismatch leaving a row
 * that no longer resolves in the current mode) — try each, newest first, and
 * skip any that fail to resolve in Stripe instead of blindly using the first.
 *
 * The local `ACTIVE` flag can also just be stale (e.g. a webhook delivery
 * failure meant a cancellation never synced back), so each candidate's actual
 * Stripe status is re-verified here rather than trusted — anything Stripe no
 * longer considers active gets corrected locally via `onSubscriptionDeleted`
 * (the same correction the webhook would have made) and skipped.
 */
const resolveActivePersonalPlan = async (userId: number) => {
  const subscriptions = await prisma.subscription.findMany({
    where: { userId, status: SubscriptionStatus.ACTIVE },
    orderBy: { updatedAt: 'desc' },
  });

  for (const subscription of subscriptions) {
    const stripeSubscription = await stripe.subscriptions
      .retrieve(subscription.planId)
      .catch(() => null);

    if (!stripeSubscription || !['active', 'trialing', 'past_due'].includes(stripeSubscription.status)) {
      if (stripeSubscription) {
        await onSubscriptionDeleted({ subscription: stripeSubscription }).catch(() => {});
      }

      continue;
    }

    const price = await stripe.prices
      .retrieve(subscription.priceId, { expand: ['product'] })
      .catch(() => null);

    if (!price) {
      continue;
    }

    const { product } = price;

    const planName = typeof product === 'string' || product.deleted ? 'Plan' : product.name;
    const unitAmount = price.unit_amount ?? 0;
    const priceFormatted = `$${(unitAmount / 100).toFixed(2)}/month`;

    return { subscription, planName, priceFormatted };
  }

  return null;
};

/**
 * Puts a member onto a purchased seat: capacity check, personal-plan takeover,
 * counter increment, tier + DMS entitlement.
 *
 * Extracted so `assignSeat` and `convertDomainCandidate` cannot drift. The
 * personal-plan cancellation especially must not be duplicated — a second copy
 * that forgot it would leave a converted user double-billed (their own
 * subscription plus the org's seat).
 */
const assignSeatToMember = async ({
  organizationId,
  memberId,
  tier,
  acknowledgeCancelPersonalPlan,
}: {
  organizationId: number;
  memberId: string;
  tier: 'BUSINESS' | 'ENTERPRISE';
  acknowledgeCancelPersonalPlan?: boolean;
}) => {
  const seatPlan = await prisma.orgSeatPlan.findFirst({
    where: { organizationId, tier },
  });

  if (!seatPlan) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'No seats purchased for this tier. Purchase seats first.',
    });
  }

  const targetMember = await prisma.organizationMember.findUniqueOrThrow({
    where: { id: memberId },
  });

  // A member holds exactly one tier at a time (same as M365 licensing: a user
  // has one SKU even if the tenant offers several), so this is a no-op rather
  // than stacking a second tier. Switching tiers means unassign-then-assign.
  if (targetMember.seatTier) {
    return targetMember;
  }

  // Re-checked server-side regardless of whether the client already called
  // `getMemberBillingConflict` — this is the actual enforcement point.
  const activePlan = await resolveActivePersonalPlan(targetMember.userId);

  if (activePlan && !acknowledgeCancelPersonalPlan) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'This member has an active personal subscription that will be cancelled.',
    });
  }

  if (activePlan) {
    try {
      // Cancel immediately with proration — unused time lands as a Stripe
      // account-balance credit (applied to future invoices), not a card refund.
      // Same pattern as `transfer-team-subscription.ts`.
      const canceledSubscription = await stripe.subscriptions.cancel(
        activePlan.subscription.planId,
        { invoice_now: true, prorate: true },
      );

      // Sync locally immediately rather than waiting on the webhook (mirrors
      // `update-subscription-plan.ts`); the webhook fires later and no-ops.
      await onSubscriptionDeleted({ subscription: canceledSubscription });
    } catch (err) {
      // `resolveActivePersonalPlan` re-verifies against Stripe, but Stripe can
      // still reject the cancel (e.g. cancelled in between). Either way the
      // goal — not double-billing — already holds, so don't block the seat.
      console.warn('Failed to cancel personal subscription during seat assignment:', err);
    }
  }

  if (seatPlan.assigned >= seatPlan.quantity) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'All seats are assigned. Purchase more seats.',
    });
  }

  await prisma.orgSeatPlan.update({
    where: { id: seatPlan.id },
    data: { assigned: { increment: 1 } },
  });

  return prisma.organizationMember.update({
    where: { id: memberId },
    data: {
      seatTier: seatPlan.tier,
      // Derived from the org's purchased plan, never client input.
      dmsAddon: seatPlan.tier === 'ENTERPRISE' ? true : seatPlan.dmsEnabled,
    },
  });
};


// ── Org Billing Helpers ──

const ORG_SEAT_PRICE_ID = 'price_org_seat'; // Set via env or Stripe lookup
const ORG_DMS_PRICE_ID = 'price_org_dms';

async function getOrCreateStripeCustomer(org: { id: number; name: string; stripeCustomerId: string | null }, adminEmail: string) {
  if (org.stripeCustomerId) return org.stripeCustomerId;

  const customer = await stripe.customers.create({
    name: org.name,
    email: adminEmail,
    metadata: { organizationId: org.id.toString() },
  });

  await prisma.organization.update({
    where: { id: org.id },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
}

async function createOrUpdateOrgSubscription(orgId: number) {
  if (!IS_BILLING_ENABLED()) return;

  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: orgId },
    include: {
      members: { include: { user: { select: { email: true } } } },
    },
  });

  const seatCount = org.members.length;
  const adminMember = org.members.find((m) => m.role === 'ORG_ADMIN');
  const adminEmail = adminMember?.user.email || org.members[0]?.user.email || '';

  // Get or create Stripe customer
  const customerId = await getOrCreateStripeCustomer(org, adminEmail);

  if (org.stripeSubscriptionId) {
    // Update existing subscription seat count
    try {
      const subscription = await stripe.subscriptions.retrieve(org.stripeSubscriptionId);

      // Find the seat line item
      const seatItem = subscription.items.data.find(
        (item) => item.price.metadata?.type === 'org_seat' || item.price.id === org.stripeSeatPriceId,
      );

      if (seatItem) {
        await stripe.subscriptionItems.update(seatItem.id, {
          quantity: seatCount,
        });
      }

      await prisma.organization.update({
        where: { id: orgId },
        data: { seatCount, billingStatus: 'active' },
      });
    } catch (err) {
      console.error('[Org Billing] Failed to update subscription:', err);
    }
  } else {
    // No subscription yet — just update seat count, subscription will be created via checkout
    await prisma.organization.update({
      where: { id: orgId },
      data: { seatCount },
    });
  }
}

/**
 * Issues a fresh single-use set-password token (24h expiry) for a user who
 * was auto-created by `inviteMember` and is still locked out, and emails them
 * the welcome/set-password link. Shared by `inviteMember` (first send) and
 * `resendMemberInvite` (recovery when the original link expired or was lost).
 */
async function sendOrgSetPasswordEmail(params: {
  user: { id: number; email: string; name: string | null };
  orgName: string;
  inviterName: string;
  roleLabel: string;
  welcomeMessage?: string;
  isNewUser: boolean;
}) {
  const { user, orgName, inviterName, roleLabel, welcomeMessage, isNewUser } = params;

  const token = crypto.randomBytes(18).toString('hex');
  await prisma.passwordResetToken.create({
    data: {
      token,
      expiry: new Date(Date.now() + ONE_DAY),
      userId: user.id,
    },
  });

  const assetBaseUrl = NEXT_PUBLIC_WEBAPP_URL() || 'http://localhost:3000';
  const setPasswordLink = `${assetBaseUrl}/reset-password/${token}`;

  const emailTemplate = createElement(OrgMemberWelcomeEmailTemplate, {
    assetBaseUrl,
    baseUrl: assetBaseUrl,
    inviterName,
    orgName,
    role: roleLabel,
    welcomeMessage: welcomeMessage || '',
    setPasswordLink,
  });

  const [html, text] = await Promise.all([
    renderEmailWithI18N(emailTemplate),
    renderEmailWithI18N(emailTemplate, { plainText: true }),
  ]);

  const i18n = await getI18nInstance();

  await mailer.sendMail({
    to: {
      address: user.email,
      name: user.name || '',
    },
    from: {
      name: env('NEXT_PRIVATE_SMTP_FROM_NAME') || 'HubSign',
      address: env('NEXT_PRIVATE_SMTP_FROM_ADDRESS') || 'noreply@hubsign.io',
    },
    subject: i18n._(
      isNewUser ? msg`Welcome to ${orgName} on HubSign` : msg`Your HubSign invite link was resent`,
    ),
    html,
    text,
  }).catch((err) => {
    console.error('[Org Invite] Failed to send set-password email:', err);
  });
}

export const orgRouter = router({
  // ═══════════════════════════════════════════
  // ORGANIZATION CRUD
  // ═══════════════════════════════════════════

  create: authenticatedProcedure
    .input(z.object({
      name: z.string().min(1),
      slug: z.string().min(2).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with dashes'),
      domain: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const org = await prisma.organization.create({
        data: {
          name: input.name,
          slug: input.slug,
          domain: input.domain || undefined,
          members: {
            create: {
              userId: ctx.user.id,
              role: 'ORG_ADMIN',
            },
          },
        },
      });

      return org;
    }),

  /**
   * Redeem a WorkHub-minted license key for this organization (a Stripe-free
   * activation). Only an ORG_ADMIN may redeem, and only for a free/inactive org
   * (never overriding an active paid plan) — enforced in `redeemLicenseKey`.
   */
  redeemLicenseKey: authenticatedProcedure
    .input(
      z.object({
        key: z.string().min(1).max(2000),
        organizationId: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const { grant } = await redeemLicenseKey({
          key: input.key.trim(),
          userId: ctx.user.id,
          organizationId: input.organizationId,
        });
        return {
          tier: grant.tier,
          addons: grant.addons,
          seats: grant.seats,
          expiresAt: grant.expiresAt,
        };
      } catch (err) {
        if (err instanceof LicenseRedeemError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        }
        throw err;
      }
    }),

  /**
   * Search members of the current user's organization by name or email.
   * Used by the recipient autocomplete in the signer-add flow.
   * Returns empty array if the user isn't in any organization.
   */
  searchMembers: authenticatedProcedure
    .input(z.object({ query: z.string().max(200).optional() }))
    .query(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id },
        // A user can belong to several orgs, and an unordered findFirst leaves
        // the choice to Postgres heap order — a plain row UPDATE elsewhere can
        // flip which directory this searches. Match `resolveOrganizationId`.
        orderBy: { joinedAt: 'asc' },
      });

      if (!myMembership) return [];

      const q = (input.query ?? '').trim();

      const members = await prisma.organizationMember.findMany({
        where: {
          organizationId: myMembership.organizationId,
          ...(q.length > 0
            ? {
                user: {
                  OR: [
                    { email: { contains: q, mode: 'insensitive' } },
                    { name: { contains: q, mode: 'insensitive' } },
                  ],
                  disabled: false,
                },
              }
            : { user: { disabled: false } }),
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
        orderBy: { joinedAt: 'asc' },
        take: 20,
      });

      return members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
      }));
    }),

  getMyOrganization: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: ctx.user.id },
      // Must agree with every other org resolution (`getDashboardStats`,
      // `searchMembers`, `resolveOrganizationId`) — otherwise the header can
      // name one organization while the numbers below describe another.
      orderBy: { joinedAt: 'asc' },
      include: {
        organization: {
          include: {
            members: {
              include: {
                user: { select: { id: true, name: true, email: true, mustChangePassword: true } },
              },
            },
            _count: { select: { teams: true, dmsDocuments: true, dmsLocations: true } },
          },
        },
      },
    });

    if (!membership) {
      return membership;
    }

    // Members still on `mustChangePassword` were auto-created by `inviteMember`
    // and are locked out until they use their emailed set-password link — pull
    // each one's latest token expiry so the UI can show a countdown/"Expired"
    // state instead of silently stranding them.
    const pendingUserIds = membership.organization.members
      .filter((m) => m.user.mustChangePassword)
      .map((m) => m.user.id);

    const latestTokenByUser = new Map<number, Date>();
    if (pendingUserIds.length > 0) {
      const tokens = await prisma.passwordResetToken.findMany({
        where: { userId: { in: pendingUserIds } },
        orderBy: { expiry: 'desc' },
      });
      for (const token of tokens) {
        if (!latestTokenByUser.has(token.userId)) {
          latestTokenByUser.set(token.userId, token.expiry);
        }
      }
    }

    return {
      ...membership,
      organization: {
        ...membership.organization,
        members: membership.organization.members.map((m) => ({
          ...m,
          inviteExpiresAt: m.user.mustChangePassword
            ? latestTokenByUser.get(m.user.id) ?? null
            : null,
        })),
      },
    };
  }),

  update: authenticatedProcedure
    .input(z.object({
      name: z.string().optional(),
      domain: z.string().nullable().optional(),
      logoUrl: z.string().nullable().optional(),
      brandingLogo: z.string().nullable().optional(),
      brandingPrimaryColor: z.string().nullable().optional(),
      brandingAccentColor: z.string().nullable().optional(),
      brandingSidebarBg: z.string().nullable().optional(),
      brandingSidebarTextColor: z.string().nullable().optional(),
      brandingNavActiveColor: z.string().nullable().optional(),
      brandingButtonColor: z.string().nullable().optional(),
      brandingButtonHoverColor: z.string().nullable().optional(),
      brandingButtonTextColor: z.string().nullable().optional(),
      ocrApiUrl: z.string().nullable().optional(),
      ocrApiKey: z.string().nullable().optional(),
      ocrApiUsername: z.string().nullable().optional(),
      ocrApiPassword: z.string().nullable().optional(),
      ocrDefaultTemplateId: z.number().nullable().optional(),
      ocrAutoProcess: z.boolean().optional(),
      ocrDefaultEngine: z.string().nullable().optional(),
      defaultConfidentiality: z.enum(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED']).optional(),
      // Applied at seal time, so it only affects documents completed afterwards.
      includeSigningCertificate: z.boolean().optional(),
      allowedEmailDomains: z.array(z.string().min(1).max(253)).optional(),
      signReminderEnabled: z.boolean().optional(),
      signReminderDays: z.number().int().min(1).max(60).optional(),
      signReminderMaxCount: z.number().int().min(1).max(10).optional(),
      // SLA — targets are in BUSINESS hours, measured on the calendar below.
      slaEnabled: z.boolean().optional(),
      slaTimezone: z
        .string()
        .max(64)
        .refine((tz) => DateTime.local().setZone(tz).isValid, 'Not a recognised time zone')
        .nullable()
        .optional(),
      /**
       * ISO weekdays, 1 = Monday. At least one: a week with no working days has
       * no clock to measure against, and saving an empty one used to leave the
       * SLA page reporting that tracking was switched off.
       */
      slaWorkingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
      // `\d{1,2}` alone accepts "99:99"; bound the actual hour and minute.
      slaWorkdayStart: z
        .string()
        .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use HH:mm')
        .nullable()
        .optional(),
      slaWorkdayEnd: z
        .string()
        .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Use HH:mm')
        .nullable()
        .optional(),
      slaHolidays: z
        .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use yyyy-MM-dd'))
        .max(200)
        .optional(),
      slaDefaultInternalHours: z.number().int().min(1).max(2000).nullable().optional(),
      slaDefaultEndToEndHours: z.number().int().min(1).max(2000).nullable().optional(),
      // SSO / OIDC
      oidcEnabled: z.boolean().optional(),
      oidcClientId: z.string().nullable().optional(),
      oidcClientSecret: z.string().nullable().optional(),
      oidcWellKnownUrl: z
        .string()
        .url()
        .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
          message: 'Must be an http(s) URL.',
        })
        .nullable()
        .optional(),
      oidcProviderLabel: z.string().max(80).nullable().optional(),
      disableSelfSignup: z.boolean().optional(),
      // Email-to-sign + WorkHub inbox (per-org receive config)
      emailToSignEnabled: z.boolean().optional(),
      inboxEmail: z.string().nullable().optional(),
      workhubApiKey: z.string().nullable().optional(),
      workhubUsername: z.string().nullable().optional(),
      workhubPassword: z.string().nullable().optional(),
      workhubMailboxId: z.string().nullable().optional(),
      workhubApiBase: z.string().nullable().optional(),
      // Inbound filter rules. Entries are trimmed and blanks dropped server-side
      // too — a blank pattern matches every value and would disable the inbox.
      inboxBlockedSenders: z.array(z.string().max(320)).max(200).optional(),
      inboxBlockedSubjects: z.array(z.string().max(500)).max(200).optional(),
    })
    // A working day that ends before it starts has zero length. The SLA engine
    // falls back to 09:00–17:00 rather than dividing by it, so the calendar the
    // organization believes it saved is not the one being measured against.
    // Compared as minutes, not as strings — "9:00" sorts after "17:00".
    .refine(
      (input) => {
        const minutes = (hhmm: string) => {
          const [h, m] = hhmm.split(':');
          return Number(h) * 60 + Number(m);
        };
        return (
          !input.slaWorkdayStart ||
          !input.slaWorkdayEnd ||
          minutes(input.slaWorkdayEnd) > minutes(input.slaWorkdayStart)
        );
      },
      { message: 'The working day must end after it starts.', path: ['slaWorkdayEnd'] },
    ))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN'] } },
      });

      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Org Admins can update the organization' });
      }

      // Normalise the filter lists here rather than trusting the client: a blank
      // pattern is a substring of everything, so one stray empty entry would
      // block all inbound mail.
      const sanitize = (list?: string[]) =>
        list?.map((entry) => entry.trim()).filter((entry) => entry.length > 0);

      return prisma.organization.update({
        where: { id: membership.organizationId },
        data: {
          ...input,
          ...(input.inboxBlockedSenders && {
            inboxBlockedSenders: sanitize(input.inboxBlockedSenders),
          }),
          ...(input.inboxBlockedSubjects && {
            inboxBlockedSubjects: sanitize(input.inboxBlockedSubjects),
          }),
          // Deduped and ordered so the stored calendar stays readable and a
          // repeated holiday can't be counted twice by anything downstream.
          ...(input.slaWorkingDays && {
            slaWorkingDays: [...new Set(input.slaWorkingDays)].sort((a, b) => a - b),
          }),
          ...(input.slaHolidays && {
            slaHolidays: [...new Set(sanitize(input.slaHolidays) ?? [])].sort(),
          }),
        },
      });
    }),

  // ═══════════════════════════════════════════
  // MEMBER MANAGEMENT
  // ═══════════════════════════════════════════

  inviteMember: authenticatedProcedure
    .input(z.object({
      email: z.string().email(),
      role: z.enum(['ORG_ADMIN', 'DMS_ADMIN', 'TEAM_ADMIN', 'MANAGER', 'MEMBER']),
      // Optional — only used when the email doesn't match an existing user
      // and we're auto-creating the account.
      name: z.string().min(1).max(200).optional(),
      welcomeMessage: z.string().max(2000).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] } },
      });

      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions to invite members' });
      }

      // Load org early so we can validate the email domain BEFORE creating any user.
      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: membership.organizationId },
      });

      const allowedDomains = org.allowedEmailDomains ?? [];
      if (allowedDomains.length > 0) {
        const emailDomain = input.email.split('@')[1]?.toLowerCase();
        const ok = allowedDomains.some((d) => d.toLowerCase() === emailDomain);
        if (!ok) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `This organization only accepts members with email domains: ${allowedDomains.join(', ')}`,
          });
        }
      }

      // Find user by email
      let user = await prisma.user.findUnique({ where: { email: input.email } });
      const isNewUser = !user;

      // Auto-create the user if they don't exist. The admin never sets a
      // password — we flag the user with `mustChangePassword=true` and send
      // them a single-use set-password link via the password reset flow
      // (issued below, after the membership is confirmed).
      if (!user) {
        user = await prisma.user.create({
          data: {
            email: input.email,
            name: input.name || input.email.split('@')[0],
            // Mark for forced password change on first login.
            mustChangePassword: true,
            // Pre-verify the email since the admin has vouched for it.
            emailVerified: new Date(),
          },
        });
      }

      // Check if already a member
      const existing = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: membership.organizationId, userId: user.id } },
      });

      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'User is already a member of this organization' });
      }

      const newMember = await prisma.organizationMember.create({
        data: {
          organizationId: membership.organizationId,
          userId: user.id,
          role: input.role,
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });

      const inviter = await prisma.user.findUniqueOrThrow({
        where: { id: ctx.user.id },
        select: { name: true, email: true },
      });

      const roleLabel = input.role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      const inviterName = inviter.name || inviter.email;

      if (isNewUser) {
        // Locked out until they use the emailed link — same helper backs
        // `resendMemberInvite` for when this one expires or gets lost.
        await sendOrgSetPasswordEmail({
          user,
          orgName: org.name,
          inviterName,
          roleLabel,
          welcomeMessage: input.welcomeMessage,
          isNewUser: true,
        });
      } else {
        // Existing account — just a courtesy notification, no link/token.
        const assetBaseUrl = NEXT_PUBLIC_WEBAPP_URL() || 'http://localhost:3000';
        const emailTemplate = createElement(OrgMemberInviteEmailTemplate, {
          assetBaseUrl,
          baseUrl: assetBaseUrl,
          inviterName,
          orgName: org.name,
          role: roleLabel,
        });

        const [html, text] = await Promise.all([
          renderEmailWithI18N(emailTemplate),
          renderEmailWithI18N(emailTemplate, { plainText: true }),
        ]);

        const i18n = await getI18nInstance();

        await mailer.sendMail({
          to: {
            address: user.email,
            name: user.name || '',
          },
          from: {
            name: env('NEXT_PRIVATE_SMTP_FROM_NAME') || 'HubSign',
            address: env('NEXT_PRIVATE_SMTP_FROM_ADDRESS') || 'noreply@hubsign.io',
          },
          subject: i18n._(msg`You've been added to ${org.name} on HubSign`),
          html,
          text,
        }).catch((err) => {
          console.error('[Org Invite] Failed to send invite email:', err);
        });
      }

      return newMember;
    }),

  /**
   * Re-issues the set-password link for a member still locked out
   * (`mustChangePassword: true`) — recovers members whose original invite
   * link expired or was lost, since re-running `inviteMember` for them
   * would just throw `CONFLICT` (they're already a member).
   */
  resendMemberInvite: authenticatedProcedure
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] } },
      });

      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Insufficient permissions to resend invites' });
      }

      const target = await prisma.organizationMember.findUnique({
        where: { id: input.memberId },
        include: { user: true, organization: true },
      });

      if (!target || target.organizationId !== membership.organizationId) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Member not found' });
      }

      if (!target.user.mustChangePassword) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'This member has already set up their account.',
        });
      }

      const inviter = await prisma.user.findUniqueOrThrow({
        where: { id: ctx.user.id },
        select: { name: true, email: true },
      });

      const roleLabel = target.role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      // Invalidate any outstanding link before issuing the new one, so only
      // the freshest link works.
      await prisma.passwordResetToken.deleteMany({ where: { userId: target.user.id } });
      await sendOrgSetPasswordEmail({
        user: target.user,
        orgName: target.organization.name,
        inviterName: inviter.name || inviter.email,
        roleLabel,
        isNewUser: false,
      });

      return { email: target.user.email, expiresAt: new Date(Date.now() + ONE_DAY) };
    }),

  updateMemberRole: authenticatedProcedure
    .input(z.object({
      memberId: z.string(),
      role: z.enum(['ORG_ADMIN', 'DMS_ADMIN', 'TEAM_ADMIN', 'MANAGER', 'MEMBER']),
    }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: 'ORG_ADMIN' },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Org Admins can change roles' });
      }

      return prisma.organizationMember.update({
        where: { id: input.memberId },
        data: { role: input.role },
      });
    }),

  removeMember: authenticatedProcedure
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: 'ORG_ADMIN' },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Org Admins can remove members' });
      }

      // Prevent removing yourself if you're the last admin
      const target = await prisma.organizationMember.findUnique({ where: { id: input.memberId } });
      if (target?.userId === ctx.user.id) {
        const adminCount = await prisma.organizationMember.count({
          where: { organizationId: myMembership.organizationId, role: 'ORG_ADMIN' },
        });
        if (adminCount <= 1) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Cannot remove the last Org Admin' });
        }
      }

      // If the removed member held a seat, free it in their org's seat plan.
      if (target?.seatTier) {
        await prisma.orgSeatPlan.updateMany({
          where: { organizationId: myMembership.organizationId, tier: target.seatTier },
          data: { assigned: { decrement: 1 } },
        });
      }

      return await prisma.organizationMember.delete({ where: { id: input.memberId } });
    }),

  // ═══════════════════════════════════════════
  // ORG BILLING
  // ═══════════════════════════════════════════

  setupBilling: authenticatedProcedure.mutation(async ({ ctx }) => {
    if (!IS_BILLING_ENABLED()) {
      return { url: null, message: 'Billing is not enabled' };
    }

    const membership = await prisma.organizationMember.findFirst({
      where: { userId: ctx.user.id, role: 'ORG_ADMIN' },
      include: { organization: { include: { members: true } } },
    });

    if (!membership) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Org Admins can manage billing' });
    }

    const org = membership.organization;
    const customerId = await getOrCreateStripeCustomer(org, ctx.user.email);
    const seatCount = org.members.length;

    if (org.stripeSubscriptionId) {
      // Already has subscription — go to portal
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${process.env.NEXT_PUBLIC_WEBAPP_URL || 'http://localhost:3000'}/org/billing`,
      });

      return { url: portalSession.url };
    }

    // Create new checkout session with seat + DMS
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'HubSign Organization Seat',
              metadata: { type: 'org_seat' },
            },
            unit_amount: 2500, // $25
            recurring: { interval: 'month' },
          },
          quantity: seatCount,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Document Manager (DMS) Add-On',
              metadata: { type: 'org_dms' },
            },
            unit_amount: 1500, // $15
            recurring: { interval: 'month' },
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: {
          organizationId: org.id.toString(),
          type: 'organization',
        },
      },
      success_url: `${process.env.NEXT_PUBLIC_WEBAPP_URL || 'http://localhost:3000'}/org/billing?success=true`,
      cancel_url: `${process.env.NEXT_PUBLIC_WEBAPP_URL || 'http://localhost:3000'}/org/billing?canceled=true`,
    });

    return { url: session.url };
  }),

  manageBilling: authenticatedProcedure.mutation(async ({ ctx }) => {
    if (!IS_BILLING_ENABLED()) {
      return { url: null };
    }

    const membership = await prisma.organizationMember.findFirst({
      where: { userId: ctx.user.id, role: 'ORG_ADMIN' },
      include: { organization: true },
    });

    if (!membership?.organization.stripeCustomerId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'No billing set up yet' });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: membership.organization.stripeCustomerId,
      return_url: `${process.env.NEXT_PUBLIC_WEBAPP_URL || 'http://localhost:3000'}/org/billing`,
    });

    return { url: portalSession.url };
  }),

  // ═══════════════════════════════════════════
  // SEAT MANAGEMENT
  // ═══════════════════════════════════════════

  getSeatPlans: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: ctx.user.id },
    });

    if (!membership) return [];

    return prisma.orgSeatPlan.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: { tier: 'asc' },
    });
  }),

  /**
   * Live Stripe-authoritative pricing for every org seat/DMS/doc-block
   * combination the billing page can display or purchase — one Stripe search
   * call shared across all of them (see `searchActiveOrgPrices`) rather than
   * a separate round trip per combination. `unitAmountCents: null` means
   * that Price hasn't been configured in Stripe yet.
   */
  getSeatPricing: authenticatedProcedure.query(async () => {
    const prices = await searchActiveOrgPrices();
    const deployment = DEPLOYMENT_TYPE();

    const amountFor = (options: Parameters<typeof matchOrgPrice>[1]) =>
      matchOrgPrice(prices, options)?.unit_amount ?? null;

    return {
      seat: {
        BUSINESS: {
          month: amountFor({ type: 'org_seat', tier: 'BUSINESS', interval: 'month' }),
          year: amountFor({ type: 'org_seat', tier: 'BUSINESS', interval: 'year' }),
        },
        ENTERPRISE: {
          month: amountFor({ type: 'org_seat', tier: 'ENTERPRISE', interval: 'month', deployment }),
          year: amountFor({ type: 'org_seat', tier: 'ENTERPRISE', interval: 'year', deployment }),
        },
      },
      dms: {
        BUSINESS: {
          month: amountFor({ type: 'org_dms', tier: 'BUSINESS', interval: 'month' }),
          year: amountFor({ type: 'org_dms', tier: 'BUSINESS', interval: 'year' }),
        },
        ENTERPRISE: {
          month: amountFor({ type: 'org_dms', tier: 'ENTERPRISE', interval: 'month' }),
          year: amountFor({ type: 'org_dms', tier: 'ENTERPRISE', interval: 'year' }),
        },
      },
      // Business-only.
      docBlock: {
        month: amountFor({ type: 'org_doc_block', tier: 'BUSINESS', interval: 'month' }),
        year: amountFor({ type: 'org_doc_block', tier: 'BUSINESS', interval: 'year' }),
      },
      deployment,
    };
  }),

  purchaseSeats: authenticatedProcedure
    .input(z.object({
      tier: z.enum(['BUSINESS', 'ENTERPRISE']),
      quantity: z.number().min(1).max(100),
      interval: z.enum(['month', 'year']).default('month'),
      dmsEnabled: z.boolean().optional(),
      // Business-only: how many +100/mo document volume blocks to add.
      docBlocks: z.number().int().min(0).optional(),
      acknowledgeCancelPersonalPlan: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: 'ORG_ADMIN' },
        include: { organization: { include: { members: true } } },
      });

      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const org = membership.organization;

      // An org can hold more than one tier at once now (mixed licensing,
      // like Business + Enterprise M365 seats in one tenant) — so the
      // question isn't "does the org have a plan" but two separate ones:
      // does *this* tier already exist (top-up vs. establishing it), and
      // does the org have *any* subscription yet (modify it vs. first-ever
      // Checkout). A brand-new tier added to an org that already has a
      // subscription for a different tier still modifies that existing
      // subscription (as a new item) rather than starting a second one.
      const existingSeatPlan = await prisma.orgSeatPlan.findFirst({
        where: { organizationId: membership.organizationId, tier: input.tier },
      });

      const hasExistingTierPlan = Boolean(existingSeatPlan);
      const isTopUp = Boolean(org.stripeSubscriptionId);

      const tierLimits = ORG_SEAT_TIERS[input.tier];

      const config = {
        documentsPerMonth: tierLimits.documents ?? ORG_UNLIMITED_SENTINEL,
        recipientsPerMonth: tierLimits.recipients ?? ORG_UNLIMITED_SENTINEL,
        directTemplates: tierLimits.directTemplates ?? ORG_UNLIMITED_SENTINEL,
        dmsEnabled: tierLimits.dmsEnabled,
        minSeats: tierLimits.minSeats,
      };

      const dmsEnabled = input.dmsEnabled ?? config.dmsEnabled;

      // Interval is chosen once, at the org's first-ever seat purchase, and
      // locked thereafter across *every* tier — a single Stripe subscription
      // can't mix monthly and yearly items, so a second tier added later
      // must reuse whichever interval any existing tier on this org already
      // committed to, not just this specific tier's own plan (which may not
      // exist yet if this is the org's first purchase of it).
      const anyExistingSeatPlan = isTopUp
        ? (existingSeatPlan ??
          (await prisma.orgSeatPlan.findFirst({ where: { organizationId: membership.organizationId } })))
        : null;

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const interval: OrgBillingInterval = anyExistingSeatPlan
        ? ((anyExistingSeatPlan.billingInterval as OrgBillingInterval | undefined) ?? 'month')
        : input.interval;

      // The tier minimum only applies to establishing *that tier*, whether
      // it's the org's first tier ever or a second one added alongside an
      // existing one — once a tier already meets it, buying 1-2 more is fine.
      if (!hasExistingTierPlan && input.quantity < config.minSeats) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${input.tier} plan requires a minimum of ${config.minSeats} seat${config.minSeats > 1 ? 's' : ''}.`,
        });
      }

      // The purchasing admin automatically consumes a seat if they don't
      // already have one — check whether that would strand an active
      // personal subscription (same check/cancel pattern as `assignSeat`).
      const adminNeedsSeat = !membership.seatTier;
      const adminActivePlan = adminNeedsSeat ? await resolveActivePersonalPlan(ctx.user.id) : null;

      if (adminActivePlan && !input.acknowledgeCancelPersonalPlan) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'You have an active personal subscription that will be cancelled.',
        });
      }

      if (adminActivePlan) {
        try {
          const canceledSubscription = await stripe.subscriptions.cancel(adminActivePlan.subscription.planId, {
            invoice_now: true,
            prorate: true,
          });

          await onSubscriptionDeleted({ subscription: canceledSubscription });
        } catch (err) {
          // See `assignSeat` for full rationale — Stripe may reject the
          // cancel for reasons that still mean nothing is left to cancel.
          console.warn('Failed to cancel personal subscription during seat purchase:', err);
        }
      }

      if (!IS_BILLING_ENABLED()) {
        // Billing not enabled — just track it locally, synchronously (no
        // Stripe involved either way, so there's nothing to wait on).
        const docBlockQuantity =
          (existingSeatPlan?.docBlockQuantity ?? 0) + (input.tier === 'BUSINESS' ? (input.docBlocks ?? 0) : 0);

        const seatPlan = existingSeatPlan
          ? await prisma.orgSeatPlan.update({
              where: { id: existingSeatPlan.id },
              data: { quantity: existingSeatPlan.quantity + input.quantity, dmsEnabled, docBlockQuantity },
            })
          : await prisma.orgSeatPlan.create({
              data: {
                tier: input.tier,
                quantity: input.quantity,
                organizationId: membership.organizationId,
                documentsPerMonth: config.documentsPerMonth,
                recipientsPerMonth: config.recipientsPerMonth,
                directTemplates: config.directTemplates,
                dmsEnabled,
                docBlockQuantity,
                billingInterval: interval,
              },
            });

        if (adminNeedsSeat) {
          const updatedSeatPlan = await prisma.orgSeatPlan.update({
            where: { id: seatPlan.id },
            data: { assigned: { increment: 1 } },
          });

          await prisma.organizationMember.update({
            where: { id: membership.id },
            data: { seatTier: input.tier, dmsAddon: dmsEnabled },
          });

          return updatedSeatPlan;
        }

        return seatPlan;
      }

      const baseUrl = NEXT_PUBLIC_WEBAPP_URL() || 'http://localhost:3000';

      if (isTopUp) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const subscriptionId = org.stripeSubscriptionId as string;
        const newQuantity = (existingSeatPlan?.quantity ?? 0) + input.quantity;

        const liveSubscription = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ['items.data.price.product'],
        });

        // Look up this *specific tier's* items — an org's subscription can
        // now hold items for more than one tier at once (mixed licensing),
        // so matching by cached price id first, falling back to scanning by
        // product metadata `{ type, tier }` (the same self-healing pattern
        // already used here for DMS) is what keeps this tier-correct instead
        // of accidentally grabbing another tier's item.
        const findTierItem = (
          type: 'org_seat' | 'org_dms' | 'org_doc_block',
          cachedPriceId?: string | null,
        ) =>
          liveSubscription.items.data.find((item) => cachedPriceId && item.price.id === cachedPriceId) ??
          liveSubscription.items.data.find((item) => {
            const { product } = item.price;
            return (
              typeof product !== 'string' &&
              !product.deleted &&
              product.metadata?.type === type &&
              product.metadata?.tier === input.tier
            );
          });

        const seatItem = findTierItem('org_seat', existingSeatPlan?.stripePriceId);

        const items: Array<{ id?: string; price?: string; quantity: number }> = [];

        if (seatItem) {
          items.push({ id: seatItem.id, quantity: newQuantity });
        } else {
          // This tier doesn't exist on the subscription yet — adding it
          // alongside whatever other tier(s) the org already has, rather
          // than starting a second subscription. Pricing is Stripe-authoritative
          // (see `getOrgSeatPrice`), so this is a lookup, not a get-or-create —
          // a missing Price here means Stripe isn't configured for this plan yet.
          const seatPrice = await getOrgSeatPrice({
            type: 'org_seat',
            tier: input.tier,
            interval,
            deployment: input.tier === 'ENTERPRISE' ? DEPLOYMENT_TYPE() : undefined,
          });

          if (!seatPrice) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: `No Stripe price configured for ${input.tier} seats (${interval}).`,
            });
          }

          items.push({ price: seatPrice.id, quantity: newQuantity });
        }

        const existingDmsItem = findTierItem('org_dms', null);

        // Once enabled, DMS stays enabled even if this particular top-up
        // didn't touch the checkbox (it defaults unchecked on every purchase).
        const dmsNowEnabled = dmsEnabled || Boolean(existingDmsItem);

        if (dmsNowEnabled) {
          if (existingDmsItem) {
            items.push({ id: existingDmsItem.id, quantity: newQuantity });
          } else {
            // Unlike Checkout Session line items, `subscriptions.update`
            // doesn't accept an inline `price_data.product_data` — it needs a
            // real Price to reference, hence the lookup (also reused by the
            // first-purchase branch below, so both go through one place).
            const dmsPrice = await getOrgSeatPrice({ type: 'org_dms', tier: input.tier, interval });

            if (!dmsPrice) {
              throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: `No Stripe price configured for the DMS add-on (${interval}).`,
              });
            }

            items.push({ price: dmsPrice.id, quantity: newQuantity });
          }
        }

        // Doc volume blocks: Business-only, quantity = number of +100 blocks
        // (independent of seat count, unlike seats/DMS above).
        const newDocBlockQuantity = (existingSeatPlan?.docBlockQuantity ?? 0) + (input.docBlocks ?? 0);
        const existingDocBlockItem = findTierItem('org_doc_block', null);

        if (input.tier === 'BUSINESS' && newDocBlockQuantity > 0) {
          if (existingDocBlockItem) {
            items.push({ id: existingDocBlockItem.id, quantity: newDocBlockQuantity });
          } else {
            const docBlockPrice = await getOrgSeatPrice({ type: 'org_doc_block', tier: input.tier, interval });

            if (!docBlockPrice) {
              throw new TRPCError({
                code: 'INTERNAL_SERVER_ERROR',
                message: `No Stripe price configured for the document volume block add-on (${interval}).`,
              });
            }

            items.push({ price: docBlockPrice.id, quantity: newDocBlockQuantity });
          }
        }

        // One atomic call for seat + DMS together: `always_invoice` charges
        // the prorated amount to the card on file immediately (Stripe's
        // default just queues it for the next billing cycle), matching the
        // agreed "direct charge, no extra screen" behavior. `tier` is set to
        // *this* purchase's tier every time (not spread from stale prior
        // metadata) since it now means "which tier to auto-assign the
        // purchasing member's seat to" — each item is self-describing via
        // its own product metadata, so quantity/dmsEnabled no longer need to
        // live in subscription-level metadata at all.
        const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
          items,
          proration_behavior: 'always_invoice',
          expand: ['items.data.price.product'],
          metadata: {
            ...liveSubscription.metadata,
            organizationId: org.id.toString(),
            type: 'organization',
            tier: input.tier,
            purchasingMemberId: membership.id,
          },
        });

        // Sync immediately rather than waiting on the webhook (mirrors
        // `update-subscription-plan.ts`) — `onOrgSubscriptionUpdated` is the
        // single place `OrgSeatPlan`/seat assignment ever get written, so
        // this reuses that instead of duplicating the logic here. The
        // webhook will also fire from this same update and no-op on top.
        await onOrgSubscriptionUpdated({
          organizationId: membership.organizationId,
          subscription: updatedSubscription,
        });

        // Only the purchase itself (this call) triggers a confirmation email
        // — not `assignSeat`/`unassignSeat`, which don't change what's billed,
        // and not the async webhook replay of this same update (it only syncs
        // state, see `handler.ts`'s `customer.subscription.updated` branch).
        const { planName, priceFormatted } = resolveOrgPlanNameAndPrice(updatedSubscription);

        await jobs.triggerJob({
          name: 'send.subscription.purchase-confirmation.email',
          payload: {
            email: ctx.user.email,
            name: ctx.user.name || undefined,
            planName,
            priceFormatted,
            periodEnd: getSubscriptionPeriodEndISO(updatedSubscription),
            billingUrl: `${baseUrl}/org/billing`,
          },
        });

        return { success: true };
      }

      // First purchase — create a Stripe checkout session. `OrgSeatPlan` and
      // seat assignment are intentionally NOT written here — they're only
      // ever written from confirmed Stripe state once the webhook fires
      // (`onOrgSubscriptionUpdated`), including the purchase-confirmation
      // email (`handler.ts`'s `checkout.session.completed` branch).
      const customerId = await getOrCreateStripeCustomer(org, ctx.user.email);

      // Resolved via `getOrgSeatPrice` (same as the top-up branch) — pricing
      // is Stripe-authoritative, so this is a lookup, not a get-or-create; a
      // missing Price here means Stripe isn't configured for this plan yet.
      const seatPrice = await getOrgSeatPrice({
        type: 'org_seat',
        tier: input.tier,
        interval,
        deployment: input.tier === 'ENTERPRISE' ? DEPLOYMENT_TYPE() : undefined,
      });

      if (!seatPrice) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `No Stripe price configured for ${input.tier} seats (${interval}).`,
        });
      }

      const lineItems: Array<{ price: string; quantity: number }> = [
        { price: seatPrice.id, quantity: input.quantity },
      ];

      // DMS add-on — available on every tier now (no longer bundled into
      // Enterprise), so no tier exclusion here.
      if (dmsEnabled) {
        const dmsPrice = await getOrgSeatPrice({ type: 'org_dms', tier: input.tier, interval });

        if (!dmsPrice) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `No Stripe price configured for the DMS add-on (${interval}).`,
          });
        }

        lineItems.push({ price: dmsPrice.id, quantity: input.quantity });
      }

      // Doc volume blocks — Business-only, quantity = number of +100 blocks.
      if (input.tier === 'BUSINESS' && (input.docBlocks ?? 0) > 0) {
        const docBlockPrice = await getOrgSeatPrice({ type: 'org_doc_block', tier: input.tier, interval });

        if (!docBlockPrice) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `No Stripe price configured for the document volume block add-on (${interval}).`,
          });
        }

        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        lineItems.push({ price: docBlockPrice.id, quantity: input.docBlocks as number });
      }

      const sessionParams = {
        customer: customerId,
        mode: 'subscription' as const,
        line_items: lineItems,
        subscription_data: {
          metadata: {
            organizationId: org.id.toString(),
            type: 'organization',
            // Which tier to auto-assign the purchasing member's seat to —
            // each item is self-describing via its own product metadata, so
            // quantity/dmsEnabled no longer need to live here too.
            tier: input.tier,
            purchasingMemberId: membership.id,
          },
        },
        ui_mode: 'embedded',
        return_url: `${baseUrl}/org/billing?success=true&tier=${input.tier}&qty=${input.quantity}&session_id={CHECKOUT_SESSION_ID}`,
      };

      const session = await stripe.checkout.sessions.create(
        // `ui_mode`/`return_url` aren't declared in this SDK version's
        // request types yet, though the account's live API supports
        // Embedded Checkout (same pattern as get-checkout-session.ts).
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        sessionParams as unknown as Parameters<typeof stripe.checkout.sessions.create>[0],
      );

      // `client_secret` isn't declared on this SDK version's response type either.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const clientSecret = (session as unknown as { client_secret: string | null }).client_secret;

      return { clientSecret };
    }),

  /**
   * Checks whether assigning a seat to this member would strand an active
   * personal subscription (org seat limits supersede personal ones — see
   * `getServerLimits` — so the personal plan becomes wasted spend). Called by
   * the client before `assignSeat` so it can show a confirmation dialog.
   */
  getMemberBillingConflict: authenticatedProcedure
    .input(z.object({ memberId: z.string() }))
    .query(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] } },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const targetMember = await prisma.organizationMember.findUniqueOrThrow({
        where: { id: input.memberId },
      });

      const activePlan = await resolveActivePersonalPlan(targetMember.userId);

      if (!activePlan) {
        return { hasActivePlan: false as const };
      }

      return {
        hasActivePlan: true as const,
        planName: activePlan.planName,
        priceFormatted: activePlan.priceFormatted,
      };
    }),

  assignSeat: authenticatedProcedure
    .input(z.object({
      memberId: z.string(),
      // An org can hold more than one tier at once now (mixed licensing) —
      // the caller has to say which tier's seat to assign.
      tier: z.enum(['BUSINESS', 'ENTERPRISE']),
      acknowledgeCancelPersonalPlan: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] } },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      // Admins can't seat themselves — but only when somebody else actually
      // could. Otherwise a sole admin would deadlock with nobody to ask.
      // (Auto-consuming seat #1 on purchase is a separate mechanism in
      // `purchaseSeats` and is unaffected either way.)
      //
      // Lives here rather than in `assignSeatToMember` deliberately: it guards
      // self-service, and has no meaning when an admin seats a brand-new member
      // during conversion.
      if (input.memberId === myMembership.id) {
        const otherEligibleAdmin = await prisma.organizationMember.findFirst({
          where: {
            organizationId: myMembership.organizationId,
            role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] },
            id: { not: myMembership.id },
          },
        });

        if (otherEligibleAdmin) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: "You can't change your own seat assignment — ask another admin to do it.",
          });
        }
      }

      return assignSeatToMember({
        organizationId: myMembership.organizationId,
        memberId: input.memberId,
        tier: input.tier,
        acknowledgeCancelPersonalPlan: input.acknowledgeCancelPersonalPlan,
      });
    }),

  unassignSeat: authenticatedProcedure
    .input(z.object({ memberId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: 'ORG_ADMIN' },
      });

      if (!myMembership) throw new TRPCError({ code: 'FORBIDDEN' });

      const member = await prisma.organizationMember.findUniqueOrThrow({
        where: { id: input.memberId },
      });

      // Admins can't change their own seat — but only when another
      // ORG_ADMIN (the role required to call this) actually exists to do it.
      // See `assignSeat` for full rationale.
      if (member.id === myMembership.id) {
        const otherEligibleAdmin = await prisma.organizationMember.findFirst({
          where: {
            organizationId: myMembership.organizationId,
            role: 'ORG_ADMIN',
            id: { not: myMembership.id },
          },
        });

        if (otherEligibleAdmin) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: "You can't change your own seat assignment — ask another admin to do it.",
          });
        }
      }

      if (member.seatTier) {
        await prisma.orgSeatPlan.updateMany({
          where: { organizationId: myMembership.organizationId, tier: member.seatTier },
          data: { assigned: { decrement: 1 } },
        });
      }

      return prisma.organizationMember.update({
        where: { id: input.memberId },
        data: { seatTier: null, dmsAddon: false },
      });
    }),

  // ═══════════════════════════════════════════
  // DMS PERMISSIONS (for DMS_ADMIN to manage)
  // ═══════════════════════════════════════════

  getMemberPermissions: authenticatedProcedure
    .input(z.object({ memberId: z.string() }))
    .query(async ({ input }) => {
      return prisma.dmsOrgPermission.findMany({
        where: { memberId: input.memberId },
        orderBy: { action: 'asc' },
      });
    }),

  grantPermission: authenticatedProcedure
    .input(z.object({
      memberId: z.string(),
      action: z.enum([
        'DMS_VIEW', 'DMS_UPLOAD', 'DMS_DOWNLOAD', 'DMS_EDIT', 'DMS_DELETE',
        'DMS_MANAGE_FILING', 'DMS_MANAGE_TYPES', 'DMS_APPROVE_WORKFLOWS',
        'DMS_APPROVE_RETRIEVALS', 'DMS_MANAGE_RETENTION', 'DMS_EXPORT', 'DMS_VIEW_AUDIT_TRAIL',
      ]),
      locationId: z.string().optional(),
      classificationId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] } },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Org/DMS Admins can manage permissions' });
      }

      return prisma.dmsOrgPermission.create({
        data: {
          memberId: input.memberId,
          action: input.action,
          locationId: input.locationId,
          classificationId: input.classificationId,
          grantedById: ctx.user.id,
        },
      });
    }),

  revokePermission: authenticatedProcedure
    .input(z.object({ permissionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] } },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return prisma.dmsOrgPermission.delete({ where: { id: input.permissionId } });
    }),

  // ═══════════════════════════════════════════
  // SAVED SEARCHES
  // ═══════════════════════════════════════════

  getSavedSearches: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: ctx.user.id },
    });

    return prisma.dmsSavedSearch.findMany({
      where: {
        OR: [
          { userId: ctx.user.id },
          ...(membership ? [{ organizationId: membership.organizationId, isShared: true }] : []),
        ],
      },
      orderBy: { updatedAt: 'desc' },
    });
  }),

  saveSearch: authenticatedProcedure
    .input(z.object({
      name: z.string().min(1),
      criteria: z.any(),
      isShared: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id },
      });

      return prisma.dmsSavedSearch.create({
        data: {
          name: input.name,
          criteria: input.criteria,
          isShared: input.isShared ?? false,
          userId: ctx.user.id,
          organizationId: membership?.organizationId,
        },
      });
    }),

  deleteSavedSearch: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      return prisma.dmsSavedSearch.delete({
        where: { id: input.id, userId: ctx.user.id },
      });
    }),

  // ═══════════════════════════════════════════
  // RECYCLE BIN
  // ═══════════════════════════════════════════

  getRecycleBin: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: ctx.user.id },
    });

    return prisma.dmsRecycleBinItem.findMany({
      where: membership
        ? { organizationId: membership.organizationId }
        : { deletedById: ctx.user.id },
      include: {
        document: { select: { id: true, title: true, referenceNumber: true, fileName: true, fileType: true } },
        deletedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  moveToRecycleBin: authenticatedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id },
      });

      // Create recycle bin item (expires in 30 days)
      await prisma.dmsRecycleBinItem.create({
        data: {
          documentId: input.documentId,
          deletedById: ctx.user.id,
          organizationId: membership?.organizationId,
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      // Update document status
      await prisma.dmsDocument.update({
        where: { id: input.documentId },
        data: { status: 'DESTROYED' },
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'MOVED_TO_RECYCLE_BIN',
          documentId: input.documentId,
          userId: ctx.user.id,
          details: 'Document moved to recycle bin (30-day retention)',
        },
      });

      return { success: true };
    }),

  restoreFromRecycleBin: authenticatedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.dmsRecycleBinItem.delete({
        where: { documentId: input.documentId },
      });

      await prisma.dmsDocument.update({
        where: { id: input.documentId },
        data: { status: 'ACTIVE' },
      });

      await prisma.dmsAuditLog.create({
        data: {
          action: 'RESTORED_FROM_RECYCLE_BIN',
          documentId: input.documentId,
          userId: ctx.user.id,
          details: 'Document restored from recycle bin',
        },
      });

      return { success: true };
    }),

  permanentlyDelete: authenticatedProcedure
    .input(z.object({ documentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] } },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only admins can permanently delete documents' });
      }

      await prisma.dmsRecycleBinItem.delete({
        where: { documentId: input.documentId },
      }).catch(() => {});

      await prisma.dmsDocument.delete({
        where: { id: input.documentId },
      });

      return { success: true };
    }),

  /**
   * Existing HubSign accounts whose email domain matches this org's allow-list
   * but who are not members yet — surfaced so an admin can adopt them instead of
   * re-inviting someone who already has an account.
   *
   * PRIVACY CONSTRAINTS, and why they are not optional
   *
   * `allowedEmailDomains` is free text and is NOT verified. Without limits an
   * admin could type `gmail.com` and read back a directory of every Gmail user
   * on the platform. Two rules contain that:
   *
   *   1. Public mailbox providers never match — they identify no organization.
   *   2. Only accounts belonging to NO organization are listed, so one tenant can
   *      never enumerate or poach another tenant's members.
   *
   * Even so this is "unaffiliated accounts on a domain you claim", not "your
   * staff". Real domain verification (DNS TXT) is the proper fix and does not
   * exist yet.
   */
  listDomainCandidates: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: ctx.user.id, role: 'ORG_ADMIN' },
      orderBy: { joinedAt: 'asc' },
    });

    if (!membership) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only Org Admins can view domain candidates.',
      });
    }

    const org = await prisma.organization.findUniqueOrThrow({
      where: { id: membership.organizationId },
      select: { allowedEmailDomains: true },
    });

    const domains = normalizeClaimableDomains(org.allowedEmailDomains);

    if (domains.length === 0) {
      return { candidates: [], domains: [], ignoredPublicDomains: [] };
    }

    const candidates = await prisma.user.findMany({
      where: {
        disabled: false,
        // Unaffiliated only — see the privacy note above.
        organizationMemberships: { none: {} },
        OR: domains.map((domain) => ({ email: { endsWith: `@${domain}`, mode: 'insensitive' } })),
      },
      select: { id: true, name: true, email: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Seat availability, so the admin sees what licensing is possible before
    // clicking rather than discovering "all seats assigned" afterwards.
    const seatPlans = await prisma.orgSeatPlan.findMany({
      where: { organizationId: membership.organizationId },
      select: { tier: true, quantity: true, assigned: true, dmsEnabled: true },
    });

    // Flagged per candidate: seating them cancels their own subscription, which
    // is a billing consequence the admin must see in advance.
    const withPersonalPlan = new Set<number>();

    if (IS_BILLING_ENABLED()) {
      for (const candidate of candidates) {
        const plan = await resolveActivePersonalPlan(candidate.id);
        if (plan) withPersonalPlan.add(candidate.id);
      }
    }

    return {
      candidates: candidates.map((c) => ({
        ...c,
        hasPersonalPlan: withPersonalPlan.has(c.id),
      })),
      seatPlans: seatPlans.map((p) => ({
        tier: p.tier,
        quantity: p.quantity,
        assigned: p.assigned,
        available: Math.max(p.quantity - p.assigned, 0),
        dmsEnabled: p.dmsEnabled,
      })),
      domains,
      // Reported so the UI can explain why a configured domain matched nothing,
      // rather than looking broken.
      ignoredPublicDomains: (org.allowedEmailDomains ?? [])
        .map((d) => d.trim().toLowerCase())
        .filter((d) => d && PUBLIC_EMAIL_DOMAINS.has(d)),
    };
  }),

  /** Adopt a domain-matched account as a member. */
  convertDomainCandidate: authenticatedProcedure
    .input(
      z.object({
        userId: z.number(),
        role: z.enum(['ORG_ADMIN', 'DMS_ADMIN', 'TEAM_ADMIN', 'MANAGER', 'MEMBER']).default('MEMBER'),
        /**
         * Consume one of the org's purchased seats as part of the conversion.
         * Omit to add them unlicensed — membership and licensing are separate,
         * and an org may not have seats to spare.
         */
        seatTier: z.enum(['BUSINESS', 'ENTERPRISE']).optional(),
        /** Required when the user holds a personal plan the seat will cancel. */
        acknowledgeCancelPersonalPlan: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: 'ORG_ADMIN' },
        orderBy: { joinedAt: 'asc' },
      });

      if (!membership) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only Org Admins can add members.',
        });
      }

      const org = await prisma.organization.findUniqueOrThrow({
        where: { id: membership.organizationId },
        select: { allowedEmailDomains: true },
      });

      const target = await prisma.user.findUnique({
        where: { id: input.userId },
        select: { id: true, email: true, name: true, disabled: true },
      });

      if (!target || target.disabled) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found.' });
      }

      // Re-checked server-side rather than trusting the id the client sent: the
      // list endpoint's filters are the security boundary, so this mutation has
      // to reapply every one of them or it becomes a way to add ANY user by id.
      const domains = normalizeClaimableDomains(org.allowedEmailDomains);
      const targetDomain = target.email.split('@')[1]?.toLowerCase() ?? '';

      if (!domains.includes(targetDomain)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${target.email} does not match a claimable domain for this organization.`,
        });
      }

      const existingAnywhere = await prisma.organizationMember.findFirst({
        where: { userId: target.id },
        select: { organizationId: true },
      });

      if (existingAnywhere) {
        throw new TRPCError({
          code: 'CONFLICT',
          message:
            existingAnywhere.organizationId === membership.organizationId
              ? `${target.email} is already a member.`
              : `${target.email} already belongs to another organization.`,
        });
      }

      const created = await prisma.organizationMember.create({
        data: {
          organizationId: membership.organizationId,
          userId: target.id,
          role: input.role,
        },
      });

      // Licensing, if asked for. Runs AFTER the membership exists because a seat
      // is assigned to a member row, not to a user.
      //
      // A throw here (no seats left, or an unacknowledged personal plan) leaves
      // the member created but unlicensed rather than rolling back — deliberate:
      // the admin's primary intent was to add the person, and an unlicensed
      // member is a state the UI already handles and can fix with one click.
      // Undoing the membership would discard the successful half of the action.
      let seat: { assigned: boolean; tier?: string; error?: string } = { assigned: false };

      if (input.seatTier) {
        try {
          const seated = await assignSeatToMember({
            organizationId: membership.organizationId,
            memberId: created.id,
            tier: input.seatTier,
            acknowledgeCancelPersonalPlan: input.acknowledgeCancelPersonalPlan,
          });

          seat = { assigned: Boolean(seated.seatTier), tier: seated.seatTier ?? undefined };
        } catch (err) {
          seat = {
            assigned: false,
            error: err instanceof TRPCError ? err.message : 'Seat assignment failed.',
          };
        }
      }

      return { success: true, email: target.email, name: target.name, seat };
    }),

  /**
   * Aggregates for the organization dashboard (`/org`).
   *
   * Every eSign figure is scoped on `Document.organizationId`, stamped at
   * creation. It used to be derived from the member user-id set, which meant a
   * user belonging to several organizations caused each of them to report that
   * user's documents as its own. Approvals, inbox items and workflows are
   * natively org-scoped and filter directly.
   */
  getDashboardStats: authenticatedProcedure
    .input(
      z
        .object({
          /** Inclusive start, `yyyy-MM-dd`. Omit for no lower bound. */
          from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
          /** Inclusive end, `yyyy-MM-dd`. The whole day is included. */
          to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: ctx.user.id },
      // A user can belong to several orgs; without an explicit order Postgres
      // heap order decides which one this describes, and an unrelated row
      // UPDATE can silently switch it. Matches `resolveOrganizationId`.
      orderBy: { joinedAt: 'asc' },
    });

    if (!membership) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You are not a member of an organization.',
      });
    }

    const { organizationId } = membership;

    // Selected range. `to` covers the whole day, so it's stored as an exclusive
    // upper bound at the start of the following day — a `<= 2026-08-06` filter
    // would otherwise drop everything created after midnight on the 6th.
    const rangeFrom = input?.from ? DateTime.fromISO(input.from, { zone: 'utc' }).startOf('day') : null;
    const rangeToExclusive = input?.to
      ? DateTime.fromISO(input.to, { zone: 'utc' }).startOf('day').plus({ days: 1 })
      : null;

    const hasRange = Boolean(rangeFrom || rangeToExclusive);

    const createdAtFilter =
      rangeFrom || rangeToExclusive
        ? {
            createdAt: {
              ...(rangeFrom && { gte: rangeFrom.toJSDate() }),
              ...(rangeToExclusive && { lt: rangeToExclusive.toJSDate() }),
            },
          }
        : {};

    const documentWhere = { organizationId, deletedAt: null, ...createdAtFilter };

    const now = DateTime.utc().startOf('month');

    // Trend window. With no range selected this is twelve whole months ending
    // with the current one — the previous fixed behaviour. With a range, the
    // chart must follow it, or the headline and the chart beneath it would be
    // describing different periods.
    const trendStart = (rangeFrom ?? now.minus({ months: 11 })).startOf('day');
    const trendEnd = rangeToExclusive ?? now.plus({ months: 1 });

    // Bucket granularity is chosen from the span, not fixed. Monthly buckets
    // over a 7-day range would collapse the whole chart into one bar.
    const spanDays = trendEnd.diff(trendStart, 'days').days;
    const grain: 'day' | 'month' = spanDays <= 62 ? 'day' : 'month';

    const bucketFormat = grain === 'day' ? 'yyyy-MM-dd' : 'yyyy-MM';
    const bucketLabel = grain === 'day' ? 'd MMM' : 'MMM yyyy';

    // Pre-seeded so quiet periods plot as zero rather than collapsing the axis.
    const bucketKeys: string[] = [];
    for (
      let cursor = trendStart.startOf(grain);
      cursor < trendEnd;
      cursor = cursor.plus(grain === 'day' ? { days: 1 } : { months: 1 })
    ) {
      bucketKeys.push(cursor.toFormat(bucketFormat));

      // Guard against a pathological range producing an unbounded series.
      if (bucketKeys.length >= 400) break;
    }

    const windowStart = trendStart;
    const windowEnd = trendEnd;

    // Only these statuses have actually left the building. DRAFT documents have
    // never been sent to anyone, so they must not count toward "sent" figures.
    const SENT_STATUSES = ['PENDING', 'COMPLETED', 'REJECTED'] as const;

    const [
      byStatus,
      approvalsByStatus,
      totalDocuments,
      inboxSourced,
      pendingDocuments,
      documentsByMonth,
      approvalsByMonth,
      topSenders,
      activeWorkflows,
    ] = await Promise.all([
      prisma.document.groupBy({
        by: ['status'],
        where: documentWhere,
        _count: { _all: true },
      }),
      prisma.approvalRequest.groupBy({
        by: ['status'],
        where: { organizationId, ...createdAtFilter },
        _count: { _all: true },
      }),
      prisma.document.count({ where: documentWhere }),
      // Counted over the SAME row set as totalDocuments, via the relation, so
      // the two slices always partition one population. Counting
      // SignatureInboxItem directly mixed org-scoped inbox rows with
      // member-scoped documents and needed a clamp to stay non-negative.
      prisma.document.count({ where: { ...documentWhere, inboxItem: { isNot: null } } }),
      // Aging is bucketed by how far past the INVOICE's due date each pending
      // document is, so only its id is needed here — the dates come from the
      // due-date resolver below.
      prisma.document.findMany({
        where: { ...documentWhere, status: 'PENDING' },
        select: { id: true },
      }),
      // `grain` is a literal from a two-value union, never user text, so it is
      // safe to interpolate into DATE_TRUNC — which cannot take a bound
      // parameter for its field argument.
      prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
        SELECT DATE_TRUNC(${grain}, "createdAt") AS bucket, COUNT(*) AS count
        FROM "Document"
        WHERE "organizationId" = ${organizationId}
          AND "deletedAt" IS NULL
          AND "createdAt" >= ${windowStart.toJSDate()}::timestamp
          AND "createdAt" <  ${windowEnd.toJSDate()}::timestamp
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      prisma.$queryRaw<Array<{ bucket: Date; count: bigint }>>`
        SELECT DATE_TRUNC(${grain}, "createdAt") AS bucket, COUNT(*) AS count
        FROM "ApprovalRequest"
        WHERE "organizationId" = ${organizationId}
          AND "createdAt" >= ${windowStart.toJSDate()}::timestamp
          AND "createdAt" <  ${windowEnd.toJSDate()}::timestamp
        GROUP BY 1
        ORDER BY 1 ASC
      `,
      // "Senders", so drafts that were never dispatched are excluded — counting
      // them overstated the leaders and listed people who had sent nothing.
      prisma.document.groupBy({
        by: ['userId'],
        where: { ...documentWhere, status: { in: [...SENT_STATUSES] } },
        _count: { _all: true },
        orderBy: { _count: { userId: 'desc' } },
        take: 5,
      }),
      prisma.workflow.count({ where: { organizationId, enabled: true } }),
    ]);

    // How many distinct people have sent anything, so the card can say "top 5
    // of N" instead of reporting the length of a capped list as a metric.
    const distinctSenders = await prisma.document
      .groupBy({
        by: ['userId'],
        where: { ...documentWhere, status: { in: [...SENT_STATUSES] } },
      })
      .then((rows) => rows.length);

    const countOf = <T extends string>(
      rows: Array<{ status: T; _count: { _all: number } }>,
      value: T,
    ) => rows.find((r) => r.status === value)?._count._all ?? 0;

    const senderProfiles = await prisma.user.findMany({
      where: { id: { in: topSenders.map((s) => s.userId) } },
      select: { id: true, name: true, email: true },
    });

    const toSeries = (rows: Array<{ bucket: Date; count: bigint }>) => {
      const found = new Map(
        rows.map((r) => [
          DateTime.fromJSDate(r.bucket).toUTC().toFormat(bucketFormat),
          Number(r.count),
        ]),
      );

      return bucketKeys.map((key) => ({
        month: key,
        label: DateTime.fromFormat(key, bucketFormat, { zone: 'utc' }).toFormat(bucketLabel),
        count: found.get(key) ?? 0,
      }));
    };

    /*
      Aging, measured against the date the VENDOR is owed by.

      It used to measure how long each pending document had been outstanding since
      we sent it. That answers "how slow are our signers", which the "Waiting on"
      and "Where it's stuck" tiles already answer better — and it is not what an
      aging report means to anyone in finance. An invoice with three weeks of
      credit left was shown in the same bucket as one a month past its due date.

      The due date is the one OCR read off the invoice, or the vendor's payment
      terms code applied to the invoice date. Documents that have neither get their
      own bucket rather than being dropped: the donut has to sum to the headline,
      and "we cannot judge these" is a real answer that a silent omission hides.
    */
    const dueDates = await getOrganizationDueDates({ organizationId });
    const daysPastDueByDocument = new Map(
      dueDates.map((due) => [due.documentId, due.daysPastDue]),
    );

    const ageBuckets = [
      { key: 'current', label: 'Not yet due', min: -Infinity, max: 1, count: 0 },
      { key: '1-30', label: '1-30 days late', min: 1, max: 31, count: 0 },
      { key: '31-60', label: '31-60 days late', min: 31, max: 61, count: 0 },
      { key: '61-90', label: '61-90 days late', min: 61, max: 91, count: 0 },
      { key: '90+', label: '90+ days late', min: 91, max: Infinity, count: 0 },
      { key: 'unknown', label: 'No due date', min: NaN, max: NaN, count: 0 },
    ];

    const unknownBucket = ageBuckets[ageBuckets.length - 1];

    for (const doc of pendingDocuments) {
      const daysPastDue = daysPastDueByDocument.get(doc.id);

      // `undefined` means the document never came through the inbox at all (a
      // hand-uploaded contract has no invoice due date to have); `null` means it
      // did but neither the page nor the vendor's terms could date it. Both are
      // "cannot be judged", and the tile says so rather than implying punctuality.
      if (daysPastDue === undefined || daysPastDue === null) {
        unknownBucket.count += 1;
        continue;
      }

      const bucket = ageBuckets.find((b) => daysPastDue >= b.min && daysPastDue < b.max);
      if (bucket) bucket.count += 1;
    }

    const documentTrend = toSeries(documentsByMonth);
    const approvalTrend = toSeries(approvalsByMonth);

    // The last bucket is the current, in-flight month, so both sides of this
    // comparison cover the SAME elapsed portion of their month — otherwise a
    // month-to-date figure gets divided by a complete month and the card
    // reports a collapse every time a month rolls over.
    //
    // Both the percentage AND the bars are built from this one basis. An earlier
    // version charted full months while computing the percentage like-for-like,
    // which rendered "+900%" above two visually equal bars.
    const nowUtc = DateTime.utc();
    const elapsed = nowUtc.diff(now);
    const throughDay = nowUtc.day;
    const currentMonthCount = documentTrend[documentTrend.length - 1]?.count ?? 0;

    const previousMonthStart = now.minus({ months: 1 });
    // Clamp so a long elapsed span can't spill past the end of a shorter
    // previous month (e.g. 30 days elapsed in March reaching into February).
    const previousWindowEnd = DateTime.min(previousMonthStart.plus(elapsed), now);

    const previousToDate = await prisma.document.count({
      where: {
        ...documentWhere,
        createdAt: { gte: previousMonthStart.toJSDate(), lt: previousWindowEnd.toJSDate() },
      },
    });

    const bottlenecks = await getSigningBottlenecks(membership.organizationId);

    return {
      totalDocuments,
      draft: countOf(byStatus, 'DRAFT'),
      pending: countOf(byStatus, 'PENDING'),
      completed: countOf(byStatus, 'COMPLETED'),
      rejected: countOf(byStatus, 'REJECTED'),

      // PENDING and IN_PROGRESS are both "not yet decided" — surfaced as one
      // figure, but labelled "open" rather than "pending" so the name matches
      // what it counts.
      approvalsOpen: countOf(approvalsByStatus, 'PENDING') + countOf(approvalsByStatus, 'IN_PROGRESS'),
      approvalsApproved: countOf(approvalsByStatus, 'APPROVED'),
      approvalsRejected: countOf(approvalsByStatus, 'REJECTED'),
      approvalsCancelled: countOf(approvalsByStatus, 'CANCELLED'),

      inboxSourced,
      // Both operands come from the same row set now, so the residual can never
      // go negative and needs no clamp.
      manualSourced: totalDocuments - inboxSourced,
      activeWorkflows,

      documentTrend,
      approvalTrend,
      // Charted totals, for headlines that sit above a 12-month chart. Distinct
      // from the all-time totals above, which are not windowed.
      documentsCharted: documentTrend.reduce((sum, point) => sum + point.count, 0),
      approvalsCharted: approvalTrend.reduce((sum, point) => sum + point.count, 0),

      ageBuckets: ageBuckets.map(({ key, label, count }) => ({ key, label, count })),

      // Where signatures are stuck and with whom. Deliberately NOT windowed by
      // the date filter: a bottleneck is about what is outstanding right now,
      // and hiding a four-month-old stuck document because it falls outside
      // "this month" would hide the worst case on the dashboard.
      bottlenecks,

      monthOverMonth: {
        current: currentMonthCount,
        previousToDate,
        // Labels name the exact windows being compared, so the percentage is
        // self-evidently explained by the two bars beneath it.
        currentLabel: `${now.toFormat('MMM')} 1–${throughDay}`,
        previousLabel: `${previousMonthStart.toFormat('MMM')} 1–${throughDay}`,
        throughDay,
        // Null, not 100: percent change from a zero base is undefined, and
        // printing "100%" made 0→1 and a genuine doubling look identical. The
        // UI renders this as "New activity" instead of a number.
        percentChange:
          previousToDate === 0 ? null : ((currentMonthCount - previousToDate) / previousToDate) * 100,
      },

      distinctSenders,
      topSenders: topSenders.map((s) => {
        const profile = senderProfiles.find((p) => p.id === s.userId);

        return {
          userId: s.userId,
          name: profile?.name || profile?.email || 'Unknown',
          email: profile?.email ?? '',
          count: s._count._all,
        };
      }),

      // Echoed back so the UI can state the period it is showing rather than
      // implying "all time", and so it knows whether month-over-month (which
      // always describes calendar months) is comparable to the rest of the page.
      range: {
        from: rangeFrom?.toFormat('yyyy-MM-dd') ?? null,
        to: rangeToExclusive?.minus({ days: 1 }).toFormat('yyyy-MM-dd') ?? null,
        active: hasRange,
        grain,
        trendFrom: trendStart.toFormat('yyyy-MM-dd'),
        trendTo: trendEnd.minus({ days: 1 }).toFormat('yyyy-MM-dd'),
      },

      /** Server clock at query time, so the UI can show a truthful "updated" age. */
      generatedAt: DateTime.utc().toISO(),
    };
    }),
});
