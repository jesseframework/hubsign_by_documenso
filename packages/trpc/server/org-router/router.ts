import { createElement } from 'react';

import { msg } from '@lingui/core/macro';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { IS_BILLING_ENABLED, NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { getI18nInstance } from '@documenso/lib/client-only/providers/i18n-server';
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

      // Update org billing — add seat
      await createOrUpdateOrgSubscription(membership.organizationId).catch((err) => {
        console.error('[Org Billing] Failed to update seats after invite:', err);
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

      const deleted = await prisma.organizationMember.delete({ where: { id: input.memberId } });

      // Update org billing — remove seat
      await createOrUpdateOrgSubscription(myMembership.organizationId).catch((err) => {
        console.error('[Org Billing] Failed to update seats after removal:', err);
      });

      return deleted;
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
      tier: z.enum(['STARTER', 'PRO', 'ENTERPRISE']),
      quantity: z.number().min(1).max(100),
      dmsEnabled: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const membership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: 'ORG_ADMIN' },
        include: { organization: { include: { members: true } } },
      });

      if (!membership) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      const tierConfig = {
        STARTER: { documentsPerMonth: 20, recipientsPerMonth: 50, directTemplates: 5, dmsEnabled: false, price: 1500, minSeats: 2 },
        PRO: { documentsPerMonth: 100, recipientsPerMonth: 500, directTemplates: 20, dmsEnabled: false, price: 2500, minSeats: 1 },
        ENTERPRISE: { documentsPerMonth: 999999, recipientsPerMonth: 999999, directTemplates: 999999, dmsEnabled: true, price: 4500, minSeats: 5 },
      };

      const config = tierConfig[input.tier];
      const dmsEnabled = input.dmsEnabled ?? config.dmsEnabled;

      // Enforce minimum seat count per tier (org-mode only)
      if (input.quantity < config.minSeats) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `${input.tier} plan requires a minimum of ${config.minSeats} seat${config.minSeats > 1 ? 's' : ''}.`,
        });
      }

      // If billing is enabled, create a Stripe checkout session
      if (IS_BILLING_ENABLED()) {
        const org = membership.organization;
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
              unit_amount: 1500, // $15/seat/mo
              recurring: { interval: 'month' },
            },
            quantity: input.quantity,
          });
        }

        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          mode: 'subscription',
          line_items: lineItems,
          subscription_data: {
            metadata: {
              organizationId: org.id.toString(),
              type: 'organization',
              tier: input.tier,
              quantity: input.quantity.toString(),
              dmsEnabled: dmsEnabled.toString(),
            },
          },
          success_url: `${baseUrl}/org/billing?success=true&tier=${input.tier}&qty=${input.quantity}`,
          cancel_url: `${baseUrl}/org/billing?canceled=true`,
        });

        // Also create/update the seat plan record so it's tracked locally
        const existing = await prisma.orgSeatPlan.findFirst({
          where: { organizationId: membership.organizationId, tier: input.tier },
        });

        if (existing) {
          await prisma.orgSeatPlan.update({
            where: { id: existing.id },
            data: {
              quantity: existing.quantity + input.quantity,
              dmsEnabled,
            },
          });
        } else {
          await prisma.orgSeatPlan.create({
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
        }

        return { url: session.url };
      }

      // Billing not enabled — just create the seat plan locally
      const existing = await prisma.orgSeatPlan.findFirst({
        where: { organizationId: membership.organizationId, tier: input.tier },
      });

      if (existing) {
        return prisma.orgSeatPlan.update({
          where: { id: existing.id },
          data: {
            quantity: existing.quantity + input.quantity,
            dmsEnabled,
          },
        });
      }

      return prisma.orgSeatPlan.create({
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
    }),

  assignSeat: authenticatedProcedure
    .input(z.object({
      memberId: z.string(),
      tier: z.enum(['STARTER', 'PRO', 'ENTERPRISE']),
      dmsAddon: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const myMembership = await prisma.organizationMember.findFirst({
        where: { userId: ctx.user.id, role: { in: ['ORG_ADMIN', 'DMS_ADMIN'] } },
      });

      if (!myMembership) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      // Check available seats for this tier
      const seatPlan = await prisma.orgSeatPlan.findFirst({
        where: { organizationId: myMembership.organizationId, tier: input.tier },
      });

      if (!seatPlan) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `No ${input.tier} seats purchased. Purchase seats first.` });
      }

      // Get the member's current tier to handle re-assignment
      const targetMember = await prisma.organizationMember.findUniqueOrThrow({
        where: { id: input.memberId },
      });

      // If member already has a seat, free it
      if (targetMember.seatTier) {
        await prisma.orgSeatPlan.updateMany({
          where: { organizationId: myMembership.organizationId, tier: targetMember.seatTier },
          data: { assigned: { decrement: 1 } },
        });
      }

      // Check if seats are available
      if (seatPlan.assigned >= seatPlan.quantity) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `All ${input.tier} seats are assigned. Purchase more seats.` });
      }

      // Assign the seat
      await prisma.orgSeatPlan.update({
        where: { id: seatPlan.id },
        data: { assigned: { increment: 1 } },
      });

      return prisma.organizationMember.update({
        where: { id: input.memberId },
        data: {
          seatTier: input.tier,
          dmsAddon: input.dmsAddon ?? (input.tier === 'ENTERPRISE'),
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
