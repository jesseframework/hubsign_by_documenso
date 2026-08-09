import { describe, expect, it } from 'vitest';

import { normalizeMetadataKey } from './metadata';

/**
 * A metadata record's identity is its name: the unique index is
 * (organizationId, category, normalizeMetadataKey(name)).
 *
 * These cover the case from the field report — a signee sheet that used a job
 * title as the name, so four people collapsed into two records. The import used
 * to drop the extra rows silently; it now reports them. The behaviour asserted
 * here is what makes that necessary, so it should not change quietly.
 */
describe('normalizeMetadataKey', () => {
  it('is case- and punctuation-insensitive', () => {
    expect(normalizeMetadataKey('Skidd View Ltd.')).toBe('skidd view ltd');
    expect(normalizeMetadataKey('  SKIDD   VIEW   ltd  ')).toBe('skidd view ltd');
    expect(normalizeMetadataKey('Skidd-View, Ltd')).toBe('skidd view ltd');
  });

  it('collapses a job-title name shared by several people', () => {
    // Verbatim from the reported CSV: four signee rows, two distinct names.
    const rows = [
      { name: 'Finance Approver', contact: 'Antoinette Brown', role: 'APPROVER' },
      { name: 'Finance Approver', contact: 'Sheree Simpson', role: 'APPROVER' },
      { name: 'AP Rep', contact: 'Shantell Scarlett', role: 'SIGNER' },
      { name: 'AP Rep', contact: 'Cheyzan Lemonius', role: 'SIGNER' },
    ];

    const keys = new Set(rows.map((r) => normalizeMetadataKey(r.name)));

    // Two keys for four rows — so two of them are the same record, and only the
    // last of each pair would survive an upsert.
    expect(keys.size).toBe(2);
    expect([...keys]).toEqual(['finance approver', 'ap rep']);
  });

  it('keeps four records when each person carries their own name', () => {
    // The supported shape: the person is the name, the job title goes in Role,
    // which is not part of the key and may repeat freely.
    const rows = [
      { name: 'Antoinette Brown', role: 'APPROVER' },
      { name: 'Sheree Simpson', role: 'APPROVER' },
      { name: 'Shantell Scarlett', role: 'SIGNER' },
      { name: 'Cheyzan Lemonius', role: 'SIGNER' },
    ];

    expect(new Set(rows.map((r) => normalizeMetadataKey(r.name))).size).toBe(4);
    // Two people share each role, and that is fine — role is not unique.
    expect(new Set(rows.map((r) => r.role)).size).toBe(2);
  });

  it('returns empty for a name with nothing usable in it', () => {
    // The import treats this as "Name is required" rather than creating a record
    // keyed on an empty string.
    expect(normalizeMetadataKey('   ')).toBe('');
    expect(normalizeMetadataKey('—')).toBe('');
  });
});
