import { z } from 'zod';

/**
 * The wire format of a saved export layout.
 *
 * This module is imported by the browser (the builder dialog) as well as the
 * server, so it holds only zod schemas — no Prisma, no exceljs, nothing from
 * `server-only`. The catalogue of columns that these keys refer to lives in
 * `server-only/export/datasets`, because building it needs the database.
 */

/**
 * Excel's own worksheet-name rules: 31 characters, and none of `: \ / ? * [ ]`.
 * Exceeding either makes Excel declare the file corrupt rather than repairing
 * it, so the limit is enforced here instead of at write time.
 */
export const EXPORT_SHEET_NAME_MAX = 31;
const SHEET_NAME_FORBIDDEN = /[:\\/?*[\]]/;

/** Most rows a single export will write. Beyond this the workbook says so. */
export const EXPORT_ROW_LIMIT = 5000;

/** Most columns a single export will write. */
export const EXPORT_COLUMN_LIMIT = 200;

/**
 * A column key is `<source>:<path>`:
 *
 *   field:invoiceNumber        a column the dataset declares
 *   ocr:merchant_name          a raw key found in this org's OCR output
 *   join:vendor.phone          a column pulled through a joined reference table
 *   const:<nanoid>             a fixed value the user typed
 *
 * The prefix is what lets the exporter resolve a saved layout without having to
 * guess, and what keeps a joined `email` from colliding with the dataset's own.
 */
export const ZExportColumnKeySchema = z
  .string()
  .min(3)
  .max(200)
  .regex(/^(field|ocr|join|const):[^\s]+$/u, 'Column key must be prefixed field:, ocr:, join: or const:');

export const ZExportColumnSchema = z.object({
  key: ZExportColumnKeySchema,
  /**
   * The header text. Seeded from the catalogue label and editable, which is why
   * it is stored rather than looked up — a renamed header must survive a
   * catalogue change.
   */
  label: z.string().trim().min(1).max(120),
  /** Only meaningful for `const:` columns. */
  value: z.string().max(500).optional(),
});

export type TExportColumn = z.infer<typeof ZExportColumnSchema>;

export const ZExportJoinSchema = z.object({
  /** Which join the dataset offers, e.g. `metadata`. */
  id: z.string().min(1).max(60),
  /**
   * Prefixes this join's column keys (`join:<alias>.<column>`), so the same
   * reference table can be attached twice on different options without its
   * columns overwriting each other.
   */
  alias: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/u, 'Alias must start with a letter and contain only letters, digits and _'),
  /** Join-specific settings, e.g. which metadata category to look in. */
  options: z.record(z.string(), z.string()).default({}),
});

export type TExportJoin = z.infer<typeof ZExportJoinSchema>;

/** Filter values are tagged so a saved layout can be validated without the dataset. */
export const ZExportFilterValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string().max(200) }),
  z.object({ kind: z.literal('select'), value: z.array(z.string().max(120)).max(50) }),
  z.object({
    kind: z.literal('dateRange'),
    from: z.string().datetime().nullable(),
    to: z.string().datetime().nullable(),
  }),
  z.object({
    kind: z.literal('numberRange'),
    min: z.number().finite().nullable(),
    max: z.number().finite().nullable(),
  }),
]);

export type TExportFilterValue = z.infer<typeof ZExportFilterValueSchema>;

export const ZExportFilterSchema = z.object({
  id: z.string().min(1).max(60),
  value: ZExportFilterValueSchema,
});

export const ZExportConfigSchema = z.object({
  datasetId: z.string().min(1).max(60),
  columns: z.array(ZExportColumnSchema).min(1).max(EXPORT_COLUMN_LIMIT),
  joins: z.array(ZExportJoinSchema).max(5).default([]),
  filters: z.array(ZExportFilterSchema).max(20).default([]),
  sheetName: z
    .string()
    .trim()
    .min(1)
    .max(EXPORT_SHEET_NAME_MAX)
    .refine((v) => !SHEET_NAME_FORBIDDEN.test(v), {
      message: 'Sheet name cannot contain : \\ / ? * [ or ]',
    })
    .optional(),
});

export type TExportConfig = z.infer<typeof ZExportConfigSchema>;

/**
 * Two columns writing into the same spreadsheet header is legal in Excel but
 * unreadable, and a duplicate `key` means the user added the same field twice.
 * Checked separately from the schema so the dialog can flag the offending row
 * rather than rejecting the whole layout.
 */
export const findDuplicateColumns = (columns: TExportColumn[]) => {
  const seenKeys = new Set<string>();
  const seenLabels = new Map<string, { count: number; first: string }>();
  const duplicateKeys: string[] = [];
  const duplicateLabels: string[] = [];

  for (const column of columns) {
    if (seenKeys.has(column.key)) {
      duplicateKeys.push(column.key);
    }
    seenKeys.add(column.key);

    const label = column.label.trim();
    const normalized = label.toLowerCase();
    const seen = seenLabels.get(normalized);

    if (!seen) {
      seenLabels.set(normalized, { count: 1, first: label });
      continue;
    }

    seen.count += 1;
    // Report the first spelling, not whichever duplicate happened to come
    // second — the message is stable no matter which row the user edits.
    if (seen.count === 2) {
      duplicateLabels.push(seen.first);
    }
  }

  return { duplicateKeys, duplicateLabels };
};

/** `field:invoiceNumber` -> `{ source: 'field', path: 'invoiceNumber' }`. */
export const parseColumnKey = (key: string) => {
  const separator = key.indexOf(':');
  if (separator === -1) {
    return { source: 'field' as const, path: key };
  }

  const source = key.slice(0, separator);
  const path = key.slice(separator + 1);

  if (source === 'ocr' || source === 'join' || source === 'const' || source === 'field') {
    return { source, path };
  }

  return { source: 'field' as const, path: key };
};
