import { describe, expect, it } from 'vitest';

import {
  invoiceAmount,
  invoiceFields,
  ocrFieldString,
  parseAmount,
  parseOcrDate,
} from './inbox-invoice-fields';

describe('ocrFieldString', () => {
  it('returns the first non-empty value in order', () => {
    const item = { extractedData: { a: '', b: '  ', c: 'found', d: 'later' } };
    expect(ocrFieldString(item, ['a', 'b', 'c', 'd'])).toBe('found');
  });

  it('treats a whitespace-only value as absent', () => {
    expect(ocrFieldString({ extractedData: { a: '   ' } }, ['a'])).toBe('');
  });

  it('keeps a numeric zero rather than skipping it', () => {
    // A genuine zero tax is information; skipping it would silently fall
    // through to some other field's value.
    expect(ocrFieldString({ extractedData: { tax: 0 } }, ['tax'])).toBe('0');
  });

  it('survives missing, null and non-object extractedData', () => {
    expect(ocrFieldString({}, ['a'])).toBe('');
    expect(ocrFieldString({ extractedData: null }, ['a'])).toBe('');
  });

  it('does not normalise keys — an exact match is required', () => {
    // The grid uses exact lookup. If this ever starts matching, the export and
    // the screen will disagree about which cells are populated.
    expect(ocrFieldString({ extractedData: { 'Vendor Name': 'Acme' } }, ['vendor_name'])).toBe('');
  });
});

describe('invoiceFields', () => {
  it('reads the vendor_name/total_amount extractor schema', () => {
    const fields = invoiceFields({
      extractedData: {
        invoice_number: 'INV-1',
        vendor_name: 'Northgate Consulting Ltd.',
        total_amount: '3311.50',
        tax_amount: '451.50',
        due_date: '2026-07-12',
      },
    });

    expect(fields.invoiceNumber).toBe('INV-1');
    expect(fields.vendorName).toBe('Northgate Consulting Ltd.');
    expect(fields.total).toBe('3311.50');
    expect(fields.tax).toBe('451.50');
    expect(fields.dueDate).toBe('2026-07-12');
  });

  it('reads the merchant_name/total extractor schema too', () => {
    // Both schemas exist in the same deployment with nothing marking which is
    // which, which is the whole reason the alias module exists.
    const fields = invoiceFields({
      extractedData: {
        merchant_name: 'DigitalOcean LLC',
        total: '238.17',
        tax: '0',
        invoice_due_date: '2026-06-01',
      },
    });

    expect(fields.vendorName).toBe('DigitalOcean LLC');
    expect(fields.total).toBe('238.17');
    expect(fields.tax).toBe('0');
    expect(fields.dueDate).toBe('2026-06-01');
  });

  it('leaves every field empty for an item with no OCR data', () => {
    const fields = invoiceFields({ extractedData: null });
    expect(Object.values(fields).every((value) => value === '')).toBe(true);
  });
});

describe('parseAmount', () => {
  it('strips currency and separators', () => {
    expect(parseAmount('USD 3,311.50')).toBe(3311.5);
    expect(parseAmount('$1,000')).toBe(1000);
  });

  it('keeps a negative', () => {
    expect(parseAmount('-250.00')).toBe(-250);
  });

  it('returns null rather than 0 for something unparseable', () => {
    // Returning 0 would make an unreadable invoice look free, and would pass a
    // "total under 1000" filter.
    expect(parseAmount('n/a')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });
});

describe('invoiceAmount', () => {
  it('prefers the total over the subtotal', () => {
    expect(invoiceAmount({ extractedData: { total_amount: '500', subtotal: '450' } })).toBe(500);
  });

  it('falls back to the subtotal when no total was extracted', () => {
    expect(invoiceAmount({ extractedData: { subtotal: '450' } })).toBe(450);
  });

  it('is null when nothing numeric is present', () => {
    expect(invoiceAmount({ extractedData: { vendor_name: 'Acme' } })).toBeNull();
  });
});

describe('parseOcrDate', () => {
  it('anchors an ISO date at UTC midnight', () => {
    expect(parseOcrDate('2026-06-12')?.toISOString()).toBe('2026-06-12T00:00:00.000Z');
  });

  it('ignores a time component on an ISO-prefixed value', () => {
    expect(parseOcrDate('2026-06-12T18:30:00Z')?.toISOString()).toBe('2026-06-12T00:00:00.000Z');
  });

  it('keeps the calendar day for a locale-formatted date', () => {
    // `new Date('06/01/2026')` is midnight in the SERVER's timezone. Written to
    // a spreadsheet as-is, that is 31 May for anyone east of Greenwich. The
    // day must survive regardless of where the server runs.
    const parsed = parseOcrDate('06/01/2026');
    expect(parsed).not.toBeNull();
    expect(parsed?.getUTCFullYear()).toBe(2026);
    expect(parsed?.getUTCMonth()).toBe(5); // June, zero-indexed
    expect(parsed?.getUTCDate()).toBe(1);
    expect(parsed?.getUTCHours()).toBe(0);
  });

  it('keeps the calendar day for a long-form date', () => {
    const parsed = parseOcrDate('June 1, 2026');
    expect(parsed?.getUTCDate()).toBe(1);
    expect(parsed?.getUTCMonth()).toBe(5);
    expect(parsed?.getUTCHours()).toBe(0);
  });

  it('preserves a real time of day rather than flattening it', () => {
    const parsed = parseOcrDate('June 1, 2026 14:30');
    expect(parsed?.getHours()).toBe(14);
  });

  it('returns null for junk so the caller can fall back to the raw text', () => {
    expect(parseOcrDate('not a date')).toBeNull();
    expect(parseOcrDate('')).toBeNull();
  });
});
