import { describe, expect, it } from 'vitest';

import { ocrFieldNames, ocrSearchText } from './ocr-fields';

/** Verbatim key set from a real Schema B extraction in this deployment. */
const SCHEMA_B = {
  tax: 657,
  total: 4937,
  bill_to: 'Bluewave Retail Group',
  currency: 'USD',
  subtotal: 4380,
  item_rate: [1500, 2200, 85],
  item_amount: [1500, 2200, 680],
  invoice_date: 'June 15, 2026',
  total_in_cad: null,
  exchange_rate: null,
  item_quantity: [1, 1, 8],
  merchant_name: 'Northgate Consulting Ltd.',
  payment_terms: null,
  invoice_number: 'INV-2026-0142',
  invoice_due_date: 'July 15, 2026',
  item_description: [
    'IT infrastructure assessment',
    'Network security audit',
    'On-site support (hours)',
  ],
  merchant_address: '12 Harbour View Plaza, Kingston, Jamaica',
  merchant_contact: '+1 (876) 555-0142',
};

describe('ocrFieldNames', () => {
  it('puts the canonical name first, then the extractor synonyms', () => {
    expect(ocrFieldNames('vendor_name')[0]).toBe('vendor_name');
    expect(ocrFieldNames('vendor_name')).toContain('merchant_name');
    expect(ocrFieldNames('total_amount')).toContain('total');
    expect(ocrFieldNames('tax_amount')).toContain('tax');
  });

  it('returns just the name for a field with no known synonyms', () => {
    expect(ocrFieldNames('invoice_number')).toEqual(['invoice_number']);
  });

  it('never treats subtotal as a synonym for the total', () => {
    // Aliasing these would make a rule about the invoice total silently evaluate
    // the pre-tax figure.
    expect(ocrFieldNames('total_amount')).not.toContain('subtotal');
  });
});

describe('ocrSearchText', () => {
  const hay = ocrSearchText(SCHEMA_B);

  it('finds a vendor the old four-field search could not', () => {
    // Stored as merchant_name, so searching "northgate" matched nothing before.
    expect(hay).toContain('northgate');
  });

  it('finds values the old search excluded by design', () => {
    expect(hay).toContain('bluewave retail group'); // bill_to
    expect(hay).toContain('network security audit'); // inside an array
    expect(hay).toContain('harbour view plaza'); // address
    expect(hay).toContain('876'); // phone
  });

  it('finds numbers and invoice references', () => {
    expect(hay).toContain('4937');
    expect(hay).toContain('inv-2026-0142');
  });

  it('includes keys so a field-name search matches', () => {
    expect(hay).toContain('invoice_number');
  });

  it('is lowercase so callers can compare against a lowercased query', () => {
    expect(hay).toBe(hay.toLowerCase());
  });

  it('handles absent or empty extraction without throwing', () => {
    expect(ocrSearchText(null)).toBe('');
    expect(ocrSearchText(undefined)).toBe('');
    expect(ocrSearchText({})).toBe('');
  });

  it('skips nulls rather than emitting "null" as searchable text', () => {
    // total_in_cad and payment_terms are null above — a literal "null" in the
    // haystack would make every such document match a search for "null".
    expect(ocrSearchText({ a: null, b: 'x' })).not.toContain('null');
  });

  it('terminates on a deeply nested payload', () => {
    let nested: unknown = 'deep';
    for (let i = 0; i < 50; i++) nested = { next: nested };

    expect(() => ocrSearchText(nested)).not.toThrow();
  });
});
