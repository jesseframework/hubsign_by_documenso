import { describe, expect, it } from 'vitest';

import { detectDateOrder, parseOcrDateValue } from './ocr-date';

/**
 * The gate every OCR'd date passes through before it can become a due date.
 *
 * What this file is really protecting is the difference between "discarded" and
 * "guessed". Both are cheap to write and both are wrong: discarding a readable
 * date sends the invoice off to a terms code and puts a date on the dashboard
 * that nobody printed, while guessing at an unreadable one puts a date on the
 * dashboard that nobody printed AND looks authoritative. The line between them is
 * whether the value itself settles the question.
 */

const iso = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);

describe('parseOcrDateValue', () => {
  it('reads year-first forms', () => {
    expect(iso(parseOcrDateValue('2026-05-18'))).toBe('2026-05-18');
    expect(iso(parseOcrDateValue('2026-05-18T00:00:00Z'))).toBe('2026-05-18');
    expect(iso(parseOcrDateValue('2026/05/18'))).toBe('2026-05-18');
  });

  it('reads a year-first form the extractor did not zero-pad', () => {
    // Unambiguous by construction, and previously discarded for want of a digit.
    expect(iso(parseOcrDateValue('2026-5-18'))).toBe('2026-05-18');
  });

  it('reads a numeric date whose own value settles the order', () => {
    // There is no eighteenth month, so these are not guesses in either direction.
    expect(iso(parseOcrDateValue('18/05/2026'))).toBe('2026-05-18');
    expect(iso(parseOcrDateValue('05/18/2026'))).toBe('2026-05-18');
    expect(iso(parseOcrDateValue('18-05-2026'))).toBe('2026-05-18');
    expect(iso(parseOcrDateValue('18.05.2026'))).toBe('2026-05-18');
    expect(iso(parseOcrDateValue('18/05/26'))).toBe('2026-05-18');
  });

  it('refuses a genuinely ambiguous date rather than picking a country', () => {
    // 3 April or 4 March depending on who printed it. A month early looks
    // settled; a month late starts a dunning letter. Neither is worth a coin toss.
    expect(parseOcrDateValue('03/04/2026')).toBeNull();
  });

  it('uses the order hint for the ambiguous case, and only that case', () => {
    expect(iso(parseOcrDateValue('03/04/2026', 'DMY'))).toBe('2026-04-03');
    expect(iso(parseOcrDateValue('03/04/2026', 'MDY'))).toBe('2026-03-04');

    // The hint is an inference about the document; the value IS the document, so
    // a value that proves its own order wins even when the hint contradicts it.
    expect(iso(parseOcrDateValue('18/05/2026', 'MDY'))).toBe('2026-05-18');
  });

  it('refuses a date that does not exist', () => {
    // Date.UTC rolls 31 February forward to 3 March rather than failing, which
    // would turn an unreadable value into a plausible wrong one.
    expect(parseOcrDateValue('31/02/2026')).toBeNull();
    expect(parseOcrDateValue('2026-02-31')).toBeNull();
  });

  it('reads month names however the rest is arranged', () => {
    expect(iso(parseOcrDateValue('18 May 2026'))).toBe('2026-05-18');
    expect(iso(parseOcrDateValue('May 18, 2026'))).toBe('2026-05-18');
    expect(iso(parseOcrDateValue('07 Jun 2026'))).toBe('2026-06-07');
  });

  it('returns null for anything that is not a date', () => {
    expect(parseOcrDateValue('')).toBeNull();
    expect(parseOcrDateValue(null)).toBeNull();
    expect(parseOcrDateValue(undefined)).toBeNull();
    expect(parseOcrDateValue('n/a')).toBeNull();
    expect(parseOcrDateValue('USD 3,311.50')).toBeNull();
  });
});

describe('detectDateOrder', () => {
  it('proves the order from a value that can only be read one way', () => {
    expect(detectDateOrder('18/05/2026')).toBe('DMY');
    expect(detectDateOrder('05/18/2026')).toBe('MDY');
  });

  it('proves nothing from an ambiguous or already-unambiguous value', () => {
    expect(detectDateOrder('03/04/2026')).toBeNull();
    expect(detectDateOrder('2026-05-18')).toBeNull();
    expect(detectDateOrder('May 18, 2026')).toBeNull();
    expect(detectDateOrder(null)).toBeNull();
  });
});
