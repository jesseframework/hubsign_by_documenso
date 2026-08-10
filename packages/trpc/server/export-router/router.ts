import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { buildCatalogue, getDataset, getJoin, listDatasets } from '@documenso/lib/server-only/export/registry';
import { ZExportConfigSchema, findDuplicateColumns } from '@documenso/lib/types/export';
import { prisma } from '@documenso/prisma';

import { requireOrgMember } from '../lib/require-org-member';
import { authenticatedProcedure, router } from '../trpc';

/**
 * The export builder's backend: what columns exist, and the saved layouts.
 *
 * The file itself is NOT produced here — tRPC serialises through SuperJSON, so
 * a workbook returned this way would be base64'd into a JSON envelope. The
 * bytes come from the `/api/export` resource route instead.
 */

const assertValidConfig = (config: z.infer<typeof ZExportConfigSchema>) => {
  if (!getDataset(config.datasetId)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `Unknown dataset: ${config.datasetId}` });
  }

  const { duplicateKeys, duplicateLabels } = findDuplicateColumns(config.columns);

  if (duplicateKeys.length > 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `The same field was added more than once: ${duplicateKeys.join(', ')}`,
    });
  }

  if (duplicateLabels.length > 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Two columns share the heading "${duplicateLabels[0]}". Rename one so the spreadsheet can be read.`,
    });
  }

  const aliases = config.joins.map((join) => join.alias.toLowerCase());
  if (new Set(aliases).size !== aliases.length) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Each attached table needs a distinct name.' });
  }
};

export const exportRouter = router({
  /** Every grid that can be exported. */
  datasets: authenticatedProcedure.query(async ({ ctx }) => {
    await requireOrgMember(ctx.user.id);
    return listDatasets();
  }),

  /** Columns, filters and available joins for one dataset, for this org. */
  catalogue: authenticatedProcedure
    .input(z.object({ datasetId: z.string() }))
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const dataset = getDataset(input.datasetId);

      if (!dataset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Unknown dataset: ${input.datasetId}` });
      }

      return buildCatalogue(dataset, membership.organizationId);
    }),

  /**
   * Columns a reference table would contribute, resolved against this org's
   * actual directory. Fetched only when the user attaches the table, because it
   * costs a query and a match over the whole directory.
   */
  joinColumns: authenticatedProcedure
    .input(
      z.object({
        datasetId: z.string(),
        joinId: z.string(),
        options: z.record(z.string(), z.string()).default({}),
      }),
    )
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      const dataset = getDataset(input.datasetId);

      if (!dataset) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Unknown dataset: ${input.datasetId}` });
      }

      const join = getJoin(dataset, input.joinId);
      if (!join) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `Unknown reference table: ${input.joinId}` });
      }

      // No rows are passed: we only want the column list, and preparing against
      // an empty set still discovers the directory's own keys without matching
      // anything.
      const prepared = await join.prepare({
        organizationId: membership.organizationId,
        rows: [],
        options: input.options,
      });

      return { columns: prepared.columns, notes: prepared.notes };
    }),

  /** Saved layouts for this organization. */
  templates: authenticatedProcedure
    .input(z.object({ datasetId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);

      return prisma.exportTemplate.findMany({
        where: {
          organizationId: membership.organizationId,
          ...(input?.datasetId ? { datasetId: input.datasetId } : {}),
        },
        orderBy: [{ datasetId: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          datasetId: true,
          name: true,
          description: true,
          config: true,
          createdAt: true,
          updatedAt: true,
          createdBy: { select: { name: true, email: true } },
        },
      });
    }),

  saveTemplate: authenticatedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string().trim().min(1).max(80),
        description: z.string().trim().max(300).optional(),
        config: ZExportConfigSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);
      assertValidConfig(input.config);

      if (input.id) {
        // Scoped update: without the organizationId in the filter this would
        // happily rewrite another tenant's template by id.
        const existing = await prisma.exportTemplate.findFirst({
          where: { id: input.id, organizationId: membership.organizationId },
          select: { id: true },
        });

        if (!existing) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Export template not found.' });
        }

        return prisma.exportTemplate.update({
          where: { id: existing.id },
          data: {
            name: input.name,
            description: input.description ?? null,
            datasetId: input.config.datasetId,
            config: input.config as never,
          },
          select: { id: true, name: true },
        });
      }

      return prisma.exportTemplate.create({
        data: {
          organizationId: membership.organizationId,
          datasetId: input.config.datasetId,
          name: input.name,
          description: input.description ?? null,
          config: input.config as never,
          createdById: ctx.user.id,
        },
        select: { id: true, name: true },
      });
    }),

  deleteTemplate: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgMember(ctx.user.id);

      const { count } = await prisma.exportTemplate.deleteMany({
        where: { id: input.id, organizationId: membership.organizationId },
      });

      if (count === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Export template not found.' });
      }

      return { success: true };
    }),
});
