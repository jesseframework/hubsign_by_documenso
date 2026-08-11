import { ocrFieldNames } from '../utils/ocr-fields';

/**
 * The invoice fields the Signature Inbox reads out of OCR output.
 *
 * Extracted from the grid so the spreadsheet export can share it verbatim. The
 * export exists to put what is on screen into Excel; if it resolved OCR fields
 * even slightly differently — a wider alias list, or normalised key matching —
 * it would fill cells the grid leaves blank, and the first person to compare
 * the two would be right to call the export wrong.
 *
 * So: one implementation, imported by both. Any change here moves the screen
 * and the spreadsheet together.
 */

/**
 * Read the first non-empty value among the given OCR field names.
 *
 * Exact key lookup, deliberately. `readOcrField` in `universal/ocr-fields`
 * normalises keys before comparing and would match more; matching more here
 * would mean the export and the grid disagree.
 */
export const ocrFieldString = (item: { extractedData?: unknown }, keys: string[]): string => {
  const data = (item.extractedData ?? {}) as Record<string, unknown>;

  for (const key of keys) {
    const value = data[key];
    if (value != null && String(value).trim() !== '') {
      return String(value);
    }
  }

  return '';
};

/** All invoice fields the grid surfaces — sourced ONLY from BMS ML metadata. */
export const invoiceFields = (item: { extractedData?: unknown }) => ({
  invoiceNumber: ocrFieldString(item, ['invoice_number', 'invoiceNumber', 'invoice_no']),
  poNumber: ocrFieldString(item, ['po_number', 'purchase_order', 'poNumber']),
  // `ocrFieldNames` supplies the extractor's real synonyms (e.g. merchant_name),
  // which is why this column used to be blank for half the queue; the extra
  // entries after it are display-only guesses that cost nothing to try.
  vendorName: ocrFieldString(item, [...ocrFieldNames('vendor_name'), 'vendor_display_name']),
  vendorEmail: ocrFieldString(item, ['vendor_email', 'vendorEmail', 'email', 'merchant_contact']),
  currency: ocrFieldString(item, ['currency', 'currency_code', 'ccy']),
  total: ocrFieldString(item, [...ocrFieldNames('total_amount'), 'invoice_amount', 'grand_total']),
  tax: ocrFieldString(item, [...ocrFieldNames('tax_amount'), 'vat']),
  net: ocrFieldString(item, ['subtotal', 'net_amount', 'net']),
  invoiceDate: ocrFieldString(item, ['invoice_date', 'date', 'issue_date']),
  dueDate: ocrFieldString(item, [...ocrFieldNames('due_date'), 'payment_due']),
  customerName: ocrFieldString(item, ocrFieldNames('customer_name')),
});

export type InvoiceFields = ReturnType<typeof invoiceFields>;

/**
 * Best-effort numeric amount from the OCR fields (currency-agnostic).
 *
 * Wider than the `total` field above on purpose: this drives the high/low
 * amount filter, where an approximate figure beats none. `subtotal` is a last
 * resort and must never be treated as a synonym for the total elsewhere — a
 * pre-tax figure reported as the invoice total understates every bill.
 */
export const invoiceAmount = (item: { extractedData?: unknown }): number | null => {
  const raw = ocrFieldString(item, [
    ...ocrFieldNames('total_amount'),
    'invoice_amount',
    'totalAmount',
    'amount',
    'grand_total',
    'subtotal',
  ]);

  return parseAmount(raw);
};

/**
 * "USD 3,311.50" -> 3311.5. Returns null rather than 0 for anything
 * unparseable, so an empty cell can't be mistaken for a free invoice.
 */
export const parseAmount = (raw: string): number | null => {
  if (!raw) return null;

  const cleaned = raw.replace(/[^0-9.-]/g, '');

  // `Number('')` is 0, so a value with no digits at all — "n/a", "USD",
  // "unreadable" — used to come back as a confident zero. That reads as a free
  // invoice, and it satisfies a "under $1,000" filter, which is precisely the
  // filter someone would use to decide something needs no scrutiny.
  if (!/\d/.test(cleaned)) return null;

  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Parse an OCR date value into a real Date, for spreadsheet cells that should
 * sort and filter as dates rather than as text.
 *
 * Returns null when the value is not a date the runtime recognises; the caller
 * writes the original string instead, because a date the extractor produced in
 * some unexpected format is still information worth exporting.
 */
export const parseOcrDate = (raw: string): Date | null => {
  if (!raw) return null;

  // Anchor the common ISO-ish prefix at midnight UTC rather than letting the
  // runtime apply the server's timezone, which would shift 2026-06-12 to the
  // 11th for anyone west of Greenwich.
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const parsed = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

  // "06/01/2026" and "June 1, 2026" parse to midnight in the *server's*
  // timezone, which is a different calendar day in UTC for anyone east of
  // Greenwich — a June 1 invoice would export as May 31. Rebuild date-only
  // values at UTC midnight so the day survives the trip into the spreadsheet.
  if (parsed.getHours() === 0 && parsed.getMinutes() === 0 && parsed.getSeconds() === 0) {
    return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
  }

  return parsed;
};
