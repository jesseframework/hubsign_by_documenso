import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { normalizeMetadataKey } from '@documenso/lib/universal/metadata';
import { MAX_METADATA_IMPORT_ROWS } from '@documenso/lib/universal/metadata-import';
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

  /**
   * Create/update many records at once, from a spreadsheet import.
   *
   * Upserts on (org, category, key) exactly like `upsert`, so re-importing a
   * corrected sheet updates rows in place instead of duplicating them.
   *
   * Partial success is deliberate: one bad email in row 47 reports itself and
   * the other 199 rows still land. Rejecting the whole file would make the user
   * hunt for the offending row with no clue where it is.
   */
  bulkUpsert: authenticatedProcedure
    .input(
      z.object({
        records: z
          .array(
            z.object({
              category: z.string().min(1).max(100),
              label: z.string().min(1).max(300),
              email: z.string().max(320).nullable().optional(),
              data: z.record(z.unknown()).optional(),
              /** Source row number, echoed back so errors can name the line. */
              row: z.number().int().positive().optional(),
            }),
          )
          .min(1)
          .max(MAX_METADATA_IMPORT_ROWS),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);

      const errors: { row?: number; label: string; message: string }[] = [];

      // A sheet can repeat the same vendor; later rows win, matching how the
      // file reads top to bottom.
      const pending = new Map<
        string,
        { category: string; key: string; label: string; email: string | null; data?: object; row?: number }
      >();

      for (const record of input.records) {
        const category = record.category.trim().toLowerCase();
        const key = normalizeMetadataKey(record.label);

        if (!key) {
          errors.push({ row: record.row, label: record.label, message: 'Name is required.' });
          continue;
        }

        const email = record.email?.trim() || null;

        if (email && !z.string().email().safeParse(email).success) {
          errors.push({ row: record.row, label: record.label, message: `Invalid email "${email}".` });
          continue;
        }

        pending.set(`${category}::${key}`, {
          category,
          key,
          label: record.label.trim(),
          email,
          data: record.data,
          row: record.row,
        });
      }

      // One read to classify created-vs-updated, instead of a lookup per row.
      const existing = await prisma.metadataRecord.findMany({
        where: { organizationId: membership.organizationId },
        select: { category: true, key: true },
      });
      const existingKeys = new Set(existing.map((e) => `${e.category}::${e.key}`));

      let created = 0;
      let updated = 0;

      for (const [mapKey, record] of pending) {
        try {
          await prisma.metadataRecord.upsert({
            where: {
              organizationId_category_key: {
                organizationId: membership.organizationId,
                category: record.category,
                key: record.key,
              },
            },
            create: {
              organizationId: membership.organizationId,
              category: record.category,
              key: record.key,
              label: record.label,
              email: record.email,
              data: (record.data ?? undefined) as Prisma.InputJsonValue | undefined,
            },
            update: {
              label: record.label,
              email: record.email,
              data: (record.data ?? undefined) as Prisma.InputJsonValue | undefined,
            },
          });

          if (existingKeys.has(mapKey)) {
            updated += 1;
          } else {
            created += 1;
          }
        } catch (err) {
          errors.push({
            row: record.row,
            label: record.label,
            message: err instanceof Error ? err.message : 'Could not save this row.',
          });
        }
      }

      return { created, updated, errors, received: input.records.length };
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
