import { describe, expect, it } from 'vitest';

import { looksLikePoNumber, normalizeExtractedFields, parseMoney } from './ocr';

describe('parseMoney', () => {
  it('passes through real numbers', () => {
    expect(parseMoney(608)).toBe(608);
    expect(parseMoney(0)).toBe(0);
    expect(parseMoney(250000.5)).toBe(250000.5);
  });

  it('parses the formatted strings OCR actually returns', () => {
    // These are the shapes that made naive comparison unsafe: JSONLogic would
    // coerce them to NaN and a `> 300000` check would quietly be false.
    expect(parseMoney('250000')).toBe(250000);
    expect(parseMoney('250,000.00')).toBe(250000);
    expect(parseMoney('JMD 399,855.40')).toBe(399855.4);
    expect(parseMoney('$1,234.56')).toBe(1234.56);
    expect(parseMoney(' 42 ')).toBe(42);
  });

  it('handles negatives', () => {
    expect(parseMoney('-110,000.00')).toBe(-110000);
  });

  it('returns null rather than 0 for unparseable input', () => {
    // Collapsing to 0 would make `total_amount == 0` true for both a genuinely
    // zero invoice and a failed read.
    expect(parseMoney('N/A')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney('-')).toBeNull();
    expect(parseMoney('.')).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney({})).toBeNull();
    expect(parseMoney(Number.NaN)).toBeNull();
    expect(parseMoney(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('makes a threshold rule behave correctly on formatted values', () => {
    const THRESHOLD = 300_000;

    expect(parseMoney('250,000.00')! > THRESHOLD).toBe(false);
    expect(parseMoney('399,855.40')! > THRESHOLD).toBe(true);
    // The bug this prevents: without parsing, "399,855.40" > 300000 is false.
    expect(Number('399,855.40') > THRESHOLD).toBe(false);
  });
});

describe('looksLikePoNumber', () => {
  it('rejects every junk value observed in this deployment', () => {
    // These are real extracted po_number values, and every one of them passes a
    // bare presence check — which is why the derived fact exists.
    for (const junk of ['licy', 'Box', 'rt', 'S', 'wer', 'WERED']) {
      expect(looksLikePoNumber(junk), junk).toBe(false);
    }
  });

  it('accepts values that look like real POs', () => {
    for (const real of ['1357325', 'PO-4471', '0010222', 4471, '  90218  ']) {
      expect(looksLikePoNumber(real), String(real)).toBe(true);
    }
  });

  it('rejects absent values', () => {
    expect(looksLikePoNumber(null)).toBe(false);
    expect(looksLikePoNumber(undefined)).toBe(false);
    expect(looksLikePoNumber('')).toBe(false);
    expect(looksLikePoNumber('   ')).toBe(false);
  });

  it('rejects a too-short numeric PO', () => {
    expect(looksLikePoNumber(12)).toBe(false);
    expect(looksLikePoNumber('7')).toBe(false);
  });
});

describe('normalizeExtractedFields', () => {
  // The extractor emits two schemas for the same invoice shape. Both of these are
  // verbatim key sets from this deployment's data.
  const SCHEMA_A = {
    vendor_name: 'Fepro Ltd',
    total_amount: '6,017,047.00',
    tax_amount: 150000,
    due_date: 'July 15, 2026',
    po_number: '1357325',
  };

  const SCHEMA_B = {
    merchant_name: 'Northgate Consulting Ltd.',
    total: 4937,
    tax: 657,
    subtotal: 4380,
    bill_to: 'Bluewave Retail Group',
    invoice_due_date: 'July 15, 2026',
    invoice_number: 'INV-2026-0142',
  };

  it('reads the canonical schema directly', () => {
    const facts = normalizeExtractedFields(SCHEMA_A);

    expect(facts.total_amount).toBe(6017047);
    expect(facts.vendor_name).toBe('Fepro Ltd');
    expect(facts.has_plausible_po).toBe(true);
  });

  it('fills canonical fields from the alternate schema', () => {
    // The bug this prevents: `ocr.total_amount` was undefined for these
    // documents, so `total_amount > 300000` was silently false rather than true.
    const facts = normalizeExtractedFields(SCHEMA_B);

    expect(facts.total_amount).toBe(4937);
    expect(facts.tax_amount).toBe(657);
    expect(facts.vendor_name).toBe('Northgate Consulting Ltd.');
    expect(facts.customer_name).toBe('Bluewave Retail Group');
    expect(facts.due_date).toBe('July 15, 2026');
  });

  it('makes a threshold rule fire on both schemas', () => {
    const THRESHOLD = 300_000;
    const big = { total: 'USD 6,017,047.00' };

    expect((normalizeExtractedFields(big).total_amount as number) > THRESHOLD).toBe(true);
    expect((normalizeExtractedFields(SCHEMA_A).total_amount as number) > THRESHOLD).toBe(true);
  });

  it('never lets an alias shadow a supplied canonical value', () => {
    const facts = normalizeExtractedFields({ total_amount: 100, total: 999 });

    expect(facts.total_amount).toBe(100);
  });

  it('falls through an unparseable alias instead of settling on null', () => {
    const facts = normalizeExtractedFields({ total: 'N/A' });

    expect(facts.total_amount).toBeNull();
  });

  it('reports no plausible PO when the key is absent entirely', () => {
    // SCHEMA_B has no po_number at all — the case on the document under test.
    const facts = normalizeExtractedFields(SCHEMA_B);

    expect(facts.has_plausible_po).toBe(false);
    expect(facts.po_number_length).toBe(0);
  });

  it('keeps array line-item fields untouched', () => {
    const facts = normalizeExtractedFields({ item_rate: [1500, 2200, 85] });

    expect(facts.item_rate).toEqual([1500, 2200, 85]);
  });
});
