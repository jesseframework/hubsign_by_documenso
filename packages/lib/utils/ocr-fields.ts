/**
 * What the OCR extractor calls things, in one place.
 *
 * WHY THIS EXISTS. The extractor emits more than one schema for the same invoice
 * shape. In this deployment, of 27 OCR'd invoices 11 carry
 * `total_amount`/`tax_amount`/`vendor_name` and 11 carry
 * `total`/`tax`/`merchant_name`. Nothing in the data marks which you'll get.
 *
 * Every consumer that hard-coded one spelling has been quietly wrong for half the
 * corpus, and the failures were silent rather than loud:
 *
 *   - a business rule on `ocr.total_amount` was `undefined > 300000` → false, so
 *     large invoices passed the check written to catch them;
 *   - the inbox VENDOR column read only `vendor_name`, so it showed "—" for every
 *     Schema B document;
 *   - inbox search looked at four fixed names, so searching a vendor stored as
 *     `merchant_name` found nothing.
 *
 * Three separate hard-coded lists, three separate bugs. Hence one module.
 */

/**
 * Canonical field name → other names the extractor uses for the SAME value.
 *
 * Strict synonyms only. Nothing that is merely a related number belongs here:
 * aliasing `subtotal` onto `total_amount`, for instance, would make a rule about
 * the invoice total silently evaluate the pre-tax figure. Display-only fallbacks
 * that are willing to be approximate should keep their own wider list.
 */
export const OCR_FIELD_ALIASES: Record<string, string[]> = {
  total_amount: ['total'],
  tax_amount: ['tax'],
  vendor_name: ['merchant_name', 'vendorName', 'vendor', 'supplier', 'supplier_name'],
  customer_name: ['bill_to'],
  due_date: ['invoice_due_date'],
};

/** Every name a canonical field may appear under, canonical first. */
export const ocrFieldNames = (canonical: string): string[] => [
  canonical,
  ...(OCR_FIELD_ALIASES[canonical] ?? []),
];

/**
 * Flatten every extracted value into one lowercase string for substring search.
 *
 * Deliberately not a field allow-list. A user searching the inbox is looking for
 * whatever they remember off the document — a line item, an address, a phone
 * number — and any fixed list of fields silently excludes the rest. Nested
 * objects and the array-valued line-item fields (`item_description`,
 * `item_amount`) are walked so their contents are searchable too.
 */
export const ocrSearchText = (extractedData: unknown): string => {
  const parts: string[] = [];

  const walk = (value: unknown, depth: number) => {
    // Guards against a pathological or cyclic-looking payload turning a
    // keystroke-time filter into a hang.
    if (depth > 4 || parts.length > 500) return;

    if (value == null) return;

    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }

    if (typeof value === 'object') {
      // Keys are included as well as values so "po" or "vendor" matches a
      // document that carries the field at all.
      for (const [key, entry] of Object.entries(value)) {
        parts.push(key);
        walk(entry, depth + 1);
      }
      return;
    }

    parts.push(String(value));
  };

  walk(extractedData, 0);

  return parts.join(' ').toLowerCase();
};
