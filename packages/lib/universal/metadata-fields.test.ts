import { describe, expect, it } from 'vitest';

import {
  coerceMetadataFieldValue,
  coerceMetadataFieldValues,
  deriveMetadataFieldKey,
  formatMetadataFieldValue,
  isReservedMetadataFieldKey,
} from './metadata-fields';

describe('deriveMetadataFieldKey', () => {
  it('camelCases a label', () => {
    expect(deriveMetadataFieldKey('GL account')).toBe('glAccount');
    expect(deriveMetadataFieldKey('Tax ID')).toBe('taxId');
    expect(deriveMetadataFieldKey('PO # required?')).toBe('poRequired');
    expect(deriveMetadataFieldKey('  contract   reference ')).toBe('contractReference');
  });

  it('never starts a key with a digit', () => {
    expect(deriveMetadataFieldKey('2nd approver')).toBe('f2ndApprover');
  });

  it('returns empty for a label with nothing usable in it', () => {
    expect(deriveMetadataFieldKey('   ')).toBe('');
    expect(deriveMetadataFieldKey('***')).toBe('');
  });
});

describe('isReservedMetadataFieldKey', () => {
  it('refuses keys the product itself writes', () => {
    // The one that matters: this would overwrite the value the aging report reads.
    expect(isReservedMetadataFieldKey(deriveMetadataFieldKey('Terms code'))).toBe(true);
    expect(isReservedMetadataFieldKey(deriveMetadataFieldKey('Keywords'))).toBe(true);
    expect(isReservedMetadataFieldKey(deriveMetadataFieldKey('signers'))).toBe(true);
    // Legacy single-signer keys are still read, so they are still reserved.
    expect(isReservedMetadataFieldKey('signerEmail')).toBe(true);
  });

  it('allows anything else', () => {
    expect(isReservedMetadataFieldKey('glAccount')).toBe(false);
  });
});

describe('coerceMetadataFieldValue', () => {
  const number = { key: 'creditLimit', label: 'Credit limit', type: 'NUMBER' as const };
  const date = { key: 'reviewedOn', label: 'Reviewed on', type: 'DATE' as const };
  const yesNo = { key: 'approved', label: 'Approved', type: 'BOOLEAN' as const };
  const select = {
    key: 'status',
    label: 'Status',
    type: 'SELECT' as const,
    options: ['Approved', 'Pending'],
  };

  it('treats blank as not set for every type', () => {
    for (const definition of [number, date, yesNo, select]) {
      expect(coerceMetadataFieldValue(definition, '  ')).toEqual({ ok: true, value: null });
    }
  });

  it('accepts what a spreadsheet produces for a number', () => {
    expect(coerceMetadataFieldValue(number, '1,250')).toEqual({ ok: true, value: 1250 });
    expect(coerceMetadataFieldValue(number, '£99.50')).toEqual({ ok: true, value: 99.5 });
    expect(coerceMetadataFieldValue(number, '-3')).toEqual({ ok: true, value: -3 });
  });

  it('refuses a number it cannot read rather than guessing zero', () => {
    const result = coerceMetadataFieldValue(number, 'abt 400');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('Credit limit');
  });

  it('takes ISO dates and refuses ambiguous slash forms', () => {
    expect(coerceMetadataFieldValue(date, '2026-03-04')).toEqual({ ok: true, value: '2026-03-04' });
    // 3 April or 4 March depending on who typed it — refused, not guessed.
    expect(coerceMetadataFieldValue(date, '03/04/2026').ok).toBe(false);
    expect(coerceMetadataFieldValue(date, '2026-02-31').ok).toBe(false);
  });

  it('reads the spellings people write for yes/no', () => {
    expect(coerceMetadataFieldValue(yesNo, 'Yes')).toEqual({ ok: true, value: true });
    expect(coerceMetadataFieldValue(yesNo, 'N')).toEqual({ ok: true, value: false });
    expect(coerceMetadataFieldValue(yesNo, '1')).toEqual({ ok: true, value: true });
    expect(coerceMetadataFieldValue(yesNo, 'maybe').ok).toBe(false);
  });

  it('matches a dropdown case-insensitively and stores the configured spelling', () => {
    expect(coerceMetadataFieldValue(select, 'approved')).toEqual({ ok: true, value: 'Approved' });
    const bad = coerceMetadataFieldValue(select, 'Blocked');
    expect(bad.ok).toBe(false);
    expect(bad.ok === false && bad.message).toContain('Approved, Pending');
  });

  it('says a dropdown has no options rather than blaming the value', () => {
    const result = coerceMetadataFieldValue({ ...select, options: [] }, 'anything');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain('no options');
  });
});

describe('coerceMetadataFieldValues', () => {
  const definitions = [
    { key: 'glAccount', label: 'GL account', type: 'TEXT' as const },
    { key: 'creditLimit', label: 'Credit limit', type: 'NUMBER' as const, required: true },
  ];

  it('leaves keys with no definition alone', () => {
    const { data, errors } = coerceMetadataFieldValues(definitions, {
      termsCode: '30d',
      glAccount: ' 4000 ',
      creditLimit: '5000',
    });

    expect(errors).toEqual([]);
    // The built-in key survives untouched — that is what keeps terms, keywords
    // and the signer chain working through a save.
    expect(data).toEqual({ termsCode: '30d', glAccount: '4000', creditLimit: 5000 });
  });

  it('clears a blank value rather than storing null', () => {
    const { data } = coerceMetadataFieldValues([definitions[0]], { glAccount: '' });
    expect('glAccount' in data).toBe(false);
  });

  it('reports every problem at once', () => {
    const { errors } = coerceMetadataFieldValues(definitions, { creditLimit: 'lots' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('Credit limit');
  });

  it('reports a required field that is absent', () => {
    const { errors } = coerceMetadataFieldValues(definitions, { glAccount: '4000' });
    expect(errors).toEqual(['Credit limit is required.']);
  });
});

describe('formatMetadataFieldValue', () => {
  it('renders a boolean as words and a missing value as empty', () => {
    const yesNo = { key: 'approved', label: 'Approved', type: 'BOOLEAN' as const };
    expect(formatMetadataFieldValue(yesNo, true)).toBe('Yes');
    expect(formatMetadataFieldValue(yesNo, false)).toBe('No');
    expect(formatMetadataFieldValue(yesNo, undefined)).toBe('');
  });
});
