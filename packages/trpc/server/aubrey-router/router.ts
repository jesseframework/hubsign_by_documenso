import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import {
  AubreyServiceError,
  aubreyChat,
  getAubreyConversationMessages,
  getAubreyConversations,
} from '@documenso/lib/server-only/aubrey/agent';
import {
  AiBridgeError,
  callAiBridge,
  isAiBridgeBaseConfigured,
} from '@documenso/lib/server-only/ai/bridge';
import { resolveAiApiKey } from '@documenso/lib/server-only/ai/resolve-ai-key';
import { AubreyCreditError, getAubreyCredit } from '@documenso/lib/server-only/aubrey/credits';
import {
  AiCreditRedeemError,
  redeemAiCredits,
} from '@documenso/lib/server-only/aubrey/redeem-ai-credits';
import { prisma } from '@documenso/prisma';
import { OrganizationRole } from '@prisma/client';

import { authenticatedProcedure, router } from '../trpc';

/** The caller's acting org (earliest-joined) + their role there. */
async function actingOrg(userId: number) {
  return prisma.organizationMember.findFirst({
    where: { userId },
    orderBy: { joinedAt: 'asc' },
    select: { organizationId: true, role: true },
  });
}

export const aubreyRouter = router({
  chat: authenticatedProcedure
    .input(z.object({ message: z.string().min(1), conversationId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await aubreyChat({
          userId: ctx.user.id,
          message: input.message,
          conversationId: input.conversationId,
        });
      } catch (err) {
        if (err instanceof AubreyCreditError) {
          throw new TRPCError({ code: 'FORBIDDEN', message: err.message });
        }
        // Already carries a message written for the user; the upstream detail
        // stayed in the server log.
        if (err instanceof AubreyServiceError) {
          throw new TRPCError({ code: 'BAD_GATEWAY', message: err.message });
        }
        throw err;
      }
    }),

  getConversations: authenticatedProcedure.query(async ({ ctx }) => {
    return getAubreyConversations(ctx.user.id);
  }),

  getMessages: authenticatedProcedure
    .input(z.object({ conversationId: z.string() }))
    .query(async ({ ctx, input }) => {
      return getAubreyConversationMessages(ctx.user.id, input.conversationId);
    }),

  getUsage: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await actingOrg(ctx.user.id);
    const credit = await getAubreyCredit({
      userId: ctx.user.id,
      organizationId: membership?.organizationId ?? null,
      email: ctx.user.email,
    });
    return {
      ...credit,
      canRedeem:
        membership?.role === OrganizationRole.ORG_ADMIN && membership?.organizationId != null,
    };
  }),

  /**
   * Every top-up this organization has ever redeemed.
   *
   * The ledger was already being written for audit and idempotency; nothing
   * showed it, so a pool balance of 0 gave an admin no way to tell "we never
   * bought any" from "we bought 500 and used them all". Lifetime purchased and
   * the running balance come from the balance row, so consumption is the
   * difference rather than a separate figure that could drift from it.
   */
  redemptionHistory: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await actingOrg(ctx.user.id);

    if (!membership?.organizationId) {
      return { entries: [], totalPurchased: 0, balance: 0, isAdmin: false };
    }

    const [redemptions, balanceRow] = await Promise.all([
      prisma.aiCreditRedemption.findMany({
        where: { organizationId: membership.organizationId },
        orderBy: { redeemedAt: 'desc' },
        take: 100,
        select: { id: true, jti: true, credits: true, redeemedAt: true, redeemedByUserId: true },
      }),
      prisma.aiCreditBalance.findUnique({
        where: { organizationId: membership.organizationId },
        select: { balance: true, totalPurchased: true },
      }),
    ]);

    // `AiCreditRedemption` has no relation to User, so the names are resolved
    // in one extra query rather than a join.
    const userIds = [
      ...new Set(redemptions.map((r) => r.redeemedByUserId).filter((id): id is number => id !== null)),
    ];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const byId = new Map(users.map((user) => [user.id, user]));

    return {
      entries: redemptions.map((redemption) => ({
        id: redemption.id,
        credits: redemption.credits,
        redeemedAt: redemption.redeemedAt,
        redeemedBy: redemption.redeemedByUserId
          ? (byId.get(redemption.redeemedByUserId)?.name ??
            byId.get(redemption.redeemedByUserId)?.email ??
            null)
          : null,
        /*
          Only the tail of the key id. It is not a secret — the key is spent —
          but printing it whole invites someone to treat it as one, and the
          last few characters are enough to reconcile against a WorkHub record.
        */
        reference: redemption.jti.slice(-8),
      })),
      totalPurchased: balanceRow?.totalPurchased ?? 0,
      balance: balanceRow?.balance ?? 0,
      isAdmin: membership.role === OrganizationRole.ORG_ADMIN,
    };
  }),

  /**
   * The org's AI connection status.
   *
   * Never returns the key itself, only whether one is set and its last four
   * characters — enough for an admin to tell which credential is installed
   * without the value being readable from the browser, a support screenshot, or
   * the response cache. To change it you overwrite it; there is no "reveal".
   */
  getAiConnection: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await actingOrg(ctx.user.id);

    if (!membership?.organizationId) {
      return { configured: false, hint: null, isAdmin: false, endpointReady: false };
    }

    const organization = await prisma.organization.findUnique({
      where: { id: membership.organizationId },
      select: { workhubAiApiKey: true },
    });

    const key = (organization?.workhubAiApiKey ?? '').trim();

    return {
      configured: key.length > 0,
      hint: key ? key.slice(-4) : null,
      isAdmin: membership.role === OrganizationRole.ORG_ADMIN,
      // The platform URL is still deployment config; surfaced so an admin can
      // tell "I haven't added a key" apart from "this server can't reach AI".
      endpointReady: isAiBridgeBaseConfigured(),
    };
  }),

  /** Install or clear this organization's AI key. Admin only. */
  setAiConnection: authenticatedProcedure
    .input(z.object({ key: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await actingOrg(ctx.user.id);

      if (!membership?.organizationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'AI is configured per organization; you are not in one.',
        });
      }

      if (membership.role !== OrganizationRole.ORG_ADMIN) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message: 'Only an organization admin can change the AI connection.',
        });
      }

      const key = input.key?.trim() || null;

      // Cheap shape check so a mistyped or wrong-system credential fails here
      // rather than as a confusing 401 the first time someone opens Aubrey.
      if (key !== null && !key.startsWith('whk_')) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'That does not look like a WorkHub API key — they begin with "whk_".',
        });
      }

      await prisma.organization.update({
        where: { id: membership.organizationId },
        data: { workhubAiApiKey: key },
      });

      return { configured: key !== null, hint: key ? key.slice(-4) : null };
    }),

  /**
   * Actually call the AI service and report what came back.
   *
   * A saved key is not a working key. The first version of the connection card
   * showed "Connected" the moment a string was stored, and the very first key
   * installed turned out to be missing its `ai.invoke` scope — so the card read
   * green while every AI feature returned 403. This is the only honest way to
   * answer the question, because the failure is server-side and per-key.
   *
   * Costs a handful of provider tokens and no HubSign credit: it never touches
   * the Aubrey credit path.
   */
  testAiConnection: authenticatedProcedure.mutation(async ({ ctx }) => {
    const membership = await actingOrg(ctx.user.id);

    if (membership?.role !== OrganizationRole.ORG_ADMIN) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only an organization admin can test the AI connection.',
      });
    }

    const apiKey = await resolveAiApiKey(membership.organizationId);
    if (!apiKey) {
      return { ok: false, code: 'not_configured', detail: 'No AI key is saved for this organization.' };
    }

    try {
      await callAiBridge({
        apiKey,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        maxTokens: 16,
        timeoutMs: 20_000,
      });

      return { ok: true, code: null, detail: null };
    } catch (err) {
      if (err instanceof AiBridgeError) {
        // `detail` is WorkHub's own machine-readable explanation (e.g. "api key
        // is missing the 'ai.invoke' scope"). Shown here — and only here —
        // because the reader is an admin who asked, and it is the difference
        // between "call WorkHub" and "check my typing". It names no vendor and
        // carries no secret.
        return { ok: false, code: err.code, detail: err.detail };
      }
      throw err;
    }
  }),

  redeemCredits: authenticatedProcedure
    .input(z.object({ key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const membership = await actingOrg(ctx.user.id);
      if (!membership?.organizationId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'AI credits are redeemed for an organization; you are not in one.',
        });
      }
      try {
        const { grant, balance, applied } = await redeemAiCredits({
          key: input.key,
          userId: ctx.user.id,
          organizationId: membership.organizationId,
        });
        return { credits: grant.credits, balance, applied };
      } catch (err) {
        if (err instanceof AiCreditRedeemError) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: err.message });
        }
        throw err;
      }
    }),
});
