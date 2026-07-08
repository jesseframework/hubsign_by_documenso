import { TRPCError } from '@trpc/server';
import type { OrganizationRole } from '@prisma/client';

import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { isMsTeamsBotConfigured } from '@documenso/lib/constants/ms-teams';
import { postToChannel } from '@documenso/lib/server-only/ms-teams/deliver';
import {
  MsTeamsWebhookUrlError,
  assertSafeWebhookUrl,
  maskWebhookUrl,
} from '@documenso/lib/server-only/ms-teams/webhook-url';
import { isValidCron } from '@documenso/lib/server-only/workflow/cron';
import { renderMilestoneCard } from '@documenso/lib/universal/ms-teams/cards';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure, router } from '../trpc';
import {
  ZMsTeamsAddWebhookChannelSchema,
  ZMsTeamsChannelIdSchema,
  ZMsTeamsConnectSchema,
  ZMsTeamsListDeliveriesSchema,
  ZMsTeamsSetEnabledSchema,
  ZMsTeamsUpdateChannelSchema,
} from './schema';

// ─── Org access ──────────────────────────────────────────────────────────────

const WRITE_ROLES: OrganizationRole[] = ['ORG_ADMIN', 'MANAGER'];

/**
 * Resolve the caller's organization membership, then check the role on THAT SAME
 * membership.
 *
 * The other org-scoped routers (workflow, metadata) run two independent
 * `findFirst` queries — one filtered by userId, one filtered by userId + role —
 * which for a user belonging to several organizations can resolve to two
 * DIFFERENT orgs within one request. Resolving once and checking the role
 * afterwards cannot drift that way.
 */
const requireOrg = async (userId: number, { write = false }: { write?: boolean } = {}) => {
  const membership = await prisma.organizationMember.findFirst({ where: { userId } });

  if (!membership) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'You are not a member of an organization.',
    });
  }

  if (write && !WRITE_ROLES.includes(membership.role)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only organization admins or managers can manage the Microsoft Teams connection.',
    });
  }

  return membership;
};

/**
 * Fetch a channel link only if it belongs to the caller's organization.
 *
 * Every mutation addresses a channel by its opaque id, so without this filter a
 * member of org A could edit or delete a channel belonging to org B by guessing
 * an id. The `connection: { organizationId }` clause is the org boundary.
 */
const requireChannelInOrg = async (channelId: string, organizationId: number) => {
  const channel = await prisma.msTeamsChannelLink.findFirst({
    where: { id: channelId, connection: { organizationId } },
    include: { connection: true },
  });

  if (!channel) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Teams channel not found.' });
  }

  return channel;
};

const requireConnection = async (organizationId: number) => {
  const connection = await prisma.msTeamsConnection.findUnique({ where: { organizationId } });

  if (!connection) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Connect Microsoft Teams first.',
    });
  }

  return connection;
};

const validateWebhookUrl = (raw: string): string => {
  try {
    assertSafeWebhookUrl(raw);
  } catch (err) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: err instanceof MsTeamsWebhookUrlError ? err.message : 'Invalid webhook URL.',
    });
  }

  return raw;
};

const validateDigest = (digest: boolean, cron: string | null | undefined) => {
  if (!digest) {
    return;
  }

  if (!cron || !isValidCron(cron)) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'A digest needs a valid 5-field cron expression, e.g. "0 9 * * 1-5".',
    });
  }
};

// ─── Router ──────────────────────────────────────────────────────────────────

/**
 * Microsoft Teams integration, scoped to one connection per organization
 * (enforced by MsTeamsConnection.organizationId @unique).
 *
 * `webhookUrl` is a bearer credential — whoever holds a Power Automate flow URL
 * can post into that channel — so it is masked on every read path and never
 * returned to the client.
 */
export const msTeamsRouter = router({
  /** The org's connection, its channels, and whether the bot transport is even available. */
  getConnection: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await requireOrg(ctx.user.id);

    const connection = await prisma.msTeamsConnection.findUnique({
      where: { organizationId: membership.organizationId },
      include: { channels: { orderBy: { createdAt: 'asc' } } },
    });

    return {
      botConfigured: isMsTeamsBotConfigured(),
      canManage: WRITE_ROLES.includes(membership.role),
      connection: connection && {
        ...connection,
        channels: connection.channels.map(({ webhookUrl, ...channel }) => ({
          ...channel,
          // Never the raw URL — only enough to tell two channels apart.
          webhookUrlHint: webhookUrl ? maskWebhookUrl(webhookUrl) : null,
        })),
      },
    };
  }),

  /** Create (or switch the transport of) this organization's connection. */
  connect: authenticatedProcedure
    .input(ZMsTeamsConnectSchema)
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrg(ctx.user.id, { write: true });

      if (input.transport === 'BOT' && !isMsTeamsBotConfigured()) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'The Teams bot is not configured on this deployment. Set NEXT_PRIVATE_MS_TEAMS_BOT_APP_ID and NEXT_PRIVATE_MS_TEAMS_BOT_APP_PASSWORD, or use the webhook transport.',
        });
      }

      return prisma.msTeamsConnection.upsert({
        where: { organizationId: membership.organizationId },
        create: { organizationId: membership.organizationId, transport: input.transport },
        update: { transport: input.transport },
      });
    }),

  /** Pause or resume all delivery for the organization without losing configuration. */
  setEnabled: authenticatedProcedure
    .input(ZMsTeamsSetEnabledSchema)
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrg(ctx.user.id, { write: true });
      await requireConnection(membership.organizationId);

      return prisma.msTeamsConnection.update({
        where: { organizationId: membership.organizationId },
        data: { enabled: input.enabled },
      });
    }),

  /** Remove the connection; channels, card refs and delivery history cascade. */
  disconnect: authenticatedProcedure.mutation(async ({ ctx }) => {
    const membership = await requireOrg(ctx.user.id, { write: true });
    await requireConnection(membership.organizationId);

    await prisma.msTeamsConnection.delete({
      where: { organizationId: membership.organizationId },
    });

    return { success: true };
  }),

  /**
   * Attach a webhook destination.
   *
   * BOT channels are never created here — they come from the in-Teams linking
   * flow, which is the only place a trustworthy conversationId/serviceUrl exists.
   */
  addWebhookChannel: authenticatedProcedure
    .input(ZMsTeamsAddWebhookChannelSchema)
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrg(ctx.user.id, { write: true });
      const connection = await requireConnection(membership.organizationId);

      validateWebhookUrl(input.webhookUrl);
      validateDigest(input.digest, input.digestCron);

      const channel = await prisma.msTeamsChannelLink.create({
        data: {
          connectionId: connection.id,
          name: input.name,
          webhookUrl: input.webhookUrl,
          events: input.events,
          digest: input.digest,
          digestCron: input.digest ? input.digestCron : null,
          digestTimezone: input.digestTimezone,
          // A webhook card can never be edited in place, so a tracker is
          // meaningless here regardless of what the client asks for.
          tracker: false,
        },
      });

      const { webhookUrl, ...safe } = channel;

      return { ...safe, webhookUrlHint: maskWebhookUrl(webhookUrl ?? '') };
    }),

  updateChannel: authenticatedProcedure
    .input(ZMsTeamsUpdateChannelSchema)
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrg(ctx.user.id, { write: true });
      const existing = await requireChannelInOrg(input.id, membership.organizationId);

      if (input.webhookUrl !== undefined) {
        validateWebhookUrl(input.webhookUrl);
      }

      const digest = input.digest ?? existing.digest;
      const digestCron = input.digestCron === undefined ? existing.digestCron : input.digestCron;

      validateDigest(digest, digestCron);

      // Only the BOT transport can rewrite a posted card.
      const tracker =
        existing.connection.transport === 'BOT' ? (input.tracker ?? existing.tracker) : false;

      if (input.tracker && existing.connection.transport !== 'BOT') {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message:
            'A live tracker needs the bot transport — a webhook-posted card cannot be updated.',
        });
      }

      const updated = await prisma.msTeamsChannelLink.update({
        where: { id: existing.id },
        data: {
          name: input.name,
          webhookUrl: input.webhookUrl,
          events: input.events,
          enabled: input.enabled,
          tracker,
          digest,
          digestCron: digest ? digestCron : null,
          digestTimezone: input.digestTimezone,
        },
      });

      const { webhookUrl, ...safe } = updated;

      return { ...safe, webhookUrlHint: webhookUrl ? maskWebhookUrl(webhookUrl) : null };
    }),

  deleteChannel: authenticatedProcedure
    .input(ZMsTeamsChannelIdSchema)
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrg(ctx.user.id, { write: true });
      const channel = await requireChannelInOrg(input.id, membership.organizationId);

      await prisma.msTeamsChannelLink.delete({ where: { id: channel.id } });

      return { success: true };
    }),

  /**
   * Post a sample card so an admin can confirm the plumbing before relying on it.
   * Writes an MsTeamsDelivery row like any other send, so a failure is inspectable.
   */
  testChannel: authenticatedProcedure
    .input(ZMsTeamsChannelIdSchema)
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrg(ctx.user.id, { write: true });
      const channel = await requireChannelInOrg(input.id, membership.organizationId);

      const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: membership.organizationId },
        select: { name: true },
      });

      const message = renderMilestoneCard({
        event: 'DOCUMENT_COMPLETED',
        document: {
          id: 0,
          title: 'Test card from HubSign',
          status: 'COMPLETED',
          recipients: [
            { email: 'ada@example.com', name: 'Ada Lovelace', role: 'SIGNER', signedAt: new Date() },
            { email: 'grace@example.com', name: 'Grace Hopper', role: 'SIGNER', signedAt: new Date() },
          ],
        },
        organizationName: organization.name,
        appUrl: NEXT_PUBLIC_WEBAPP_URL(),
        actorName: ctx.user.name ?? ctx.user.email,
      });

      const result = await postToChannel({
        link: channel,
        connection: channel.connection,
        event: 'TEST',
        message,
      });

      // Surface the failure to the admin rather than reporting a silent success.
      return { ok: result.ok, status: result.status, error: result.error };
    }),

  /** Delivery audit for this organization's channels. */
  listDeliveries: authenticatedProcedure
    .input(ZMsTeamsListDeliveriesSchema)
    .query(async ({ ctx, input }) => {
      const membership = await requireOrg(ctx.user.id);

      if (input.channelId) {
        await requireChannelInOrg(input.channelId, membership.organizationId);
      }

      return prisma.msTeamsDelivery.findMany({
        where: {
          channelLinkId: input.channelId,
          channelLink: { connection: { organizationId: membership.organizationId } },
        },
        orderBy: { createdAt: 'desc' },
        take: input.limit,
        select: {
          id: true,
          event: true,
          status: true,
          transport: true,
          responseCode: true,
          error: true,
          createdAt: true,
          channelLinkId: true,
        },
      });
    }),
});
