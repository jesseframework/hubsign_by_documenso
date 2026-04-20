import { z } from 'zod';

import { isFcmConfigured } from '@documenso/lib/server-only/push-notifications/fcm-client';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure, router } from '../trpc';

export const pushRouter = router({
  /**
   * Whether push notifications are enabled server-side. The web client uses
   * this to decide whether to attempt FCM token registration at all.
   */
  isEnabled: authenticatedProcedure.query(() => ({
    enabled: isFcmConfigured(),
  })),

  /**
   * Register an FCM device token for the current user. Idempotent — if the
   * token already exists it just updates `lastUsedAt`.
   */
  registerDevice: authenticatedProcedure
    .input(
      z.object({
        token: z.string().min(10).max(4096),
        platform: z.enum(['web', 'ios', 'android']).optional(),
        label: z.string().max(120).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return prisma.pushDeviceToken.upsert({
        where: { token: input.token },
        create: {
          userId: ctx.user.id,
          token: input.token,
          platform: input.platform,
          label: input.label,
        },
        update: {
          userId: ctx.user.id,
          lastUsedAt: new Date(),
          platform: input.platform,
          label: input.label,
        },
      });
    }),

  /** Remove a device token (e.g. user revokes browser notifications). */
  unregisterDevice: authenticatedProcedure
    .input(z.object({ token: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await prisma.pushDeviceToken.deleteMany({
        where: { token: input.token, userId: ctx.user.id },
      });
      return { ok: true };
    }),

  /** Read this user's notification preferences (creates defaults if missing). */
  getPreferences: authenticatedProcedure.query(async ({ ctx }) => {
    const existing = await prisma.pushNotificationPreference.findUnique({
      where: { userId: ctx.user.id },
    });
    if (existing) return existing;
    return prisma.pushNotificationPreference.create({
      data: { userId: ctx.user.id },
    });
  }),

  updatePreferences: authenticatedProcedure
    .input(
      z.object({
        documentSentToYou: z.boolean().optional(),
        documentSigned: z.boolean().optional(),
        documentCompleted: z.boolean().optional(),
        documentRejected: z.boolean().optional(),
        reminderReceived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return prisma.pushNotificationPreference.upsert({
        where: { userId: ctx.user.id },
        create: { userId: ctx.user.id, ...input },
        update: input,
      });
    }),
});
