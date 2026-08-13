import { prisma } from '@documenso/prisma';

import {
  type MetadataFieldDefinitionLike,
  formatMetadataFieldValue,
} from '../../universal/metadata-fields';
import { invoiceFields, parseAmount, parseOcrDate } from '../../universal/inbox-invoice-fields';
import { normalizeMetadataKey } from '../../universal/metadata';
import { matchVendorName, prepareVendorCandidates, vendorCoreName } from '../../universal/vendor-match';
import { getOrganizationDueDates } from '../inbox/invoice-due';

/**
 * What the organization is spending, and with whom.
 *
 * The dashboard could say how many invoices arrived and how late they were, but
 * not what they came to — so "which suppliers are we spending the most with"
 * had no answer anywhere in the product, despite every figure needed for it
 * already being extracted off the page.
 *
 * The grouping is the point. Spend by vendor is the obvious cut, but the useful
 * ones are usually the organization's own: by GL account, by supplier status, by
 * contract owner, by region. Those are exactly the custom fields defined on the
 * vendor's directory record, so any of them can be the axis — a report the
 * organization shapes rather than one shipped fixed.
 *
 * Three things this refuses to do, because each would produce a confident wrong
 * number rather than an honest gap:
 *
 *   - **Sum across currencies.** USD 4,000 + JMD 4,000 is not 8,000 of
 *     anything. Figures are reported within one currency, and the others are
 *     listed so nothing is silently dropped.
 *   - **Treat an unreadable total as zero.** `parseAmount` returns null for a
 *     value with no digits, and those invoices are counted and named as
 *     unmeasured instead of quietly making the total look smaller.
 *   - **Fold an unidentified vendor into "other".** An invoice whose vendor is
 *     not in the directory still appears, under the name the page carried, so
 *     the total is complete even when the directory is not.
 */

/** Rows returned. Enough to see the long tail; `otherRows` says what was cut. */
const ROW_LIMIT = 25;
/** Invoices listed under each row, largest first, for the drill-down. */
const ITEMS_PER_ROW = 12;
/** Invoices scanned in a window. Far above any realistic month of invoicing. */
const SCAN_LIMIT = 5_000;

/**
 * How far above the median an invoice must sit to be called out as doubtful.
 *
 * OCR reading the wrong number off a page is not rare and not detectable from the
 * value alone — but it is *visible* in the distribution. One document in this
 * deployment came back as 6,017,047 against a median of 2,185: a bank statement
 * whose account number was read as the total, which on its own accounted for 99%
 * of a quarter's reported spend.
 *
 * Flagged, never excluded. A large invoice is a real thing and dropping it would
 * understate the total; the reader is told which figures to check instead. Twenty
 * five times the median is deliberately loose — it catches a misplaced field, not
 * merely a big month.
 */
const OUTLIER_MEDIAN_MULTIPLE = 25;
/** Below this many invoices a median means too little to judge anything against. */
const OUTLIER_MIN_SAMPLE = 6;

/** Grouping by the vendor itself, rather than by one of its fields. */
export const SPEND_GROUP_VENDOR = 'vendor';

export type SpendItem = {
  inboxItemId: string;
  documentId: number;
  invoiceNumber: string | null;
  /** The vendor as it will be shown — directory label where known. */
  vendor: string;
  /** The date the figure is dated by, ISO `yyyy-MM-dd`. */
  date: string;
  /** Whether that date came off the invoice or from when the email arrived. */
  dateBasis: 'invoice' | 'arrival';
  amount: number;
  daysPastDue: number | null;
  /**
   * Far enough above the median for the figure itself to be in doubt. Still
   * counted — see `OUTLIER_MEDIAN_MULTIPLE`.
   */
  doubtful: boolean;
};

export type SpendRow = {
  key: string;
  label: string;
  total: number;
  invoices: number;
  /** Mean invoice value — a supplier's shape, not just its size. */
  average: number;
  /** Of `total`, how much is on invoices now past the date the vendor is owed by. */
  overdueTotal: number;
  overdueInvoices: number;
  /** Fraction of the report total, 0–1. */
  share: number;
  /**
   * Distinct vendors folded into this row. Only meaningful when grouping by a
   * field: "Approved · 4 suppliers" is the sentence that makes the row useful.
   */
  vendors: number;
  items: SpendItem[];
  moreItems: number;
};

export type VendorSpendReport = {
  /** Inclusive window, ISO dates. */
  from: string;
  to: string;
  groupBy: string;
  groupLabel: string;
  /** The currency every figure below is in. Null when nothing measurable landed. */
  currency: string | null;
  /** Every currency in the window, so what is excluded is visible and switchable. */
  currencies: { code: string; label: string; invoices: number; total: number }[];
  totalSpend: number;
  invoices: number;
  /** Invoices in the window whose total could not be read — excluded from figures. */
  withoutAmount: number;
  /** Of the counted invoices, how many are dated by the printed invoice date. */
  datedByInvoice: number;
  /** Counted invoices whose vendor is not in the directory. */
  unidentifiedVendors: number;
  /** Counted invoices whose amount is implausibly large — included, but flagged. */
  doubtfulAmounts: number;
  /** What they come to, so the reader can see how much of the total is in doubt. */
  doubtfulTotal: number;
  rows: SpendRow[];
  otherRows: number;
  otherRowsTotal: number;
  /** What this report can be grouped by, driven by the org's own vendor fields. */
  groupOptions: { key: string; label: string }[];
};

/** Currency code as stated, normalized; empty means the invoice stated none. */
const currencyOf = (raw: string): string => raw.trim().toUpperCase();

const UNSTATED_CURRENCY = '';

export const getVendorSpend = async ({
  organizationId,
  from,
  to,
  groupBy = SPEND_GROUP_VENDOR,
  currency,
  now = new Date(),
}: {
  organizationId: number;
  /** Inclusive start of the window. */
  from: Date;
  /** Inclusive end of the window. */
  to: Date;
  groupBy?: string;
  /** Report currency. Defaults to whichever currency has the most invoices. */
  currency?: string;
  now?: Date;
}): Promise<VendorSpendReport> => {
  const [definitions, records, items] = await Promise.all([
    prisma.metadataFieldDefinition.findMany({
      where: { organizationId, category: SPEND_GROUP_VENDOR },
      orderBy: [{ order: 'asc' }, { label: 'asc' }],
    }),
    prisma.metadataRecord.findMany({
      where: { organizationId, category: SPEND_GROUP_VENDOR },
      select: { id: true, key: true, label: true, email: true, data: true },
    }),
    // Windowed on arrival, then re-dated per invoice below. The arrival date is
    // the only date every item is guaranteed to have, so it is what bounds the
    // query; an invoice printed just before the window that arrived inside it is
    // better included and dated honestly than missed entirely.
    prisma.signatureInboxItem.findMany({
      where: {
        organizationId,
        OR: [
          { receivedAt: { gte: from, lte: to } },
          { AND: [{ receivedAt: null }, { createdAt: { gte: from, lte: to } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: SCAN_LIMIT,
      select: {
        id: true,
        documentId: true,
        createdAt: true,
        receivedAt: true,
        senderEmail: true,
        extractedData: true,
      },
    }),
  ]);

  const groupOptions = [
    { key: SPEND_GROUP_VENDOR, label: 'Vendor' },
    ...definitions.map((definition) => ({ key: definition.key, label: definition.label })),
  ];

  const definition = definitions.find((candidate) => candidate.key === groupBy);
  // An unknown group key falls back to vendor rather than erroring: a saved link
  // or a bookmarked view must not break when a field is renamed away.
  const effectiveGroupBy = definition ? groupBy : SPEND_GROUP_VENDOR;
  const groupLabel = definition?.label ?? 'Vendor';

  // ---- vendor identification ------------------------------------------------
  //
  // Same shape as the SLA resolver's: exact directory key, then name similarity
  // so "Company Ltd." on the invoice finds "Company Limited" in the directory,
  // then the sender's address for mail whose vendor name never extracted. It is
  // not shared with that resolver because the branches there are about which
  // *target* applies and deliberately only consider records carrying one; here
  // the question is only which record an invoice belongs to.
  const byKey = new Map(records.map((record) => [record.key, record]));
  const byEmail = new Map(
    records
      .filter((record) => record.email?.trim())
      .map((record) => [record.email!.trim().toLowerCase(), record]),
  );
  const prepared = prepareVendorCandidates(
    records.map((record) => ({ name: record.label ?? record.key, value: record })),
  );

  type VendorRecord = (typeof records)[number];

  const identityCache = new Map<string, VendorRecord | null>();

  const identify = (vendorName: string): VendorRecord | null => {
    const cached = identityCache.get(vendorName);
    if (cached !== undefined) return cached;

    const exact = byKey.get(normalizeMetadataKey(vendorName));
    const outcome = exact ? null : matchVendorName(vendorName, prepared);
    // An ambiguous match resolves to nothing: the directory holds the same
    // company twice, and attributing spend to one of them would be a coin flip
    // that moves money between two rows of this very report.
    const resolved = exact ?? (outcome?.ambiguousWith ? null : (outcome?.match?.value ?? null));

    identityCache.set(vendorName, resolved);
    return resolved;
  };

  // ---- how overdue each invoice is -----------------------------------------
  //
  // The same due dates the aging card is built from, so a figure here and a
  // count there cannot describe different invoices.
  const dueDates = await getOrganizationDueDates({ organizationId, now });
  const pastDueByItem = new Map(
    dueDates.map((due) => [due.inboxItemId, due.open ? due.daysPastDue : null]),
  );

  // ---- measure every invoice ----------------------------------------------
  type Measured = {
    item: (typeof items)[number];
    amount: number;
    currency: string;
    vendorLabel: string;
    record: VendorRecord | null;
    date: string;
    dateBasis: 'invoice' | 'arrival';
    daysPastDue: number | null;
  };

  const measured: Measured[] = [];
  let withoutAmount = 0;

  const isoDay = (value: Date): string => value.toISOString().slice(0, 10);

  for (const item of items) {
    const fields = invoiceFields(item);
    // Only the total field, never the subtotal: a pre-tax figure reported as
    // spend understates every bill, and this is the number people budget from.
    const amount = parseAmount(fields.total);

    if (amount === null) {
      withoutAmount += 1;
      continue;
    }

    const record = fields.vendorName ? identify(fields.vendorName) : null;

    /*
      The sender's address is a fallback ONLY when OCR read no vendor name at all.

      Applying it whenever the name failed to match the directory looks harmless
      and is not: several vendors' invoices routinely arrive from one shared
      mailbox — a forwarding address, an AP inbox, this deployment's own test
      account — so a single directory record holding that address would capture
      every invoice whose vendor is simply not in the directory yet. That is how a
      bank statement for 6,017,047 was attributed to a landscaping supplier and
      became 99% of the report.

      A named vendor that is not in the directory belongs in its own row under its
      own name. The report says how many of those there are.
    */
    const resolved =
      record ??
      (!fields.vendorName && item.senderEmail
        ? (byEmail.get(item.senderEmail.trim().toLowerCase()) ?? null)
        : null);

    const printed = fields.invoiceDate ? parseOcrDate(fields.invoiceDate) : null;
    const arrival = item.receivedAt ?? item.createdAt;

    measured.push({
      item,
      amount,
      currency: currencyOf(fields.currency),
      // `||` throughout: an empty string is a missing name, and `??` would keep
      // it and label the row with nothing.
      vendorLabel:
        resolved?.label ||
        resolved?.key ||
        fields.vendorName.trim() ||
        item.senderEmail ||
        'Unidentified',
      record: resolved,
      date: isoDay(printed ?? arrival),
      dateBasis: printed ? 'invoice' : 'arrival',
      daysPastDue: pastDueByItem.get(item.id) ?? null,
    });
  }

  // ---- currencies ----------------------------------------------------------
  const byCurrency = new Map<string, { invoices: number; total: number }>();

  for (const entry of measured) {
    const bucket = byCurrency.get(entry.currency) ?? { invoices: 0, total: 0 };
    bucket.invoices += 1;
    bucket.total += entry.amount;
    byCurrency.set(entry.currency, bucket);
  }

  const currencies = [...byCurrency.entries()]
    .map(([code, bucket]) => ({
      code,
      // Named rather than left blank, because "" in a currency switcher reads as
      // a rendering fault rather than as a fact about the invoices.
      label: code === UNSTATED_CURRENCY ? 'Currency not stated' : code,
      invoices: bucket.invoices,
      total: bucket.total,
    }))
    // Most invoices first: that is the currency the organization actually works
    // in, which is a better default than whichever happens to total highest.
    .sort((a, b) => b.invoices - a.invoices || b.total - a.total);

  const reportCurrency =
    currency !== undefined && byCurrency.has(currencyOf(currency))
      ? currencyOf(currency)
      : (currencies.at(0)?.code ?? null);

  const inCurrency =
    reportCurrency === null ? [] : measured.filter((entry) => entry.currency === reportCurrency);

  /*
    The threshold, from the median of the invoices actually being reported.

    The median rather than the mean, because the mean is exactly what one misread
    figure destroys: with 6,017,047 in a set of nineteen, the mean is 318,000 and
    the offending value sits only 19× above it, while the median stays at 2,185
    where it belongs.
  */
  const sortedAmounts = inCurrency.map((entry) => entry.amount).sort((a, b) => a - b);
  const median = sortedAmounts.length > 0 ? sortedAmounts[Math.floor(sortedAmounts.length / 2)] : 0;
  const doubtfulAbove =
    sortedAmounts.length >= OUTLIER_MIN_SAMPLE && median > 0
      ? median * OUTLIER_MEDIAN_MULTIPLE
      : Number.POSITIVE_INFINITY;

  const isDoubtful = (amount: number): boolean => amount > doubtfulAbove;

  // ---- group ---------------------------------------------------------------
  type Bucket = {
    key: string;
    label: string;
    total: number;
    invoices: number;
    overdueTotal: number;
    overdueInvoices: number;
    vendors: Set<string>;
    items: SpendItem[];
  };

  const buckets = new Map<string, Bucket>();

  const groupOf = (entry: Measured): { key: string; label: string } => {
    if (effectiveGroupBy === SPEND_GROUP_VENDOR) {
      // Core name, so "Company Ltd." and "Company Limited" are one row even
      // when neither is in the directory.
      return {
        key: entry.record?.id ?? vendorCoreName(entry.vendorLabel) ?? entry.vendorLabel.toLowerCase(),
        label: entry.vendorLabel,
      };
    }

    const bag =
      entry.record?.data && typeof entry.record.data === 'object' && !Array.isArray(entry.record.data)
        ? (entry.record.data as Record<string, unknown>)
        : {};
    const shown = definition
      ? formatMetadataFieldValue(definition as MetadataFieldDefinitionLike, bag[effectiveGroupBy])
      : '';

    // Named, not dropped. Spend against suppliers nobody has classified yet is
    // usually the finding, and a report that hid it would be reassuring and
    // wrong.
    return shown === ''
      ? { key: '__unset__', label: entry.record ? `No ${groupLabel.toLowerCase()}` : 'Vendor not in directory' }
      : { key: shown.toLowerCase(), label: shown };
  };

  for (const entry of inCurrency) {
    const { key, label } = groupOf(entry);
    const bucket = buckets.get(key) ?? {
      key,
      label,
      total: 0,
      invoices: 0,
      overdueTotal: 0,
      overdueInvoices: 0,
      vendors: new Set<string>(),
      items: [],
    };

    bucket.total += entry.amount;
    bucket.invoices += 1;
    bucket.vendors.add(entry.vendorLabel.toLowerCase());

    if (entry.daysPastDue !== null && entry.daysPastDue > 0) {
      bucket.overdueTotal += entry.amount;
      bucket.overdueInvoices += 1;
    }

    bucket.items.push({
      inboxItemId: entry.item.id,
      documentId: entry.item.documentId,
      invoiceNumber: invoiceFields(entry.item).invoiceNumber || null,
      vendor: entry.vendorLabel,
      date: entry.date,
      dateBasis: entry.dateBasis,
      amount: entry.amount,
      daysPastDue: entry.daysPastDue,
      doubtful: isDoubtful(entry.amount),
    });

    buckets.set(key, bucket);
  }

  const totalSpend = inCurrency.reduce((sum, entry) => sum + entry.amount, 0);

  const ranked = [...buckets.values()].sort((a, b) => b.total - a.total);
  const shown = ranked.slice(0, ROW_LIMIT);

  return {
    from: isoDay(from),
    to: isoDay(to),
    groupBy: effectiveGroupBy,
    groupLabel,
    currency: reportCurrency,
    currencies,
    totalSpend,
    invoices: inCurrency.length,
    withoutAmount,
    datedByInvoice: inCurrency.filter((entry) => entry.dateBasis === 'invoice').length,
    unidentifiedVendors: inCurrency.filter((entry) => entry.record === null).length,
    doubtfulAmounts: inCurrency.filter((entry) => isDoubtful(entry.amount)).length,
    doubtfulTotal: inCurrency
      .filter((entry) => isDoubtful(entry.amount))
      .reduce((sum, entry) => sum + entry.amount, 0),
    rows: shown.map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      total: bucket.total,
      invoices: bucket.invoices,
      average: bucket.invoices > 0 ? bucket.total / bucket.invoices : 0,
      overdueTotal: bucket.overdueTotal,
      overdueInvoices: bucket.overdueInvoices,
      share: totalSpend > 0 ? bucket.total / totalSpend : 0,
      vendors: bucket.vendors.size,
      items: bucket.items.sort((a, b) => b.amount - a.amount).slice(0, ITEMS_PER_ROW),
      moreItems: Math.max(0, bucket.items.length - ITEMS_PER_ROW),
    })),
    otherRows: Math.max(0, ranked.length - shown.length),
    otherRowsTotal: ranked.slice(ROW_LIMIT).reduce((sum, bucket) => sum + bucket.total, 0),
    groupOptions,
  };
};
