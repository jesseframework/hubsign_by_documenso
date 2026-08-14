/**
 * Payment terms, and the invoice due date they imply.
 *
 * An invoice's due date is the honest basis for "is this late": it is the date the
 * vendor is owed by, and the only date a supplier chasing you will quote. OCR
 * reads it off the page when the page states it — but plenty of invoices state
 * only terms ("Net 30", "20 days"), and plenty state nothing at all because the
 * terms are in a contract nobody scans.
 *
 * So the terms code fills the gap: a short string on the vendor's directory record
 * that says how long that supplier gives you. It is deliberately a code rather
 * than a number of days, because that is how finance teams already write it and
 * because "30d" survives a spreadsheet round-trip that a bare `30` does not
 * (Excel will happily reformat a lone number as a date).
 *
 * Pure, so the parsing rules can be reasoned about without a database.
 */

/**
 * Applied to a new vendor record, and to any record whose code will not parse.
 *
 * Thirty days is the common default across the region this is deployed in, and a
 * default that is *stated* is safer than an absent one: with no terms at all every
 * invoice without an OCR'd due date drops out of the aging figures silently, which
 * reads as "nothing is late".
 */
export const DEFAULT_TERMS_CODE = '30d';

/** Offered in the metadata form. Free text is still accepted. */
export const TERMS_CODE_PRESETS = ['0d', '7d', '14d', '20d', '30d', '45d', '60d', '90d'] as const;

/**
 * Days of credit a terms code grants, or null if it cannot be read.
 *
 * Forgiving about how it is written, because this value is typed by people and
 * imported from spreadsheets: `20d`, `20 D`, `net30`, `NET 30`, `n/30`, and a bare
 * `20` all mean twenty or thirty days. Anything else returns null rather than a
 * guess — a misread code that silently became 0 would report every invoice from
 * that vendor as overdue on arrival.
 *
 * `0d` is a real answer, not a missing one: due on receipt.
 */
export const parseTermsCode = (raw: unknown): number | null => {
  if (typeof raw !== 'string') {
    return null;
  }

  const value = raw.trim().toLowerCase();

  if (value === '') {
    return null;
  }

  // Due immediately, however it is spelled.
  if (['cod', 'due on receipt', 'on receipt', 'immediate', 'immediately'].includes(value)) {
    return 0;
  }

  // `20d`, `20 days`, `net 30`, `n/30`, `30`.
  const match = /^(?:net|n)?[\s/-]*(\d{1,3})\s*(?:d|day|days)?$/.exec(value);

  if (!match) {
    return null;
  }

  const days = Number(match[1]);

  // A three-digit cap is already generous for credit terms; beyond that the value
  // is far more likely to be a mistyped date or an amount than a payment term.
  return Number.isInteger(days) && days >= 0 && days <= 365 ? days : null;
};

/** Canonical form for storage and display: `30d`. */
export const formatTermsCode = (days: number): string => `${Math.max(0, Math.round(days))}d`;

const clampTermDays = (days: number): number | null =>
  Number.isInteger(days) && days >= 0 && days <= 365 ? days : null;

/**
 * Days of credit stated in free text **on the invoice itself**, or null.
 *
 * Separate from `parseTermsCode`, deliberately. That one reads a short code a
 * person typed into the vendor directory, where being forgiving is cheap. This
 * one reads whatever OCR scraped off the page — "Payment due within 30 days.",
 * "Paymentdue within30 days.", "2/10 net 30", "Deposit required 60% of total
 * cost.", "June 1, 2026" — where being forgiving is exactly how a percentage or
 * a date ends up being treated as a payment term.
 *
 * So the number has to be explicitly qualified as a term: `net N`, or `N day(s)`.
 * A bare number is accepted by `parseTermsCode` and refused here, because a bare
 * number in a sentence lifted off an invoice is far likelier to be an amount, a
 * percentage, or part of a date than a credit period.
 */
export const parseInvoiceTerms = (raw: unknown): number | null => {
  if (typeof raw !== 'string') {
    return null;
  }

  const value = raw.trim().toLowerCase();

  if (value === '') {
    return null;
  }

  if (/\b(?:due on receipt|payable on receipt|on receipt|cod|immediate(?:ly)?)\b/.test(value)) {
    return 0;
  }

  // `net 30`, `net30`, `n/30`. In "2/10 net 30" the discount half is ignored on
  // purpose: the net term is the one that says when the vendor is owed.
  const net = /\b(?:net|n)[\s/-]*(\d{1,3})\b/.exec(value);

  if (net) {
    return clampTermDays(Number(net[1]));
  }

  // `30 days`, `30-day`, and `within30 days` — the extractor runs words together
  // often enough that a leading word boundary would miss the last of those, so
  // the guard is "not preceded by another digit" instead. The unit is required:
  // without it "60% of total cost" and "1, 2026" both read as terms.
  const days = /(?<!\d)(\d{1,3})[\s-]*days?\b/.exec(value);

  if (days) {
    return clampTermDays(Number(days[1]));
  }

  return null;
};

/** Where a resolved due date came from, so the UI can say. */
export type DueDateBasis =
  /** Stated on the invoice and read by OCR. */
  | 'invoice'
  /** Derived from the terms printed on the invoice and the invoice date. */
  | 'invoice-terms'
  /** Derived from the vendor's terms code and the invoice date. */
  | 'terms'
  /** Derived from the terms code, counted from arrival — the invoice had no date. */
  | 'terms-from-arrival'
  /**
   * The OCR due date merely repeated the invoice date and nothing else was
   * available, so it stands as the only date anyone has — reported, but labelled.
   */
  | 'invoice-echoed'
  /** Neither available: no OCR due date, and no usable terms code. */
  | 'none';

export type ResolvedDueDate = {
  dueAt: Date | null;
  basis: DueDateBasis;
  /** Whole days past due at `now`. Negative means still in credit. Null when unknown. */
  daysPastDue: number | null;
};

const DAY_MS = 86_400_000;

/**
 * The due date for one invoice, and where it came from.
 *
 * Precedence is the whole point of this function:
 *
 *   1. The due date OCR read off the invoice, unless it is only the invoice date
 *      repeated (see below). What the document itself says wins; a vendor's
 *      standing terms are a rule of thumb, the printed date is the agreement for
 *      this invoice.
 *   2. The invoice date plus the terms printed on THIS invoice. Same reasoning as
 *      rule 1 and for the same reason it outranks rule 3: the directory records
 *      what a supplier usually gives you, the page records what was agreed here.
 *   3. The invoice date plus the vendor's terms code. Terms run from the invoice
 *      date — not from the day the email happened to arrive, which is when a
 *      supplier posting late would otherwise be rewarded with extra credit.
 *   4. Arrival plus those terms, when the invoice date is missing too. It is an
 *      approximation and says so through `basis`, but it beats dropping the
 *      invoice out of the figures.
 *
 * An extractor with no due date on the page in front of it does not leave the
 * field empty — it echoes the invoice date into it. Taken at face value that
 * erases the entire credit period and starts the clock on the day the invoice was
 * written: five of this deployment's twenty-seven OCR'd invoices arrive that way,
 * and three of them reported 27 days late while still three days short of being
 * due. So a "due date" equal to the invoice date is treated as no due date at all
 * and the terms decide instead. An invoice genuinely due on receipt lands in the
 * same branch and comes back out with the same date, because terms of `0d` or
 * "due on receipt" resolve to the invoice date.
 *
 * Dates are compared at day granularity in UTC. Payment terms are counted in
 * calendar days, not business hours — that is the internal-turnaround SLA's job,
 * and conflating the two would mean a supplier's contract silently depending on
 * which days your office is open.
 */
export const resolveDueDate = ({
  ocrDueDate,
  invoiceDate,
  invoiceTerms,
  arrivedAt,
  termsCode,
  now = new Date(),
}: {
  ocrDueDate?: string | Date | null;
  invoiceDate?: string | Date | null;
  /** Free-text payment terms printed on the invoice, as OCR read them. */
  invoiceTerms?: string | null;
  arrivedAt?: Date | null;
  termsCode?: string | null;
  now?: Date;
}): ResolvedDueDate => {
  const pastDue = (dueAt: Date, basis: DueDateBasis): ResolvedDueDate => ({
    dueAt,
    basis,
    // Whole days, so an invoice due today reads as 0 rather than a fraction, and
    // the buckets on the dashboard line up with what a person would count.
    daysPastDue: Math.floor((startOfUtcDay(now) - startOfUtcDay(dueAt)) / DAY_MS),
  });

  const stated = toDate(ocrDueDate);
  const issued = toDate(invoiceDate);
  const echoed = stated !== null && issued !== null && startOfUtcDay(stated) === startOfUtcDay(issued);

  if (stated && !echoed) {
    return pastDue(stated, 'invoice');
  }

  // `??`, not `||`: nought days is a real term (due on receipt) and must not fall
  // through to the vendor's standing terms the way a missing one does.
  const invoiceDays = parseInvoiceTerms(invoiceTerms);
  const days = invoiceDays ?? parseTermsCode(termsCode);
  const termsBasis: DueDateBasis = invoiceDays !== null ? 'invoice-terms' : 'terms';

  if (days !== null) {
    if (issued) {
      return pastDue(new Date(startOfUtcDay(issued) + days * DAY_MS), termsBasis);
    }

    if (arrivedAt) {
      return pastDue(new Date(startOfUtcDay(arrivedAt) + days * DAY_MS), 'terms-from-arrival');
    }
  }

  // Nothing to derive a date from, so an echoed date is the only date anyone has.
  // Reporting it — labelled — beats discarding the invoice, which would move it
  // into "cannot be judged" and make an unmeasured invoice look like a punctual
  // one. It is no worse than what was shown before; it is now marked as suspect.
  if (stated) {
    return pastDue(stated, 'invoice-echoed');
  }

  return { dueAt: null, basis: 'none', daysPastDue: null };
};

const startOfUtcDay = (value: Date): number => {
  const date = new Date(value);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime();
};

/**
 * Parse a date that came out of OCR.
 *
 * Two forms are accepted, and the line between them is whether the month is
 * stated in letters:
 *
 *   - ISO `YYYY-MM-DD` (with or without a time), which is what most extraction
 *     templates emit.
 *   - Anything containing a month NAME — "June 29, 2026", "07 Jun 2026" — parsed
 *     by the platform. Real invoices in this deployment carry both.
 *
 * All-numeric slash and dot forms are deliberately refused. `03/04/2026` is 3
 * April or 4 March depending on which country printed the invoice, and choosing
 * one would make every invoice from the other silently a month wrong in the
 * direction that matters — a month early looks paid on time, a month late starts
 * a dunning letter. Falling through to the vendor's terms is the honest answer.
 */
const toDate = (value: string | Date | null | undefined): Date | null => {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);

  if (iso) {
    const parsed = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // A month name makes the order unambiguous however the rest is arranged.
  if (/[a-z]{3}/i.test(text)) {
    const parsed = new Date(text);

    if (!Number.isNaN(parsed.getTime())) {
      // Normalised to a UTC midnight so a date read as local time cannot shift a
      // day either side of the boundary and change the count.
      return new Date(
        Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 0, 0, 0, 0),
      );
    }
  }

  return null;
};
