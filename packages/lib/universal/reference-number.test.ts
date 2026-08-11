import { describe, expect, it } from 'vitest';

import {
  amountDifference,
  normalizeReference,
  referencesMatch,
  stripFieldLabel,
} from './reference-number';

describe('stripFieldLabel', () => {
  it('drops a caption the extractor left on its own value', () => {
    // Observed on real BMS ML output — the same PO read once with the caption
    // and once without would otherwise look like two different references.
    expect(stripFieldLabel('PO Number: MER-PO-5023')).toBe('MER-PO-5023');
    expect(stripFieldLabel('Vendor: Portmore Tech Distribution Ltd.')).toBe(
      'Portmore Tech Distribution Ltd.',
    );
    expect(stripFieldLabel('Total Amount:  2428.80')).toBe('2428.80');
  });

  it('leaves a value with no caption alone', () => {
    expect(stripFieldLabel('MER-PO-5023')).toBe('MER-PO-5023');
    expect(stripFieldLabel('  MER-PO-5023  ')).toBe('MER-PO-5023');
  });

  it('does not maul a timestamp', () => {
    // Starts with a digit, so the caption pattern cannot match it.
    expect(stripFieldLabel('2026-03-19T00:00:00Z')).toBe('2026-03-19T00:00:00Z');
  });

  it('leaves a caption with no value after it alone rather than emptying it', () => {
    expect(stripFieldLabel('PO Number:')).toBe('PO Number:');
  });
});

describe('normalizeReference', () => {
  it('folds case, spacing and punctuation', () => {
    expect(normalizeReference('MER-PO-5023')).toBe('MERPO5023');
    expect(normalizeReference('mer po 5023')).toBe('MERPO5023');
    expect(normalizeReference('  MERPO5023  ')).toBe('MERPO5023');
    expect(normalizeReference('mer/po/5023')).toBe('MERPO5023');
  });

  it('folds a non-breaking hyphen the same as an ordinary one', () => {
    // OCR and word processors both emit these; they are invisible in a UI and
    // would otherwise make two identical-looking references disagree.
    expect(normalizeReference('MER‑PO‑5023')).toBe('MERPO5023');
    expect(normalizeReference('MER–PO–5023')).toBe('MERPO5023');
  });

  it('keeps non-Latin references rather than emptying them', () => {
    expect(normalizeReference('ЗАКАЗ-123')).toBe('ЗАКАЗ123');
    expect(normalizeReference('注文-456')).toBe('注文456');
  });

  it('is empty for absent input', () => {
    expect(normalizeReference(null)).toBe('');
    expect(normalizeReference(undefined)).toBe('');
    expect(normalizeReference('   ')).toBe('');
    expect(normalizeReference('---')).toBe('');
  });

  it('accepts a number', () => {
    expect(normalizeReference(5023)).toBe('5023');
  });
});

describe('referencesMatch', () => {
  it('matches through an extractor caption on one side', () => {
    expect(referencesMatch('PO Number: mer po 5023', 'MER-PO-5023')).toBe(true);
  });

  it('matches through formatting differences', () => {
    expect(referencesMatch('MER-PO-5023', 'mer po 5023')).toBe(true);
    expect(referencesMatch('MER-PO-5023', 'MERPO5023')).toBe(true);
    expect(referencesMatch('MER-PO-5023', 'MER-PO-5023 ')).toBe(true);
  });

  it('does NOT match a genuinely different number', () => {
    // The whole point of the check. One digit apart is a different purchase
    // order, and no amount of normalising may hide that.
    expect(referencesMatch('MER-PO-5023', 'MER-PO-5024')).toBe(false);
    expect(referencesMatch('MER-PO-5023', 'MER-PO-502')).toBe(false);
    expect(referencesMatch('PO-1', 'PO-2')).toBe(false);
  });

  it('returns null when either side is missing', () => {
    // "Cannot tell" must be distinguishable from "they disagree", or a rule
    // blocks every document that simply has no attachment.
    expect(referencesMatch(null, 'MER-PO-5023')).toBeNull();
    expect(referencesMatch('MER-PO-5023', '')).toBeNull();
    expect(referencesMatch(null, null)).toBeNull();
    expect(referencesMatch('---', 'MER-PO-5023')).toBeNull();
  });
});

describe('amountDifference', () => {
  it('returns the magnitude regardless of order', () => {
    expect(amountDifference(2428.8, 2400)).toBe(28.8);
    expect(amountDifference(2400, 2428.8)).toBe(28.8);
  });

  it('is exactly zero for equal figures despite floating point', () => {
    // 2428.80 - 2428.80 is 4.5e-13 in IEEE 754, which a "difference > 0" rule
    // would read as a discrepancy.
    expect(amountDifference(2428.8, 2428.8)).toBe(0);
    expect(amountDifference(0.1 + 0.2, 0.3)).toBe(0);
  });

  it('parses formatted money strings', () => {
    expect(amountDifference('USD 2,428.80', 2428.8)).toBe(0);
    expect(amountDifference('$1,000.00', '900')).toBe(100);
  });

  it('returns null rather than 0 when a side is missing or unreadable', () => {
    expect(amountDifference(null, 100)).toBeNull();
    expect(amountDifference(100, undefined)).toBeNull();
    expect(amountDifference('n/a', 100)).toBeNull();
    expect(amountDifference('', 100)).toBeNull();
  });

  it('handles a negative figure', () => {
    expect(amountDifference(-50, 50)).toBe(100);
  });
});
