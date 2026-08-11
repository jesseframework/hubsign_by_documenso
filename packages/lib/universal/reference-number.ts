/**
 * Comparing reference numbers that came off two different documents.
 *
 * A PO number printed on a purchase order and the same PO number printed on the
 * invoice that quotes it are produced by different systems, laid out by
 * different templates and read by OCR twice. They agree in substance and differ
 * in presentation: `MER-PO-5023`, `mer po 5023`, `MERPO5023`, `MER‑PO‑5023` with a
 * non-breaking hyphen. A raw `==` calls all of those a mismatch, and a matching
 * rule that cries wolf on formatting is one people switch off.
 *
 * So comparison is done on a normalised form. This deliberately does NOT try to
 * be clever about near-misses — `MER-PO-5023` and `MER-PO-5024` are different
 * purchase orders and must stay different. Only presentation is folded away.
 */

/**
 * Drop a field label the extractor left attached to its own value.
 *
 * BMS ML sometimes returns `"PO Number: MER-PO-5023"` or
 * `"Vendor: Portmore Tech Distribution Ltd."` — the caption and the value in
 * one string. Observed on real extractions, and it is fatal to comparison: the
 * same purchase order read once with the label and once without looks like two
 * different references.
 *
 * Only a leading run of letters ending in a colon is removed, so a value that
 * merely contains a colon — a timestamp, say — is untouched.
 */
export const stripFieldLabel = (value: string): string => {
  const match = value.match(/^\s*[A-Za-z][A-Za-z0-9 ._#/()-]{0,39}:\s*(\S.*)$/s);

  return (match ? match[1] : value).trim();
};

/**
 * Fold a reference to its comparable form: uppercase, letters and digits only.
 *
 * Unicode-aware, so a reference containing non-Latin characters is not silently
 * emptied the way an ASCII-only class would empty it.
 */
export const normalizeReference = (value: unknown): string => {
  if (value === null || value === undefined) return '';

  return stripFieldLabel(String(value))
    .normalize('NFKD')
    // Strip diacritics, so "Nº" forms and accented references fold together.
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
};

/**
 * Do two references name the same thing?
 *
 * Returns null when either side is absent — "we cannot tell" is a different
 * answer from "they disagree", and a rule that blocks on a mismatch must not
 * fire merely because nothing was supplied.
 */
export const referencesMatch = (a: unknown, b: unknown): boolean | null => {
  const left = normalizeReference(a);
  const right = normalizeReference(b);

  if (left === '' || right === '') return null;

  return left === right;
};

/**
 * The gap between two money figures, or null when either is missing.
 *
 * Returned as a magnitude so a rule can express a tolerance with one
 * comparison. Null rather than 0 for a missing side: zero is what you get when
 * the two agree exactly, and a rule reading "difference greater than 1" must
 * not treat an unknown as agreement.
 */
export const amountDifference = (a: unknown, b: unknown): number | null => {
  const left = toFiniteNumber(a);
  const right = toFiniteNumber(b);

  if (left === null || right === null) return null;

  // Rounded to the cent. Floating point turns 2428.80 - 2428.80 into 4.5e-13,
  // which is not zero and would look like a discrepancy in a strict rule.
  return Math.round(Math.abs(left - right) * 100) / 100;
};

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const cleaned = value.replace(/[^0-9.-]/g, '');
  if (!/\d/.test(cleaned)) return null;

  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
};
