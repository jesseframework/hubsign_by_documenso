import { describe, expect, it } from 'vitest';

import { parseInvoiceTerms, parseTermsCode, resolveDueDate } from './payment-terms';

/**
 * The due date every "days past due" figure in the product counts from.
 *
 * The case that matters most here is the least obvious one: an extractor handed a
 * page with no due date on it does not leave the field blank, it copies the
 * invoice date into it. Believing that erases the supplier's entire credit period
 * and reports an invoice as a month late on the day it was written — which is
 * exactly what the dashboard did, on invoices that were not yet due at all.
 */

describe('parseInvoiceTerms', () => {
  it('reads the net forms', () => {
    expect(parseInvoiceTerms('Net 30')).toBe(30);
    expect(parseInvoiceTerms('net30')).toBe(30);
    expect(parseInvoiceTerms('n/30')).toBe(30);
    expect(parseInvoiceTerms('NET 45')).toBe(45);
  });

  it('reads the free-text forms real invoices use', () => {
    expect(parseInvoiceTerms('Payment due within 30 days.')).toBe(30);
    expect(parseInvoiceTerms('30 days')).toBe(30);
    expect(parseInvoiceTerms('30-day terms')).toBe(30);
  });

  it('reads a number the extractor ran into the preceding word', () => {
    // Verbatim from this deployment's data. A leading word boundary misses it,
    // which is why the guard is "not preceded by a digit" instead.
    expect(parseInvoiceTerms('Paymentdue within30 days.')).toBe(30);
  });

  it('takes the net term, not the discount term', () => {
    // "2% off if paid within 10 days, otherwise the whole sum in 30." The vendor
    // is owed at 30; taking the 10 would report three weeks of phantom lateness.
    expect(parseInvoiceTerms('2/10 net 30')).toBe(30);
  });

  it('treats due-on-receipt as zero days, not as unknown', () => {
    expect(parseInvoiceTerms('Due on receipt')).toBe(0);
    expect(parseInvoiceTerms('COD')).toBe(0);
  });

  it('refuses a number that is not qualified as a term', () => {
    // The whole reason this is a separate function from parseTermsCode, which
    // accepts a bare number because a directory field is typed on purpose. Off an
    // invoice, an unqualified number is an amount or a date far more often than
    // it is a credit period — and all three of these are real values that landed
    // in `payment_terms` in this deployment.
    expect(parseInvoiceTerms('Deposit required 60% of total cost.')).toBeNull();
    expect(parseInvoiceTerms('June 1, 2026')).toBeNull();
    expect(parseInvoiceTerms('2026-06-01')).toBeNull();
    expect(parseInvoiceTerms('USD 3,311.50')).toBeNull();
    expect(parseInvoiceTerms('30')).toBeNull();
    expect(parseInvoiceTerms('')).toBeNull();
    expect(parseInvoiceTerms(null)).toBeNull();
  });

  it('leaves parseTermsCode alone — a bare number is still a directory code', () => {
    expect(parseTermsCode('30')).toBe(30);
    expect(parseTermsCode('20 D')).toBe(20);
  });
});

describe('resolveDueDate', () => {
  const now = new Date('2026-08-14T12:00:00Z');
  const iso = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

  it('takes a printed due date over any terms', () => {
    const result = resolveDueDate({
      ocrDueDate: '2026-09-01',
      invoiceDate: '2026-08-02',
      invoiceTerms: 'Net 7',
      termsCode: '90d',
      now,
    });

    expect(result.basis).toBe('invoice');
    expect(iso(result.dueAt)).toBe('2026-09-01');
    expect(result.daysPastDue).toBe(-18);
  });

  it('ignores a due date that is only the invoice date repeated', () => {
    // The regression this file exists for. Three invoices in this deployment read
    // as 27 days past due while they were still three days short of falling due.
    const result = resolveDueDate({
      ocrDueDate: '2026-07-18',
      invoiceDate: '2026-07-18',
      invoiceTerms: 'Paymentdue within30 days.',
      now,
    });

    expect(result.basis).toBe('invoice-terms');
    expect(iso(result.dueAt)).toBe('2026-08-17');
    expect(result.daysPastDue).toBe(-3);
  });

  it("ranks the invoice's own terms above the vendor's standing code", () => {
    // The directory says what this supplier usually grants; the page says what
    // was agreed for this invoice, and the page wins.
    const result = resolveDueDate({
      invoiceDate: '2026-07-18',
      invoiceTerms: 'Net 45',
      termsCode: '7d',
      now,
    });

    expect(result.basis).toBe('invoice-terms');
    expect(iso(result.dueAt)).toBe('2026-09-01');
  });

  it('falls back to the vendor terms code when the invoice states none', () => {
    const result = resolveDueDate({ invoiceDate: '2026-07-18', termsCode: '30d', now });

    expect(result.basis).toBe('terms');
    expect(iso(result.dueAt)).toBe('2026-08-17');
  });

  it('keeps an echoed date, labelled, rather than dropping the invoice', () => {
    // No terms on the page and none on the vendor, so there is nothing better to
    // offer. Discarding it would move the invoice into "cannot be judged", where
    // an unmeasured invoice is indistinguishable from a punctual one.
    const result = resolveDueDate({
      ocrDueDate: 'June 1, 2026',
      invoiceDate: 'June 1, 2026',
      invoiceTerms: 'June 1, 2026',
      now,
    });

    expect(result.basis).toBe('invoice-echoed');
    expect(iso(result.dueAt)).toBe('2026-06-01');
    expect(result.daysPastDue).toBe(74);
  });

  it('gives an invoice genuinely due on receipt the same answer either way', () => {
    // due == invoice date is suspicious, not wrong. Stated terms of zero days
    // resolve back to the invoice date, so the honest case is unharmed.
    const result = resolveDueDate({
      ocrDueDate: '2026-07-18',
      invoiceDate: '2026-07-18',
      invoiceTerms: 'Due on receipt',
      now,
    });

    expect(iso(result.dueAt)).toBe('2026-07-18');
    expect(result.daysPastDue).toBe(27);
  });

  it('counts terms from arrival only when the invoice carries no date', () => {
    const result = resolveDueDate({
      arrivedAt: new Date('2026-08-01T09:00:00Z'),
      termsCode: '30d',
      now,
    });

    expect(result.basis).toBe('terms-from-arrival');
    expect(iso(result.dueAt)).toBe('2026-08-31');
  });

  it('reports nothing rather than guessing when there is nothing to go on', () => {
    const result = resolveDueDate({ invoiceDate: '2026-07-18', now });

    expect(result.basis).toBe('none');
    expect(result.dueAt).toBeNull();
    expect(result.daysPastDue).toBeNull();
  });
});
