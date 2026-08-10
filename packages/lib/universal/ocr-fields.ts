/**
 * Canonical accessors over OCR-extracted invoice data.
 *
 * Every BMS ML template names its fields differently — one emits `vendor_name`,
 * another `merchant_name`, a third `supplier`. A workflow that hard-codes one
 * path silently breaks the moment a document is routed to a different template,
 * and the failure is invisible: the placeholder renders empty, the lookup finds
 * nothing, and the run reports COMPLETED having done nothing.
 *
 * So workflows should read the canonical values published here
 * (`{{payload.vendorName}}`) rather than reaching into `extractedData`
 * directly. Adding support for a new template's naming = adding an alias below.
 */

/** `Vendor Name`, `vendor_name`, and `vendorName` all collapse to `vendorname`. */
const normalizeKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Candidate field names per canonical value, in priority order.
 *
 * Order matters: the first alias present with a usable value wins. Note what is
 * deliberately absent from `vendorName` — `bill_to`, `customer`, `sold_to` and
 * friends name the *recipient* of the invoice, not its sender, and matching on
 * those would route every invoice to the wrong party.
 */
export const OCR_FIELD_ALIASES = {
  vendorName: [
    'vendor_name',
    'vendor',
    'merchant_name',
    'merchant',
    'supplier_name',
    'supplier',
    'seller_name',
    'seller',
    'biller_name',
    'biller',
    'company_name',
    'business_name',
    'payee',
    'payee_name',
    'from_name',
    'issued_by',
    'remit_to',
  ],
  invoiceNumber: ['invoice_number', 'invoice_no', 'invoice_num', 'invoice', 'bill_number', 'reference'],
  invoiceDate: ['invoice_date', 'date', 'issue_date', 'bill_date'],
  dueDate: ['due_date', 'invoice_due_date', 'payment_due_date', 'payment_due'],
  totalAmount: ['total_amount', 'total', 'total_amount_due', 'amount_due', 'total_charges', 'grand_total'],
  currency: ['currency', 'currency_code'],
  accountNumber: ['account_number', 'account_no', 'account', 'customer_account_number'],
} as const;

export type OcrCanonicalField = keyof typeof OCR_FIELD_ALIASES;

/** Treat blanks, nulls, and the literal strings OCR emits for "nothing" as absent. */
const isUsable = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number') return true;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed !== '' && !['null', 'n/a', 'none', 'undefined', '-'].includes(trimmed.toLowerCase());
  }
  return false;
};

/**
 * Read one canonical value out of an `extractedData` bag, trying each alias in
 * priority order and tolerating case/underscore/camelCase differences.
 */
export const readOcrField = (
  extractedData: unknown,
  field: OcrCanonicalField,
): string | null => {
  if (!extractedData || typeof extractedData !== 'object' || Array.isArray(extractedData)) {
    return null;
  }

  // Index the bag once by normalized key so `Merchant Name` matches `merchant_name`.
  const byNormalizedKey = new Map<string, unknown>();
  for (const [key, value] of Object.entries(extractedData as Record<string, unknown>)) {
    const normalized = normalizeKey(key);
    // First writer wins, so an exact-ish key isn't shadowed by a later variant.
    if (!byNormalizedKey.has(normalized)) {
      byNormalizedKey.set(normalized, value);
    }
  }

  for (const alias of OCR_FIELD_ALIASES[field]) {
    const value = byNormalizedKey.get(normalizeKey(alias));
    if (isUsable(value)) {
      return String(value).trim();
    }
  }

  return null;
};

/**
 * The vendor/merchant/supplier name, whichever the template happened to call it.
 * This is the value workflows should key their metadata lookup on.
 */
export const resolveOcrVendorName = (extractedData: unknown): string | null =>
  readOcrField(extractedData, 'vendorName');

/**
 * Every canonical value, for publishing onto a workflow event payload. Keys with
 * no match are omitted rather than set to null, so `{{payload.vendorName}}`
 * renders empty exactly as an unknown path would.
 */
export const buildOcrCanonicalFields = (
  extractedData: unknown,
): Partial<Record<OcrCanonicalField, string>> => {
  const canonical: Partial<Record<OcrCanonicalField, string>> = {};

  for (const field of Object.keys(OCR_FIELD_ALIASES) as OcrCanonicalField[]) {
    const value = readOcrField(extractedData, field);
    if (value !== null) {
      canonical[field] = value;
    }
  }

  return canonical;
};
