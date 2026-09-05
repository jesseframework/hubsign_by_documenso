import { DocumentDataType, StampKind } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { createDocumentData } from '@documenso/lib/server-only/document-data/create-document-data';
import {
  generateStampFromPrompt,
  isAiStampGenerationConfigured,
} from '@documenso/lib/server-only/stamps/ai-generate-stamp';
import { env } from '@documenso/lib/utils/env';
import { prisma } from '@documenso/prisma';

import { authenticatedProcedure, router } from '../trpc';

/**
 * Dev/QA bypass: when set to "true", any organization can use stamps
 * regardless of billing status. Defaults to false. Never set this in
 * production — it disables the paid-feature gate.
 */
const isDevBypassActive = () => env('NEXT_PRIVATE_STAMPS_FORCE_ENABLED') === 'true';

/**
 * Resolve the user's active organization. Stamps are an org-scoped feature —
 * if the user isn't a member of any organization, every stamp endpoint
 * surfaces the same FORBIDDEN error code so the UI can show a single
 * "set up an organization to use stamps" message.
 */
const resolveOrganization = async (userId: number) => {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId },
    select: {
      organizationId: true,
      role: true,
      organization: { select: { id: true, billingStatus: true } },
    },
    orderBy: { id: 'asc' },
  });
  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'STAMPS_REQUIRE_ORGANIZATION' });
  }
  return membership;
};

/**
 * Stamps are a paid org feature — gated behind the org's active billing
 * status. The same code is used by the UI to render the upgrade banner.
 *
 * Bypassed entirely when NEXT_PRIVATE_STAMPS_FORCE_ENABLED=true so
 * developers can exercise the feature without a Stripe-active subscription.
 */
const assertOrgPremium = (membership: Awaited<ReturnType<typeof resolveOrganization>>) => {
  if (isDevBypassActive()) return;
  if (membership.organization.billingStatus !== 'active') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'STAMP_REQUIRES_PREMIUM' });
  }
};

const isOrgPremium = (membership: Awaited<ReturnType<typeof resolveOrganization>>) =>
  isDevBypassActive() || membership.organization.billingStatus === 'active';

const ZNothing = z.object({}).optional();

export const stampRouter = router({
  /**
   * Whether the current user can manage stamps. Drives the upgrade-banner
   * vs library decision in the UI without throwing.
   */
  isEnabled: authenticatedProcedure.input(ZNothing).query(async ({ ctx }) => {
    try {
      const membership = await resolveOrganization(ctx.user.id);
      return {
        enabled: isOrgPremium(membership),
        hasOrganization: true,
        organizationId: membership.organizationId,
      };
    } catch {
      return { enabled: false, hasOrganization: false, organizationId: null };
    }
  }),

  list: authenticatedProcedure.input(ZNothing).query(async ({ ctx }) => {
    let membership;
    try {
      membership = await resolveOrganization(ctx.user.id);
    } catch {
      return [];
    }
    if (!isOrgPremium(membership)) return [];

    const stamps = await prisma.stamp.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: { createdAt: 'desc' },
    });

    const assetIds = stamps
      .map((s) => s.imageAssetId)
      .filter((id): id is string => Boolean(id));
    const assets = assetIds.length
      ? await prisma.documentData.findMany({
          where: { id: { in: assetIds } },
          select: { id: true, type: true, data: true },
        })
      : [];
    const assetById = new Map(assets.map((a) => [a.id, a]));

    return stamps.map((s) => ({
      ...s,
      previewAsset: s.imageAssetId ? (assetById.get(s.imageAssetId) ?? null) : null,
    }));
  }),

  /** Whether AI stamp generation is set up for the caller's organization. */
  aiAvailable: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await resolveOrganization(ctx.user.id);

    return { available: await isAiStampGenerationConfigured(membership.organizationId) };
  }),

  /**
   * Generate a stamp from a natural-language prompt. The model returns SVG;
   * we rasterize to PNG and store via the same pipeline as UPLOADED stamps
   * so the PDF embed path is unchanged. The original prompt is kept in
   * `placeholders[0]` for provenance.
   */
  generateFromPrompt: authenticatedProcedure
    .input(
      z.object({
        prompt: z.string().trim().min(5).max(800),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await resolveOrganization(ctx.user.id);
      assertOrgPremium(membership);

      const org = await prisma.organization.findUnique({
        where: { id: membership.organizationId },
        select: { name: true, brandingPrimaryColor: true },
      });

      const result = await generateStampFromPrompt({
        organizationId: membership.organizationId,
        prompt: input.prompt,
        organizationName: org?.name,
        primaryColor: org?.brandingPrimaryColor ?? undefined,
      });

      // Persist the rasterized PNG via DocumentData so the existing
      // UPLOADED-stamp embed path handles it.
      const data = await createDocumentData({
        type: 'BYTES_64',
        data: result.png.toString('base64'),
      });

      return prisma.stamp.create({
        data: {
          name: result.name,
          kind: 'AI_GENERATED',
          imageAssetId: data.id,
          previewImage: data.id,
          // Stash the prompt in the placeholder array — keeps it visible in
          // the admin/audit UI without a schema change. Slice 2 will move
          // this into a proper metadata column when we add layout JSON.
          placeholders: [`prompt:${input.prompt}`],
          organizationId: membership.organizationId,
        },
      });
    }),

  createUploaded: authenticatedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        fileType: z.nativeEnum(DocumentDataType),
        fileData: z.string().min(1),
        placeholders: z.array(z.string()).max(8).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await resolveOrganization(ctx.user.id);
      assertOrgPremium(membership);

      const data = await createDocumentData({ type: input.fileType, data: input.fileData });

      return prisma.stamp.create({
        data: {
          name: input.name,
          kind: StampKind.UPLOADED,
          imageAssetId: data.id,
          previewImage: data.id,
          placeholders: input.placeholders ?? [],
          organizationId: membership.organizationId,
        },
      });
    }),

  delete: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await resolveOrganization(ctx.user.id);

      const stamp = await prisma.stamp.findUnique({ where: { id: input.id } });
      if (!stamp || stamp.organizationId !== membership.organizationId) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }

      await prisma.$transaction(async (tx) => {
        await tx.stamp.delete({ where: { id: stamp.id } });
        if (stamp.imageAssetId) {
          await tx.documentData
            .delete({ where: { id: stamp.imageAssetId } })
            .catch(() => undefined);
        }
      });

      return { ok: true };
    }),

  rename: authenticatedProcedure
    .input(z.object({ id: z.string(), name: z.string().trim().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      const membership = await resolveOrganization(ctx.user.id);
      const stamp = await prisma.stamp.findUnique({ where: { id: input.id } });
      if (!stamp || stamp.organizationId !== membership.organizationId) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      return prisma.stamp.update({ where: { id: stamp.id }, data: { name: input.name } });
    }),

  // -- Placements ---------------------------------------------------------

  listPlacements: authenticatedProcedure
    .input(z.object({ documentId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      await assertDocumentOwnership(ctx.user.id, input.documentId);

      const placements = await prisma.documentStampPlacement.findMany({
        where: { documentId: input.documentId },
        include: { stamp: true },
        orderBy: { createdAt: 'asc' },
      });

      const assetIds = placements
        .map((p) => p.stamp.imageAssetId)
        .filter((id): id is string => Boolean(id));
      const assets = assetIds.length
        ? await prisma.documentData.findMany({
            where: { id: { in: assetIds } },
            select: { id: true, type: true, data: true },
          })
        : [];
      const assetById = new Map(assets.map((a) => [a.id, a]));

      return placements.map((p) => ({
        ...p,
        stamp: {
          ...p.stamp,
          previewAsset: p.stamp.imageAssetId
            ? (assetById.get(p.stamp.imageAssetId) ?? null)
            : null,
        },
      }));
    }),

  createPlacement: authenticatedProcedure
    .input(
      z.object({
        documentId: z.number().int().positive(),
        stampId: z.string(),
        pageIndex: z.number().int().min(0),
        x: z.number(),
        y: z.number(),
        width: z.number().positive(),
        height: z.number().positive(),
        rotation: z.number().optional(),
        opacity: z.number().min(0).max(1).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertDocumentOwnership(ctx.user.id, input.documentId);
      const membership = await resolveOrganization(ctx.user.id);

      const stamp = await prisma.stamp.findUnique({ where: { id: input.stampId } });
      if (!stamp || stamp.organizationId !== membership.organizationId) {
        throw new TRPCError({ code: 'FORBIDDEN' });
      }

      return prisma.documentStampPlacement.create({
        data: {
          documentId: input.documentId,
          stampId: input.stampId,
          pageIndex: input.pageIndex,
          x: input.x,
          y: input.y,
          width: input.width,
          height: input.height,
          rotation: input.rotation,
          opacity: input.opacity,
        },
      });
    }),

  updatePlacement: authenticatedProcedure
    .input(
      z.object({
        id: z.string(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        rotation: z.number().nullable().optional(),
        opacity: z.number().min(0).max(1).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const placement = await prisma.documentStampPlacement.findUnique({
        where: { id: input.id },
      });
      if (!placement) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertDocumentOwnership(ctx.user.id, placement.documentId);

      const { id, ...rest } = input;
      return prisma.documentStampPlacement.update({
        where: { id },
        data: rest,
      });
    }),

  deletePlacement: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const placement = await prisma.documentStampPlacement.findUnique({
        where: { id: input.id },
      });
      if (!placement) throw new TRPCError({ code: 'NOT_FOUND' });
      await assertDocumentOwnership(ctx.user.id, placement.documentId);
      await prisma.documentStampPlacement.delete({ where: { id: placement.id } });
      return { ok: true };
    }),
});

/**
 * Verify the caller is the document owner (or a member of the team that
 * owns the document). Throws FORBIDDEN otherwise.
 */
async function assertDocumentOwnership(userId: number, documentId: number) {
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    select: { userId: true, teamId: true },
  });
  if (!doc) throw new TRPCError({ code: 'NOT_FOUND' });
  if (doc.userId === userId) return;
  if (doc.teamId) {
    const member = await prisma.teamMember.findFirst({
      where: { userId, teamId: doc.teamId },
      select: { id: true },
    });
    if (member) return;
  }
  throw new TRPCError({ code: 'FORBIDDEN' });
}
