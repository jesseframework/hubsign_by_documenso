import { TRPCError } from '@trpc/server';
import { z } from 'zod';

import { bmsMlGetTemplates } from '@documenso/lib/server-only/bms-ml/client';
import { normalizeMetadataKey } from '@documenso/lib/universal/metadata';
import {
  METADATA_FIELD_TYPES,
  type MetadataFieldDefinitionLike,
  coerceMetadataFieldValue,
  coerceMetadataFieldValues,
  deriveMetadataFieldKey,
  isReservedMetadataFieldKey,
} from '@documenso/lib/universal/metadata-fields';
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
 * The org's custom field definitions for one or more categories.
 *
 * Read on every write so a value is validated against what the field promises.
 * Coercion is applied here rather than trusted from the client because `data`
 * accepts arbitrary keys by design — the public API and a stale browser tab both
 * reach this code, and a NUMBER field holding the text "abt 400" would fail much
 * later, in whatever read it.
 */
const definitionsByCategory = async (
  organizationId: number,
  categories: string[],
): Promise<Map<string, MetadataFieldDefinitionLike[]>> => {
  const rows = await prisma.metadataFieldDefinition.findMany({
    where: { organizationId, category: { in: [...new Set(categories)] } },
    orderBy: [{ order: 'asc' }, { label: 'asc' }],
  });

  const byCategory = new Map<string, MetadataFieldDefinitionLike[]>();

  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push({
      key: row.key,
      label: row.label,
      type: row.type,
      options: row.options,
      helpText: row.helpText,
      required: row.required,
    });
    byCategory.set(row.category, list);
  }

  return byCategory;
};

/**
 * Validate one record's custom values, or refuse the save naming every problem.
 *
 * All of them at once rather than the first: a form with four custom fields
 * should not be fixed one round-trip at a time.
 */
const checkCustomFields = async (
  organizationId: number,
  category: string,
  data: Record<string, unknown> | undefined,
): Promise<Record<string, unknown> | undefined> => {
  const normalizedCategory = category.trim().toLowerCase();
  const definitions =
    (await definitionsByCategory(organizationId, [normalizedCategory])).get(normalizedCategory) ??
    [];

  if (definitions.length === 0) {
    return data;
  }

  const result = coerceMetadataFieldValues(definitions, data ?? {});

  if (result.errors.length > 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: result.errors.join(' ') });
  }

  return Object.keys(result.data).length > 0 ? result.data : undefined;
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

  /** The org's custom field definitions, every category, in display order. */
  listFields: authenticatedProcedure.query(async ({ ctx }) => {
    const membership = await requireOrgMember(ctx.user.id);
    return prisma.metadataFieldDefinition.findMany({
      where: { organizationId: membership.organizationId },
      orderBy: [{ category: 'asc' }, { order: 'asc' }, { label: 'asc' }],
    });
  }),

  /**
   * Define a custom field, or edit one.
   *
   * The storage key is derived from the label on creation and then frozen: it is
   * what workflow templates reference as `{{vars.vendor.<key>}}` and what every
   * saved record's value is filed under, so re-deriving it on a rename would
   * orphan the data and break the templates in the same move. Renaming the label
   * is therefore always safe, which is the behaviour people expect.
   */
  upsertField: authenticatedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        category: z.string().min(1).max(100),
        label: z.string().min(1).max(120),
        type: z.enum(METADATA_FIELD_TYPES),
        options: z.array(z.string().min(1).max(120)).max(50).optional(),
        helpText: z.string().max(300).nullable().optional(),
        required: z.boolean().optional(),
        order: z.number().int().min(0).max(999).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const category = input.category.trim().toLowerCase();
      const label = input.label.trim();

      // Deduped and trimmed here so the coercion's "must be one of" message and
      // the dropdown can never list a blank or a repeat.
      const options =
        input.type === 'SELECT'
          ? [...new Set((input.options ?? []).map((option) => option.trim()).filter(Boolean))]
          : [];

      if (input.type === 'SELECT' && options.length === 0) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A dropdown needs at least one option.',
        });
      }

      const common = {
        label,
        type: input.type,
        options,
        helpText: input.helpText?.trim() || null,
        required: input.required ?? false,
        order: input.order ?? 0,
      };

      if (input.id) {
        const existing = await prisma.metadataFieldDefinition.findFirst({
          where: { id: input.id, organizationId: membership.organizationId },
          select: { id: true },
        });

        if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found.' });

        return prisma.metadataFieldDefinition.update({
          where: { id: existing.id },
          // Category and key are both left alone: moving a field to another
          // category would strand its values on records that no longer show it.
          data: common,
        });
      }

      const key = deriveMetadataFieldKey(label);

      if (!key) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Give the field a name using letters or numbers.',
        });
      }

      if (isReservedMetadataFieldKey(key)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `"${label}" is a built-in field on this record — pick another name.`,
        });
      }

      const clash = await prisma.metadataFieldDefinition.findUnique({
        where: {
          organizationId_category_key: {
            organizationId: membership.organizationId,
            category,
            key,
          },
        },
        select: { label: true },
      });

      if (clash) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `"${clash.label}" already covers that name in ${category}.`,
        });
      }

      return prisma.metadataFieldDefinition.create({
        data: { organizationId: membership.organizationId, category, key, ...common },
      });
    }),

  /**
   * Remove a field definition.
   *
   * Values already saved on records are left in place. They stop being shown and
   * stop being validated, but a workflow template still reading the key keeps
   * resolving — and re-adding a field with the same name brings the old values
   * back into view rather than finding every record blank.
   */
  deleteField: authenticatedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const membership = await requireOrgWriteAccess(ctx.user.id);
      const field = await prisma.metadataFieldDefinition.findFirst({
        where: { id: input.id, organizationId: membership.organizationId },
        select: { id: true },
      });

      if (!field) throw new TRPCError({ code: 'NOT_FOUND', message: 'Field not found.' });

      await prisma.metadataFieldDefinition.delete({ where: { id: field.id } });
      return { success: true };
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

      const data = await checkCustomFields(membership.organizationId, input.category, input.data);

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
          data: (data ?? undefined) as Prisma.InputJsonValue | undefined,
        },
        update: {
          label: input.label.trim(),
          email: input.email ?? null,
          data: (data ?? undefined) as Prisma.InputJsonValue | undefined,
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
              /**
               * BMS ML extraction template, given by NAME — the API itself
               * takes a numeric id, so it's resolved here against the org's
               * template list.
               */
              ocrTemplate: z.string().max(200).optional(),
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

      // Resolve template names → ids once for the whole file, and only when the
      // file actually references one.
      const templatesByName = new Map<string, { id: number; name: string }>();

      if (input.records.some((record) => record.ocrTemplate?.trim())) {
        const org = await prisma.organization.findUnique({
          where: { id: membership.organizationId },
          select: {
            ocrApiUrl: true,
            ocrApiKey: true,
            ocrApiUsername: true,
            ocrApiPassword: true,
          },
        });

        const templates = org?.ocrApiUrl
          ? await bmsMlGetTemplates({
              apiUrl: org.ocrApiUrl,
              apiKey: org.ocrApiKey,
              apiUsername: org.ocrApiUsername,
              apiPassword: org.ocrApiPassword,
            }).catch(() => [])
          : [];

        for (const template of templates) {
          templatesByName.set(template.name.trim().toLowerCase(), {
            id: template.id,
            name: template.name,
          });
        }
      }

      // Every category the file touches, resolved in one read rather than per row.
      const customFields = await definitionsByCategory(
        membership.organizationId,
        input.records.map((record) => record.category.trim().toLowerCase()),
      );

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

        let data = record.data;
        const templateName = record.ocrTemplate?.trim();

        if (templateName) {
          const template = templatesByName.get(templateName.toLowerCase());

          if (!template) {
            errors.push({
              row: record.row,
              label: record.label,
              message: `Unknown OCR template "${templateName}".`,
            });
            continue;
          }

          data = { ...(data ?? {}), ocrTemplateId: template.id, ocrTemplateName: template.name };
        }

        // Custom values are checked per value and reported per row, in keeping
        // with the rest of this import: one bad number in row 47 costs that one
        // value, not the file and not the row. The row still lands, with the
        // reason named, which is how the sheet gets corrected.
        for (const definition of customFields.get(category) ?? []) {
          if (!data || !(definition.key in data)) {
            continue;
          }

          const coerced = coerceMetadataFieldValue(definition, data[definition.key]);

          if (!coerced.ok) {
            errors.push({ row: record.row, label: record.label, message: coerced.message });
            delete data[definition.key];
            continue;
          }

          if (coerced.value === null) {
            delete data[definition.key];
            continue;
          }

          data[definition.key] = coerced.value;
        }

        const mapKey = `${category}::${key}`;

        // A record's identity is its name, so two rows sharing a name within a
        // category are the same record. Writing both into `pending` silently kept
        // only the last, which is how a 7-row file could report success and leave
        // 5 records — the earlier rows disappeared before any database call, with
        // nothing reported. Now the first row wins and the collision is named, so
        // the file can be corrected.
        const clash = pending.get(mapKey);

        if (clash) {
          errors.push({
            row: record.row,
            label: record.label,
            message:
              `Duplicate name "${record.label.trim()}" in category "${category}"` +
              (clash.row ? ` — already used on row ${clash.row}` : '') +
              '. Names must be unique within a category, so this row was skipped.',
          });
          continue;
        }

        pending.set(mapKey, {
          category,
          key,
          label: record.label.trim(),
          email,
          data,
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

      const data = await checkCustomFields(membership.organizationId, input.category, input.data);

      try {
        return await prisma.metadataRecord.update({
          where: { id: existing.id },
          data: {
            category: input.category,
            key,
            label: input.label.trim(),
            email: input.email ?? null,
            // Empty data clears the extra fields (keywords/role/…).
            data: data ? (data as Prisma.InputJsonValue) : Prisma.DbNull,
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
