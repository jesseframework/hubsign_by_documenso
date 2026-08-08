/**
 * OCR-extracted invoice facts — the namespace that made this engine worth
 * building, since it is what business rules actually want to talk about.
 *
 * TWO THINGS THIS PROVIDER HAS TO GET RIGHT
 *
 * 1. NUMERIC COERCION. Extracted amounts arrive inconsistently: sometimes a
 *    number (`608`), sometimes a string (`"250,000.00"`, `"JMD 250000"`). A rule
 *    like `total_amount > 300000` compared against a formatted string is
 *    silently wrong — JSONLogic would coerce `"250,000.00"` to NaN and the
 *    comparison would quietly be false, letting a large invoice through the
 *    exact check meant to catch it. Money fields are therefore parsed to real
 *    numbers, with the untouched original kept under `ocr.raw.*`.
 *
 * 2. HONEST RELIABILITY SIGNALS. These values are a machine's guess. Real data
 *    in this deployment includes `po_number: "Box"` — a garbage read that any
 *    naive "is a PO present?" rule would happily accept. `ocr.confidence`,
 *    `ocr.hasData` and `ocr.fieldCount` are exposed so rules can be written
 *    defensively (e.g. require a PO *and* confidence above a threshold), and the
 *    catalogue marks these fields `unreliable` so the builder can say so.
 */

import { prisma } from '@documenso/prisma';

import { OCR_FIELD_ALIASES } from '../../../utils/ocr-fields';
import type { RuleFactProvider, RuleSubject } from '../types';

/** Fields treated as money and coerced to numbers. Scalars only — never arrays. */
const MONEY_FIELDS = [
  'total_amount',
  'total',
  'subtotal',
  'tax_amount',
  'tax',
  'amount_due',
  'balance_due',
  'total_in_cad',
];

/**
 * Canonical field name ← the other names the extractor uses for the same thing.
 *
 * Shared with the inbox UI rather than defined here, because a rule and the list
 * a user searches must agree on what a field is called. See `utils/ocr-fields`
 * for why the extractor has more than one spelling and what it cost.
 *
 * Rules are written against the canonical name and the aliases are folded in
 * below, so an author never has to know which schema a document came from.
 */
const FIELD_ALIASES = OCR_FIELD_ALIASES;

/**
 * Parses a money-ish value to a number, or null when it isn't one.
 *
 * Returning null rather than 0 is deliberate: 0 is a legitimate invoice total,
 * so collapsing "unparseable" into 0 would make `total_amount == 0` true for
 * both a genuinely zero invoice and a failed read.
 */
export const parseMoney = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  // Strip currency codes/symbols, thousands separators and whitespace, keeping
  // digits, one decimal point and a leading sign.
  const cleaned = value.replace(/[^\d.\-]/g, '');

  if (!cleaned || cleaned === '-' || cleaned === '.') {
    return null;
  }

  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Whether an extracted PO number looks like a real one.
 *
 * WHY THIS IS A DERIVED FACT AND NOT A RULE
 *
 * The JSONLogic evaluator supports only `var`, boolean and arithmetic operators —
 * there is no `length`, `matches` or `in`. So "the PO must be plausible" cannot
 * be expressed as a condition, and a presence check is the ceiling. On this
 * deployment's real data a presence check is useless: every extracted
 * `po_number` is either null or noise — `"licy"`, `"Box"`, `"rt"`, `"S"`,
 * `"wer"` — and all of those satisfy "is present".
 *
 * Deciding what counts as plausible is exactly a provider's job, so it is
 * computed here and exposed as a boolean the rule language can actually use.
 *
 * HEURISTIC, and stated as one: at least 4 characters and containing a digit.
 * Every junk value observed in this deployment is short and digit-free, while
 * real POs (`1357325`) are not. It will still reject a legitimate all-letter PO
 * scheme — an org that uses one should rule on `ocr.po_number` presence instead.
 */
export const looksLikePoNumber = (value: unknown): boolean => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && String(Math.abs(value)).length >= 4;
  }

  if (typeof value !== 'string') return false;

  const trimmed = value.trim();

  return trimmed.length >= 4 && /\d/.test(trimmed);
};

/**
 * Turns raw `extractedData` into the flat, canonical fact set rules are written
 * against: money coerced to numbers, alternate field names folded into the
 * canonical ones, and the derived PO facts appended.
 *
 * Pure and exported so the coercion and aliasing can be tested without a
 * database — these are the rules that decide whether a condition fires at all.
 */
export const normalizeExtractedFields = (
  extracted: Record<string, unknown>,
): Record<string, unknown> => {
  const facts: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(extracted)) {
    facts[key] = MONEY_FIELDS.includes(key) ? parseMoney(value) : value;
  }

  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    // Never shadow a value the extractor supplied under the canonical name.
    if (facts[canonical] !== undefined && facts[canonical] !== null) {
      continue;
    }

    for (const alias of aliases) {
      const value = extracted[alias];

      if (value === undefined || value === null) {
        continue;
      }

      facts[canonical] = MONEY_FIELDS.includes(canonical) ? parseMoney(value) : value;

      // An alias that failed to parse is no better than an absent one, so keep
      // looking rather than settling on null.
      if (facts[canonical] !== null) {
        break;
      }
    }
  }

  // Derived after aliasing, so a PO found under an alias still counts.
  const po = facts.po_number;

  facts.has_plausible_po = looksLikePoNumber(po);
  facts.po_number_length =
    typeof po === 'string' ? po.trim().length : po == null ? 0 : String(po).length;

  return facts;
};

export const ocrProvider: RuleFactProvider = {
  namespace: 'ocr',
  label: 'OCR / extracted invoice data',
  fields: [
    {
      path: 'ocr.hasData',
      label: 'OCR produced any fields',
      type: 'boolean',
      description: 'False when extraction returned nothing. Guard other OCR rules with this.',
    },
    { path: 'ocr.fieldCount', label: 'Number of extracted fields', type: 'number' },
    {
      path: 'ocr.confidence',
      label: 'OCR confidence (0-1)',
      type: 'number',
      description: 'Combine with field checks — a present value can still be a misread.',
    },
    { path: 'ocr.documentType', label: 'Detected document type', type: 'string' },
    { path: 'ocr.needsReview', label: 'Flagged for review', type: 'boolean' },
    {
      path: 'ocr.po_number',
      label: 'PO number (raw)',
      type: 'string',
      unreliable: true,
      description: 'Empty when no PO was found. Frequently a misread — prefer has_plausible_po.',
    },
    {
      path: 'ocr.has_plausible_po',
      label: 'PO number looks real',
      type: 'boolean',
      description:
        'True when the PO is at least 4 characters and contains a digit. Use this instead of a bare presence check — misreads like "Box" or "licy" pass presence but fail here.',
    },
    { path: 'ocr.po_number_length', label: 'PO number length', type: 'number' },
    { path: 'ocr.invoice_number', label: 'Invoice number', type: 'string', unreliable: true },
    { path: 'ocr.vendor_name', label: 'Vendor name', type: 'string', unreliable: true },
    { path: 'ocr.customer_name', label: 'Customer name', type: 'string', unreliable: true },
    { path: 'ocr.currency', label: 'Currency', type: 'string', unreliable: true },
    {
      path: 'ocr.total_amount',
      label: 'Total amount',
      type: 'number',
      unreliable: true,
      description:
        'Parsed to a number, and filled from "total" when the extractor used that name instead. Null when absent or unparseable.',
    },
    { path: 'ocr.subtotal', label: 'Subtotal', type: 'number', unreliable: true },
    {
      path: 'ocr.tax_amount',
      label: 'Tax amount',
      type: 'number',
      unreliable: true,
      description: 'Filled from "tax" when the extractor used that name instead.',
    },
    { path: 'ocr.invoice_date', label: 'Invoice date', type: 'date', unreliable: true },
    { path: 'ocr.due_date', label: 'Due date', type: 'date', unreliable: true },
  ],

  resolve: async (subject: RuleSubject) => {
    const documentId = Number(subject.entityId);

    if (!Number.isFinite(documentId)) {
      return undefined;
    }

    const item = await prisma.signatureInboxItem
      .findUnique({
        where: { documentId },
        select: {
          extractedData: true,
          ocrConfidence: true,
          mlConfidence: true,
          documentType: true,
          needsReview: true,
          ocrProcessed: true,
        },
      })
      .catch(() => null);

    // Not an inbox-sourced document, or OCR never ran. `hasData: false` is
    // returned rather than nothing, so a rule can distinguish "no OCR" from
    // "OCR found no PO" instead of both looking like an absent field.
    if (!item) {
      // Derived fields are included explicitly rather than left undefined, so a
      // rule on `has_plausible_po` behaves the same for a non-inbox document as
      // for one whose OCR found no PO.
      return {
        hasData: false,
        fieldCount: 0,
        confidence: null,
        has_plausible_po: false,
        po_number_length: 0,
        raw: {},
      };
    }

    const extracted = (item.extractedData ?? {}) as Record<string, unknown>;
    const entries = Object.entries(extracted);

    return {
      hasData: entries.length > 0,
      fieldCount: entries.length,
      confidence: item.ocrConfidence ?? item.mlConfidence ?? null,
      documentType: item.documentType ?? null,
      needsReview: item.needsReview,
      processed: item.ocrProcessed,
      // Originals, so a rule can still reach the text the OCR actually saw under
      // whatever name it used.
      raw: extracted,
      ...normalizeExtractedFields(extracted),
    };
  },
};
