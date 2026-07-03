import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { normalizeMetadataKey } from '@documenso/lib/universal/metadata';
import { prisma } from '@documenso/prisma';
import { Prisma } from '@prisma/client';

import { authenticatedProcedure, router } from '../trpc';

const WRITE_ROLES = ['ORG_ADMIN', 'MANAGER'] as const;

const requireOrgMember = async (userId: number) => {
  const membership = await prisma.organizationMember.findFirst({ where: { userId } });
  if (!membership) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'You are not a member of an organization.' });
  }
  return membership;
};

const requireOrgWriteAccess = async (userId: number) => {
  const membership = await prisma.organizationMember.findFirst({
    where: { userId, role: { in: [...WRITE_ROLES] } },
  });
  if (!membership) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Only organization admins or managers can manage metadata.',
    });
  }
  return membership;
};

/**
 * Org-scoped lookup directory (e.g. vendor name → email) used by the
 * LOOKUP_METADATA workflow action.
 */
export const metadataRouter = router({
  /** List records, optionally filtered by category. */
  list: authenticatedProcedure
    .input(z.object({ category: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      return prisma.metadataRecord.findMany({
        where: { organizationId: membership.organizationId, category: input?.category },
        orderBy: [{ category: 'asc' }, { label: 'asc' }],
      });
    }),

  /** Create or update a record (unique per org + category + normalized key). */
  upsert: authenticatedProcedure
    .input(
      z.object({
        category: z.string().min(1).max(100).default('vendor'),
        label: z.string().min(1).max(300),
        email: z.string().email().nullable().optional(),
        data: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const key = normalizeMetadataKey(input.label);
      if (!key) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Label is required.' });

      return prisma.metadataRecord.upsert({
        where: {
          organizationId_category_key: {
            organizationId: membership.organizationId,
            category: input.category,
            key,
          },
        },
        create: {
          organizationId: membership.organizationId,
          category: input.category,
          key,
          label: input.label.trim(),
          email: input.email ?? null,
          data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        update: {
          label: input.label.trim(),
          email: input.email ?? null,
          data: (input.data ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    }),

  /** Update an existing record by id (handles renaming — re-derives the key). */
  update: authenticatedProcedure
    .input(
      z.object({
        id: z.string(),
        category: z.string().min(1).max(100),
        label: z.string().min(1).max(300),
        email: z.string().email().nullable().optional(),
        data: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const existing = await prisma.metadataRecord.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
        select: { id: true },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found.' });

      const key = normalizeMetadataKey(input.label);
      if (!key) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Label is required.' });

      try {
        return await prisma.metadataRecord.update({
          where: { id: existing.id },
          data: {
            category: input.category,
            key,
            label: input.label.trim(),
            email: input.email ?? null,
            // Empty data clears the extra fields (keywords/role/…).
            data: input.data ? (input.data as Prisma.InputJsonValue) : Prisma.DbNull,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new TRPCError({
            code: 'CONFLICT',
            message: 'Another record with that name already exists in this category.',
          });
        }
        throw err;
      }
    }),

  delete: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const record = await prisma.metadataRecord.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
        select: { id: true },
      });
      if (!record) throw new TRPCError({ code: 'NOT_FOUND', message: 'Record not found.' });
      await prisma.metadataRecord.delete({ where: { id: record.id } });
      return { success: true };
    }),
});
