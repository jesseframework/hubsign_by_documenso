/**
 * The one parser for a date that came out of OCR.
 *
 * WHY THIS EXISTS. There were two, and they disagreed. The overdue calculation
 * accepted ISO and month-name forms and discarded everything else; the
 * spreadsheet export ran the same value through `new Date()`, which silently
 * reads `03/04/2026` as 4 March because that is the convention the runtime was
 * born with. Same invoice, same field, two answers — and the export's answer was
 * a guess presented as a fact.
 *
 * The discarding was the more expensive half. An invoice printing `18/05/2026`
 * had its due date thrown away, fell through to the vendor's standing terms code,
 * and appeared on the dashboard with a date nobody had ever printed on it — which
 * is not a missing figure anyone would notice, it is a wrong one stated
 * confidently. Eight of the twelve date forms an extractor plausibly emits went
 * that way.
 *
 * THE RULE HERE. A numeric date is read whenever the value itself settles the
 * order — `18/05/2026` has no eighteenth month, so it is unambiguously
 * day-first, and `05/18/2026` is unambiguously month-first. Only when both
 * numbers could be a month (`03/04/2026`) is there a real question, and that is
 * the only case that needs an outside hint. Absent one it still returns null,
 * because a coin toss between 3 April and 4 March puts an invoice a month wrong
 * in whichever direction hurts: a month early looks settled, a month late starts
 * a dunning letter.
 *
 * Pure, so the rules can be reasoned about without a database.
 */

/** Which way round an all-numeric date is written. */
export type DateOrder = 'DMY' | 'MDY';

/** `2026-05-18`, `2026/5/18`, and the leading date of `2026-05-18T00:00:00Z`. */
const YEAR_FIRST = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/;

/** `18/05/2026`, `05-18-2026`, `18.05.26`, and the same with a time after it. */
const ALL_NUMERIC = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?!\d)/;

/**
 * Two-digit years, pivoted at 70.
 *
 * An invoice dated `18/05/69` is not from 1969; nothing in this queue predates
 * the product. The pivot is the usual one rather than something cleverer because
 * every real value lands decades clear of it either way.
 */
const expandYear = (year: number, digits: number): number =>
  digits === 4 ? year : year < 70 ? 2000 + year : 1900 + year;

/**
 * A real calendar date at UTC midnight, or null.
 *
 * Round-tripped through `Date` on purpose: `Date.UTC(2026, 1, 31)` does not fail,
 * it rolls forward to 3 March. Silently accepting 31/02 would turn an
 * unreadable date into a plausible wrong one, which is the failure mode this
 * whole module exists to avoid.
 */
const utcDate = (year: number, month: number, day: number): Date | null => {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
};

/**
 * The order an all-numeric date must be in, when the value itself proves it.
 *
 * Used to let one field on an invoice settle another: a document whose invoice
 * date reads `18/05/2026` was printed day-first, so its `03/04/2026` due date is
 * 3 April. Same page, same printer, same convention — a far better answer than a
 * global default, and it needs no configuration.
 *
 * Returns null for anything it cannot prove, including a value that is already
 * unambiguous on its own (`2026-05-18`) — there is nothing to infer from a form
 * that never had the question.
 */
export const detectDateOrder = (value: unknown): DateOrder | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const match = ALL_NUMERIC.exec(value.trim());

  if (!match) {
    return null;
  }

  const first = Number(match[1]);
  const second = Number(match[2]);

  if (first > 12 && second <= 12) {
    return 'DMY';
  }

  if (second > 12 && first <= 12) {
    return 'MDY';
  }

  return null;
};

/**
 * Parse an OCR date value.
 *
 * `order` breaks the tie for an all-numeric date whose two leading numbers could
 * both be months. It is consulted for nothing else: a value that proves its own
 * order is read that way even if the hint disagrees, because the hint is an
 * inference about the document and the value is the document.
 */
export const parseOcrDateValue = (
  value: string | Date | null | undefined,
  order: DateOrder | null = null,
): Date | null => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();

  if (text === '') {
    return null;
  }

  const yearFirst = YEAR_FIRST.exec(text);

  if (yearFirst) {
    return utcDate(Number(yearFirst[1]), Number(yearFirst[2]), Number(yearFirst[3]));
  }

  const numeric = ALL_NUMERIC.exec(text);

  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = expandYear(Number(numeric[3]), numeric[3].length);

    const resolved: DateOrder | null =
      first > 12 && second <= 12 ? 'DMY' : second > 12 && first <= 12 ? 'MDY' : order;

    if (resolved === null) {
      return null;
    }

    return resolved === 'DMY' ? utcDate(year, second, first) : utcDate(year, first, second);
  }

  // A month stated in letters makes the order unambiguous however the rest is
  // arranged — "June 29, 2026", "07 Jun 2026" — so the platform can have it.
  if (/[a-z]{3}/i.test(text)) {
    const parsed = new Date(text);

    if (!Number.isNaN(parsed.getTime())) {
      // A date-only value is normalised to UTC midnight so a value read as local
      // time cannot shift a day either side of the boundary and change the count.
      // A value that carries a real time of day keeps it.
      if (parsed.getHours() === 0 && parsed.getMinutes() === 0 && parsed.getSeconds() === 0) {
        return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()));
      }

      return parsed;
    }
  }

  return null;
};
