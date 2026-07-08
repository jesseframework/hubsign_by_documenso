import { createElement } from 'react';

import { msg } from '@lingui/core/macro';
import { SubscriptionStatus } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { onOrgSubscriptionUpdated } from '@documenso/ee/server-only/stripe/webhook/on-org-subscription-updated';
import { onSubscriptionDeleted } from '@documenso/ee/server-only/stripe/webhook/on-subscription-deleted';
import { IS_BILLING_ENABLED, NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { getI18nInstance } from '@documenso/lib/client-only/providers/i18n-server';
import {
  ORG_DMS_ADDON_PRICE_CENTS,
  ORG_SEAT_TIERS,
  ORG_UNLIMITED_SENTINEL,
} from '@documenso/lib/constants/org-tiers';
import { env } from '@documenso/lib/utils/env';
import { renderEmailWithI18N } from '@documenso/lib/utils/render-email-with-i18n';
import crypto from 'crypto';

import { mailer } from '@documenso/email/mailer';
import { OrgMemberInviteEmailTemplate } from '@documenso/email/templates/org-member-invite';
import { OrgMemberWelcomeEmailTemplate } from '@documenso/email/templates/org-member-welcome';
import { ONE_DAY } from '@documenso/lib/constants/time';
import { stripe } from '@documenso/lib/server-only/stripe';
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
 */
const resolveActivePersonalPlan = async (userId: number) => {
  const subscriptions = await prisma.subscription.findMany({
    where: { userId, status: SubscriptionStatus.ACTIVE },
    orderBy: { updatedAt: 'desc' },
  });

  for (const subscription of subscriptions) {
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
   * Search members of the current user's organization by name or email.
   * Used by the recipient autocomplete in the signer-add flow.
   * Returns empty array if the user isn't in any organization.
   */
  searchMembers: authenticatedProcedure
    .input(z.object({ query: z.string().max(200).optional() }))
    .query(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id },
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
      include: {
        organization: {
          include: {
            members: {
              include: {
                user: { select: { id: true, name: true, email: true } },
              },
            },
            _count: { select: { teams: true, dmsDocuments: true, dmsLocations: true } },
          },
        },
      },
    });

    return membership;
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
      allowedEmailDomains: z.array(z.string().min(1).max(253)).optional(),
      signReminderEnabled: z.boolean().optional(),
      signReminderDays: z.number().int().min(1).max(60).optional(),
      signReminderMaxCount: z.number().int().min(1).max(10).optional(),
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
    }))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN'] } },
      });

      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only Org Admins can update the organization' });
      }

      return prisma.organization.update({
        where: { id: membership.organizationId },
        data: input,
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
      // them a single-use set-password link via the password reset flow.
      let setPasswordLink: string | null = null;
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

        // Generate a single-use set-password token (24-hour expiry).
        const token = crypto.randomBytes(18).toString('hex');
        await prisma.passwordResetToken.create({
          data: {
            token,
            expiry: new Date(Date.now() + ONE_DAY),
            userId: user.id,
          },
        });

        const base = NEXT_PUBLIC_WEBAPP_URL() || 'http://localhost:3000';
        setPasswordLink = `${base}/reset-password/${token}`;
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

      const assetBaseUrl = NEXT_PUBLIC_WEBAPP_URL() || 'http://localhost:3000';
      const roleLabel = input.role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

      // Choose template: welcome (with set-password link) for new users,
      // or existing-user invite for users who already had an account.
      const emailTemplate =
        isNewUser && setPasswordLink
          ? createElement(OrgMemberWelcomeEmailTemplate, {
              assetBaseUrl,
              baseUrl: assetBaseUrl,
              inviterName: inviter.name || inviter.email,
              orgName: org.name,
              role: roleLabel,
              welcomeMessage: input.welcomeMessage || '',
              setPasswordLink,
            })
          : createElement(OrgMemberInviteEmailTemplate, {
              assetBaseUrl,
              baseUrl: assetBaseUrl,
              inviterName: inviter.name || inviter.email,
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
        subject: i18n._(
          isNewUser
            ? msg`Welcome to ${org.name} on HubSign`
            : msg`You've been added to ${org.name} on HubSign`,
        ),
        html,
        text,
      }).catch((err) => {
        console.error('[Org Invite] Failed to send invite email:', err);
      });

      return newMember;
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

  purchaseSeats: authenticatedProcedure
    .input(z.object({
      tier: z.enum(['BUSINESS', 'ENTERPRISE']),
      quantity: z.number().min(1).max(100),
      dmsEnabled: z.boolean().optional(),
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

      // An org can only be on one seat tier at a time — no mixing Business and
      // Enterprise seats within the same org.
      const otherTierPlan = await prisma.orgSeatPlan.findFirst({
        where: { organizationId: membership.organizationId, tier: { not: input.tier } },
      });

      if (otherTierPlan && otherTierPlan.quantity > 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Your organization is already on the ${otherTierPlan.tier} plan. An organization can only be on one seat tier at a time.`,
        });
      }

      const org = membership.organization;

      // A "top-up" — the org already has a live subscription for this tier —
      // adds quantity directly to it instead of starting a new subscription.
      // Only a first purchase goes through Checkout.
      const existingSeatPlan = await prisma.orgSeatPlan.findFirst({
        where: { organizationId: membership.organizationId, tier: input.tier },
      });

      const isTopUp = Boolean(
        existingSeatPlan && org.stripeSubscriptionId && org.stripeSeatPriceId,
      );

      const tierLimits = ORG_SEAT_TIERS[input.tier];

      const config = {
        documentsPerMonth: tierLimits.documents ?? ORG_UNLIMITED_SENTINEL,
        recipientsPerMonth: tierLimits.recipients ?? ORG_UNLIMITED_SENTINEL,
        directTemplates: tierLimits.directTemplates ?? ORG_UNLIMITED_SENTINEL,
        dmsEnabled: tierLimits.dmsEnabled,
        price: tierLimits.priceCents,
        minSeats: tierLimits.minSeats,
      };

      const dmsEnabled = input.dmsEnabled ?? config.dmsEnabled;

      // The tier minimum only applies to establishing the tier in the first
      // place — once the org already meets it, buying 1-2 more is fine.
      if (!isTopUp && input.quantity < config.minSeats) {
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
        const canceledSubscription = await stripe.subscriptions.cancel(adminActivePlan.subscription.planId, {
          invoice_now: true,
          prorate: true,
        });

        await onSubscriptionDeleted({ subscription: canceledSubscription });
      }

      if (!IS_BILLING_ENABLED()) {
        // Billing not enabled — just track it locally, synchronously (no
        // Stripe involved either way, so there's nothing to wait on).
        const seatPlan = existingSeatPlan
          ? await prisma.orgSeatPlan.update({
              where: { id: existingSeatPlan.id },
              data: { quantity: existingSeatPlan.quantity + input.quantity, dmsEnabled },
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
              },
            });

        if (adminNeedsSeat) {
          const updatedSeatPlan = await prisma.orgSeatPlan.update({
            where: { id: seatPlan.id },
            data: { assigned: { increment: 1 } },
          });

          await prisma.organizationMember.update({
            where: { id: membership.id },
            data: { seatTier: input.tier, dmsAddon: input.tier === 'ENTERPRISE' ? true : dmsEnabled },
          });

          return updatedSeatPlan;
        }

        return seatPlan;
      }

      if (isTopUp) {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const subscriptionId = org.stripeSubscriptionId as string;
        const newQuantity = (existingSeatPlan?.quantity ?? 0) + input.quantity;

        const liveSubscription = await stripe.subscriptions.retrieve(subscriptionId, {
          expand: ['items.data.price.product'],
        });

        const seatItem = liveSubscription.items.data.find(
          (item) => item.price.id === org.stripeSeatPriceId,
        );

        if (!seatItem) {
          throw new Error('Seat item not found on subscription');
        }

        // Look up by the cached price id first; fall back to scanning live
        // items by product metadata if that's stale (the exact staleness
        // that previously caused a duplicate DMS item/product to be created
        // on every top-up instead of reusing the existing one).
        const existingDmsItem =
          liveSubscription.items.data.find((item) => item.price.id === org.stripeDmsPriceId) ??
          liveSubscription.items.data.find((item) => {
            const { product } = item.price;
            return typeof product !== 'string' && !product.deleted && product.metadata?.type === 'org_dms';
          });

        const items: Array<{ id?: string; price?: string; quantity: number }> = [
          { id: seatItem.id, quantity: newQuantity },
        ];

        // Once enabled, DMS stays enabled even if this particular top-up
        // didn't touch the checkbox (it defaults unchecked on every purchase).
        const dmsNowEnabled = dmsEnabled || Boolean(existingDmsItem);

        if (dmsNowEnabled) {
          if (existingDmsItem) {
            items.push({ id: existingDmsItem.id, quantity: newQuantity });
          } else {
            // Unlike Checkout Session line items, `subscriptions.update`
            // doesn't accept an inline `price_data.product_data` — it needs
            // a real product/price to reference, so create those first.
            const dmsProduct = await stripe.products.create({
              name: 'Document Manager (DMS) Add-On',
              metadata: { type: 'org_dms', tier: input.tier },
            });

            const dmsPrice = await stripe.prices.create({
              currency: 'usd',
              unit_amount: ORG_DMS_ADDON_PRICE_CENTS,
              recurring: { interval: 'month' },
              product: dmsProduct.id,
            });

            items.push({ price: dmsPrice.id, quantity: newQuantity });
          }
        }

        // One atomic call for seat + DMS together: `always_invoice` charges
        // the prorated amount to the card on file immediately (Stripe's
        // default just queues it for the next billing cycle), matching the
        // agreed "direct charge, no extra screen" behavior. Also refreshes
        // `purchasingMemberId` (so a not-yet-seated admin still gets
        // auto-assigned) and `dmsEnabled` (which `onOrgSubscriptionUpdated`
        // reads, not the live items list, to know whether item[1] is DMS).
        const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
          items,
          proration_behavior: 'always_invoice',
          metadata: {
            ...liveSubscription.metadata,
            purchasingMemberId: membership.id,
            dmsEnabled: dmsNowEnabled.toString(),
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

        return { success: true };
      }

      // First purchase — create a Stripe checkout session. `OrgSeatPlan` and
      // seat assignment are intentionally NOT written here — they're only
      // ever written from confirmed Stripe state once the webhook fires
      // (`onOrgSubscriptionUpdated`), not optimistically before payment.
      const customerId = await getOrCreateStripeCustomer(org, ctx.user.email);
      const baseUrl = NEXT_PUBLIC_WEBAPP_URL() || 'http://localhost:3000';

      const lineItems: Array<{
        price_data: {
          currency: string;
          product_data: { name: string; metadata: Record<string, string> };
          unit_amount: number;
          recurring: { interval: 'month' };
        };
        quantity: number;
      }> = [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `HubSign ${input.tier.charAt(0) + input.tier.slice(1).toLowerCase()} Seat`,
              metadata: { type: 'org_seat', tier: input.tier },
            },
            unit_amount: config.price,
            recurring: { interval: 'month' },
          },
          quantity: input.quantity,
        },
      ];

      // Add DMS add-on line item if enabled
      if (dmsEnabled && input.tier !== 'ENTERPRISE') {
        lineItems.push({
          price_data: {
            currency: 'usd',
            product_data: {
              name: 'Document Manager (DMS) Add-On',
              metadata: { type: 'org_dms', tier: input.tier },
            },
            unit_amount: ORG_DMS_ADDON_PRICE_CENTS,
            recurring: { interval: 'month' },
          },
          quantity: input.quantity,
        });
      }

      const sessionParams = {
        customer: customerId,
        mode: 'subscription' as const,
        line_items: lineItems,
        subscription_data: {
          metadata: {
            organizationId: org.id.toString(),
            type: 'organization',
            tier: input.tier,
            quantity: input.quantity.toString(),
            dmsEnabled: dmsEnabled.toString(),
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
      acknowledgeCancelPersonalPlan: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] } },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      // An org only ever has one active seat tier — no tier to choose.
      const seatPlan = await prisma.orgSeatPlan.findFirst({
        where: { organizationId: myMembership.organizationId },
      });

      if (!seatPlan) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'No seats purchased. Purchase seats first.' });
      }

      const targetMember = await prisma.organizationMember.findUniqueOrThrow({
        where: { id: input.memberId },
      });

      // Admins can't change their own seat — but only when there's someone
      // else who actually could. Otherwise this would be a hard deadlock: a
      // sole admin (or one whose only other admins lack the right role) would
      // have nobody to ask. (Auto-consuming seat #1 on purchase is a separate
      // mechanism in `purchaseSeats` and is unaffected by this either way.)
      if (targetMember.id === myMembership.id) {
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

      // Already seated — a member can only ever hold *the* org's one tier, so
      // there's nothing to reassign.
      if (targetMember.seatTier) {
        return targetMember;
      }

      // Re-check server-side regardless of whether the client already called
      // `getMemberBillingConflict` — this is the actual enforcement point.
      const activePlan = await resolveActivePersonalPlan(targetMember.userId);

      if (activePlan && !input.acknowledgeCancelPersonalPlan) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This member has an active personal subscription that will be cancelled.',
        });
      }

      if (activePlan) {
        // Cancel immediately with proration — unused time lands as a Stripe
        // account-balance credit (applied to future invoices), not a card
        // refund. Same pattern as `transfer-team-subscription.ts`.
        const canceledSubscription = await stripe.subscriptions.cancel(activePlan.subscription.planId, {
          invoice_now: true,
          prorate: true,
        });

        // Sync locally immediately rather than waiting on the webhook (mirrors
        // `update-subscription-plan.ts`) — the webhook will also fire and
        // no-op harmlessly on top of this.
        await onSubscriptionDeleted({ subscription: canceledSubscription });
      }

      // Check if seats are available
      if (seatPlan.assigned >= seatPlan.quantity) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'All seats are assigned. Purchase more seats.' });
      }

      // Assign the seat
      await prisma.orgSeatPlan.update({
        where: { id: seatPlan.id },
        data: { assigned: { increment: 1 } },
      });

      return prisma.organizationMember.update({
        where: { id: input.memberId },
        data: {
          seatTier: seatPlan.tier,
          // Derived from the org's actual purchased seat plan, not client
          // input — previously this trusted an arbitrary client-provided
          // boolean, letting anyone grant themselves free DMS access.
          dmsAddon: seatPlan.tier === 'ENTERPRISE' ? true : seatPlan.dmsEnabled,
        },
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
});
