import { z } from 'zod';

/**
 * The shape of an invoice report, as a saved configuration.
 *
 * The Spend page was built around two fields — `spend` and `limit` — that one
 * organization happened to define. That was the right feature and the wrong
 * shape: a page hard-wired to another org's custom fields is dead weight for
 * everyone else, and there is no way to add the report *they* need without
 * shipping another page.
 *
 * So the report becomes a configuration, and a configuration can be saved with a
 * name. What the organization defined on its vendor records decides what it can
 * group by and what it can measure against; the product supplies the measures and
 * the groupings that exist for every organization.
 *
 * Zod rather than plain types because these values are persisted as JSON and read
 * back by a later version of this code: a config saved today must either parse or
 * be rejected loudly, never be half-read.
 */

/** What each row's number is. */
export const REPORT_MEASURES = ['total', 'count', 'average', 'tax'] as const;
export type ReportMeasure = (typeof REPORT_MEASURES)[number];

export const REPORT_MEASURE_LABELS: Record<ReportMeasure, string> = {
  total: 'Total amount',
  count: 'Invoice count',
  average: 'Average invoice',
  tax: 'Tax amount',
};

/** Whether a measure is money, which decides currency handling and formatting. */
export const isMoneyMeasure = (measure: ReportMeasure): boolean => measure !== 'count';

/**
 * Groupings every organization has, whatever it has configured.
 *
 * `sender` earns its place next to `vendor`: an invoice whose vendor never made it
 * into the directory still arrived from somewhere, and grouping by the address is
 * often the only way to see it at all.
 */
export const BUILT_IN_GROUPINGS = ['vendor', 'month', 'status', 'sender'] as const;
export type BuiltInGrouping = (typeof BUILT_IN_GROUPINGS)[number];

export const BUILT_IN_GROUPING_LABELS: Record<BuiltInGrouping, string> = {
  vendor: 'Vendor',
  month: 'Month',
  status: 'Document status',
  sender: 'Sender address',
};

export const isBuiltInGrouping = (key: string): key is BuiltInGrouping =>
  BUILT_IN_GROUPINGS.includes(key as BuiltInGrouping);

/** Comparisons a filter can make. Deliberately few — each is a real code path. */
export const REPORT_FILTER_OPS = ['is', 'is-not', 'contains', 'gt', 'lt'] as const;
export type ReportFilterOp = (typeof REPORT_FILTER_OPS)[number];

export const REPORT_FILTER_OP_LABELS: Record<ReportFilterOp, string> = {
  is: 'is',
  'is-not': 'is not',
  contains: 'contains',
  gt: 'is more than',
  lt: 'is less than',
};

/**
 * Fields a filter can read.
 *
 * `amount` is the invoice's own total rather than the report's measure: "invoices
 * over 10,000, counted by month" has to filter on the invoice, not on the answer.
 */
export const ZReportFilterSchema = z.object({
  field: z.string().min(1).max(80),
  op: z.enum(REPORT_FILTER_OPS),
  value: z.string().max(200),
});

export type TReportFilter = z.infer<typeof ZReportFilterSchema>;

export const ZReportConfigSchema = z.object({
  measure: z.enum(REPORT_MEASURES).default('total'),
  /** A built-in grouping, or a custom vendor field key. */
  groupBy: z.string().min(1).max(80).default('vendor'),
  /** A NUMBER field on the vendor record to measure actuals against. */
  budgetField: z.string().max(80).optional(),
  /** Report currency. Absent means "whichever has the most invoices". */
  currency: z.string().max(8).optional(),
  days: z.number().int().min(1).max(731).default(90),
  filters: z.array(ZReportFilterSchema).max(8).default([]),
});

export type TReportConfig = z.infer<typeof ZReportConfigSchema>;

export const DEFAULT_REPORT_CONFIG: TReportConfig = {
  measure: 'total',
  groupBy: 'vendor',
  days: 90,
  filters: [],
};

/**
 * The view every organization gets without configuring anything.
 *
 * Present as a real entry rather than as an empty state, so the page opens on
 * something useful and the way views work is obvious from the first visit.
 */
export const BUILT_IN_REPORT_VIEW = {
  id: 'built-in:spend-by-vendor',
  name: 'Spend by vendor',
  config: DEFAULT_REPORT_CONFIG,
} as const;

export const isBuiltInViewId = (id: string): boolean => id.startsWith('built-in:');

/**
 * A one-line description of a config, for the view list.
 *
 * Built from the config rather than stored with the view: a saved name can be
 * anything, and "Total amount by Month · 30 days" is what the view actually does.
 */
export const describeReportConfig = (
  config: TReportConfig,
  groupLabel: string,
  budgetLabel?: string | null,
): string => {
  const window =
    config.days === 365 ? '12 months' : config.days === 730 ? '24 months' : `${config.days} days`;

  return [
    `${REPORT_MEASURE_LABELS[config.measure]} by ${groupLabel}`,
    window,
    budgetLabel ? `vs ${budgetLabel}` : null,
    config.filters.length > 0
      ? `${config.filters.length} filter${config.filters.length === 1 ? '' : 's'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
};

/**
 * Whether a filter's value is read as a number.
 *
 * Only the ordering comparisons: `is` on an amount means the exact figure, which
 * is a string comparison people almost never want and would silently match
 * nothing. Those are handled numerically too, but through the same parse.
 */
export const isNumericFilterOp = (op: ReportFilterOp): boolean => op === 'gt' || op === 'lt';
