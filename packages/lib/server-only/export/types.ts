import type { TExportFilterValue } from '../../types/export';

/**
 * The dataset contract behind the export builder.
 *
 * A dataset is "a grid you can export": it knows how to fetch its own rows for
 * an organization, what columns it can offer, and which reference tables can be
 * joined onto those rows. Registering a new grid means writing one of these —
 * the builder dialog, the column catalogue, the joins, the spreadsheet writer
 * and the saved templates are all dataset-agnostic.
 *
 * This module is `server-only`: datasets query Prisma directly. The zod shapes
 * the browser needs live in `types/export.ts`.
 */

/** Everything a spreadsheet cell can hold. */
export type ExportValue = string | number | boolean | Date | null;

/**
 * How a value should be written, which decides the Excel cell format. Getting
 * this right is the difference between a column you can sum and a column of
 * text that merely looks like numbers.
 */
export type ExportValueType = 'text' | 'number' | 'money' | 'date' | 'datetime' | 'boolean';

export type ExportColumnDef<TRow = unknown> = {
  /** Unprefixed; the registry adds `field:` / `ocr:` / `join:<alias>.`. */
  key: string;
  label: string;
  /** Groups the left-hand panel of the builder, e.g. "Invoice", "OCR fields". */
  group: string;
  type: ExportValueType;
  /** Shown under the label in the picker. Use it to warn, not to restate. */
  hint?: string;
  /** Selected automatically for a fresh export. */
  isDefault?: boolean;
  read: (row: TRow) => ExportValue;
};

/** A column the builder shows, with its fully-qualified key. */
export type CatalogueColumn = Omit<ExportColumnDef, 'read'> & { key: string };

export type ExportFilterDef = {
  id: string;
  label: string;
  kind: TExportFilterValue['kind'];
  /** For `select` filters: the choices. Computed per org where they're data. */
  options?: { value: string; label: string }[];
  hint?: string;
};

/**
 * A reference table joined onto every row — the "passthrough" in the builder.
 *
 * `prepare` runs once for the whole result set and returns a resolver, so a
 * join costs one query no matter how many rows are exported. It also reports
 * how many rows it matched, which the workbook records: a join that silently
 * matched nothing looks identical to a reference table full of blanks.
 */
export type ExportJoinDef<TRow = unknown> = {
  id: string;
  label: string;
  /** Plain-language description of how rows are paired up. Shown in the UI. */
  matchDescription: string;
  /** Extra settings the user picks, e.g. which metadata category to search. */
  options?: ExportFilterDef[];
  prepare: (args: {
    organizationId: number;
    rows: TRow[];
    options: Record<string, string>;
  }) => Promise<PreparedJoin<TRow>>;
};

export type PreparedJoin<TRow = unknown> = {
  /** Columns this join contributes, unprefixed. */
  columns: Omit<ExportColumnDef<TRow>, 'read'>[];
  /** Values for one row, keyed by the unprefixed column key. */
  resolve: (row: TRow) => Record<string, ExportValue>;
  /** How many of the supplied rows found a match. Recorded in the workbook. */
  matched: number;
  /**
   * Anything the reader should know to trust the join — for a fuzzy match, the
   * threshold used and how many pairings were approximate rather than exact.
   */
  notes: string[];
};

export type ParsedFilters = Map<string, TExportFilterValue>;

export type ExportDataset<TRow = never> = {
  id: string;
  label: string;
  description: string;
  /** Column groups in the order the builder should show them. */
  groupOrder: string[];
  joins: ExportJoinDef<TRow>[];
  filters: (args: { organizationId: number }) => Promise<ExportFilterDef[]>;
  /**
   * Every column offered for this org, including ones discovered from the data
   * (raw OCR keys differ per deployment, so they cannot be a fixed list).
   */
  columns: (args: { organizationId: number }) => Promise<ExportColumnDef<TRow>[]>;
  /**
   * Fetch rows honouring the filters. Must scope by `organizationId` itself —
   * nothing above it does.
   *
   * `limit` is a hard cap; return at most that many and set `total` to the true
   * count so the workbook can say what was left out.
   */
  fetch: (args: {
    organizationId: number;
    userId: number;
    filters: ParsedFilters;
    limit: number;
  }) => Promise<{ rows: TRow[]; total: number }>;
};

/** Narrowing helper: datasets are stored heterogeneously in the registry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyExportDataset = ExportDataset<any>;
