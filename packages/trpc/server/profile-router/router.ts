import { SubscriptionStatus } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { IS_BILLING_ENABLED } from '@documenso/lib/constants/app';
import { AppError } from '@documenso/lib/errors/app-error';
import {
  LicenseRedeemError,
  redeemLicenseKey,
} from '@documenso/lib/server-only/license/redeem-license-key';
import { setAvatarImage } from '@documenso/lib/server-only/profile/set-avatar-image';
import { getSubscriptionsByUserId } from '@documenso/lib/server-only/subscription/get-subscriptions-by-user-id';
import { createBillingPortal } from '@documenso/lib/server-only/user/create-billing-portal';
import {
  createCheckoutSession,
  createEmbeddedCheckoutSession,
} from '@documenso/lib/server-only/user/create-checkout-session';
import { deleteUser } from '@documenso/lib/server-only/user/delete-user';
import { findUserSecurityAuditLogs } from '@documenso/lib/server-only/user/find-user-security-audit-logs';
import { getUserById } from '@documenso/lib/server-only/user/get-user-by-id';
import { updateProfile } from '@documenso/lib/server-only/user/update-profile';
import { updatePublicProfile } from '@documenso/lib/server-only/user/update-public-profile';
import { toggleSubscriptionAddon } from '@documenso/lib/server-only/user/toggle-subscription-addon';
import { updateSubscriptionPlan } from '@documenso/lib/server-only/user/update-subscription-plan';

import { adminProcedure, authenticatedProcedure, router } from '../trpc';
import {
  ZCreateCheckoutSessionRequestSchema,
  ZFindUserSecurityAuditLogsSchema,
  ZRetrieveUserByIdQuerySchema,
  ZSetProfileImageMutationSchema,
  ZToggleSubscriptionAddonRequestSchema,
  ZUpdateProfileMutationSchema,
  ZUpdatePublicProfileMutationSchema,
} from './schema';

export const profileRouter = router({
  findUserSecurityAuditLogs: authenticatedProcedure
    .input(ZFindUserSecurityAuditLogsSchema)
    .query(async ({ input, ctx }) => {
      return await findUserSecurityAuditLogs({
        userId: ctx.user.id,
        ...input,
      });
    }),

  getUser: adminProcedure.input(ZRetrieveUserByIdQuerySchema).query(async ({ input }) => {
    const { id } = input;

    return await getUserById({ id });
  }),

  createBillingPortal: authenticatedProcedure.mutation(async ({ ctx }) => {
    return await createBillingPortal({
      user: {
        id: ctx.user.id,
        customerId: ctx.user.customerId,
        email: ctx.user.email,
        name: ctx.user.name,
      },
    });
  }),

  createCheckoutSession: authenticatedProcedure
    .input(ZCreateCheckoutSessionRequestSchema)
    .mutation(async ({ ctx, input }) => {
      return await createCheckoutSession({
        user: {
          id: ctx.user.id,
          customerId: ctx.user.customerId,
          email: ctx.user.email,
          name: ctx.user.name,
        },
        priceId: input.priceId,
      });
    }),

  createEmbeddedCheckoutSession: authenticatedProcedure
    .input(ZCreateCheckoutSessionRequestSchema)
    .mutation(async ({ ctx, input }) => {
      return await createEmbeddedCheckoutSession({
        user: {
          id: ctx.user.id,
          customerId: ctx.user.customerId,
          email: ctx.user.email,
          name: ctx.user.name,
        },
        priceId: input.priceId,
      });
    }),

  updateSubscriptionPlan: authenticatedProcedure
    .input(ZCreateCheckoutSessionRequestSchema)
    .mutation(async ({ ctx, input }) => {
      return await updateSubscriptionPlan({
        userId: ctx.user.id,
        priceId: input.priceId,
      });
    }),

  toggleSubscriptionAddon: authenticatedProcedure
    .input(ZToggleSubscriptionAddonRequestSchema)
    .mutation(async ({ ctx, input }) => {
      return await toggleSubscriptionAddon({
        userId: ctx.user.id,
        priceId: input.priceId,
        action: input.action,
      });
    }),

  /**
   * Redeem a WorkHub-minted INDIVIDUAL license key (a Stripe-free activation).
   * Only activates a free account — rejected if the user already has an active
   * paid subscription (enforced in `redeemLicenseKey`).
   */
  redeemLicenseKey: authenticatedProcedure
    .input(z.object({ key: z.string().min(1).max(2000) }))
    .mutation(async ({ ctx, input }) => {
      try {
        const { grant } = await redeemLicenseKey({ key: input.key.trim(), userId: ctx.user.id });
        return { tier: grant.tier, addons: grant.addons, expiresAt: grant.expiresAt };
      } catch (err) {
        if (err instanceof LicenseRedeemError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        }
        throw err;
      }
    }),

  updateProfile: authenticatedProcedure
    .input(ZUpdateProfileMutationSchema)
    .mutation(async ({ input, ctx }) => {
      const { name, signature } = input;

      return await updateProfile({
        userId: ctx.user.id,
        name,
        signature,
        requestMetadata: ctx.metadata.requestMetadata,
      });
    }),

  updatePublicProfile: authenticatedProcedure
    .input(ZUpdatePublicProfileMutationSchema)
    .mutation(async ({ input, ctx }) => {
      const { url, bio, enabled } = input;

      if (IS_BILLING_ENABLED() && url !== undefined && url.length < 6) {
        const subscriptions = await getSubscriptionsByUserId({
          userId: ctx.user.id,
        }).then((subscriptions) =>
          subscriptions.filter((s) => s.status === SubscriptionStatus.ACTIVE),
        );

        if (subscriptions.length === 0) {
          throw new AppError('PREMIUM_PROFILE_URL', {
            message: 'Only subscribers can have a username shorter than 6 characters',
          });
        }
      }

      const user = await updatePublicProfile({
        userId: ctx.user.id,
        data: {
          url,
          bio,
          enabled,
        },
      });

      return { success: true, url: user.url };
    }),

  deleteAccount: authenticatedProcedure.mutation(async ({ ctx }) => {
    return await deleteUser({
      id: ctx.user.id,
    });
  }),

  setProfileImage: authenticatedProcedure
    .input(ZSetProfileImageMutationSchema)
    .mutation(async ({ input, ctx }) => {
      const { bytes, teamId } = input;

      return await setAvatarImage({
        userId: ctx.user.id,
        teamId,
        bytes,
        requestMetadata: ctx.metadata,
      });
    }),
});
