import { describe, expect, it } from 'vitest';

import { ZExportConfigSchema, findDuplicateColumns, parseColumnKey } from './export';

const baseConfig = {
  datasetId: 'signature-inbox',
  columns: [{ key: 'field:title', label: 'Document title' }],
};

describe('parseColumnKey', () => {
  it('splits a prefixed key', () => {
    expect(parseColumnKey('field:invoiceNumber')).toEqual({ source: 'field', path: 'invoiceNumber' });
    expect(parseColumnKey('ocr:merchant_name')).toEqual({ source: 'ocr', path: 'merchant_name' });
    expect(parseColumnKey('join:vendor.phone')).toEqual({ source: 'join', path: 'vendor.phone' });
  });

  it('treats an unprefixed key as a dataset field', () => {
    expect(parseColumnKey('title')).toEqual({ source: 'field', path: 'title' });
  });

  it('treats an unknown prefix as a field name rather than guessing', () => {
    expect(parseColumnKey('bogus:thing')).toEqual({ source: 'field', path: 'bogus:thing' });
  });

  it('keeps a dotted join path intact past the first dot', () => {
    // A directory key can itself contain a dot; only the alias is before it.
    expect(parseColumnKey('join:vendor.data.account.no')).toEqual({
      source: 'join',
      path: 'vendor.data.account.no',
    });
  });
});

describe('findDuplicateColumns', () => {
  it('finds a repeated field', () => {
    const result = findDuplicateColumns([
      { key: 'field:title', label: 'A' },
      { key: 'field:title', label: 'B' },
    ]);
    expect(result.duplicateKeys).toEqual(['field:title']);
  });

  it('finds a repeated heading even when the fields differ', () => {
    // Two columns headed "Email" in one sheet is legal and unreadable.
    const result = findDuplicateColumns([
      { key: 'field:vendorEmail', label: 'Email' },
      { key: 'join:vendor.email', label: 'email' },
    ]);
    expect(result.duplicateLabels).toEqual(['Email']);
  });

  it('reports a heading used three times only once', () => {
    const result = findDuplicateColumns([
      { key: 'a:1', label: 'X' },
      { key: 'b:2', label: 'X' },
      { key: 'c:3', label: 'X' },
    ]);
    expect(result.duplicateLabels).toEqual(['X']);
  });

  it('is quiet when everything is distinct', () => {
    const result = findDuplicateColumns([
      { key: 'field:a', label: 'A' },
      { key: 'field:b', label: 'B' },
    ]);
    expect(result.duplicateKeys).toEqual([]);
    expect(result.duplicateLabels).toEqual([]);
  });
});

describe('ZExportConfigSchema', () => {
  it('accepts a minimal config and defaults the optional parts', () => {
    const parsed = ZExportConfigSchema.parse(baseConfig);
    expect(parsed.joins).toEqual([]);
    expect(parsed.filters).toEqual([]);
    expect(parsed.sheetName).toBeUndefined();
  });

  it('rejects a config with no columns', () => {
    expect(ZExportConfigSchema.safeParse({ ...baseConfig, columns: [] }).success).toBe(false);
  });

  it('rejects an unprefixed column key', () => {
    // Without the prefix the runner cannot tell a raw OCR key called "title"
    // from the document's own title.
    const result = ZExportConfigSchema.safeParse({
      ...baseConfig,
      columns: [{ key: 'title', label: 'Title' }],
    });
    expect(result.success).toBe(false);
  });

  it.each([
    ['Sheet:1', 'colon'],
    ['a/b', 'slash'],
    ['a\\b', 'backslash'],
    ['what?', 'question mark'],
    ['star*', 'asterisk'],
    ['[bracket]', 'brackets'],
  ])('rejects the sheet name %s (%s)', (sheetName) => {
    // Excel refuses to open a workbook whose sheet name contains these, and
    // reports it as corrupt rather than repairing it.
    expect(ZExportConfigSchema.safeParse({ ...baseConfig, sheetName }).success).toBe(false);
  });

  it('rejects a sheet name over 31 characters', () => {
    const result = ZExportConfigSchema.safeParse({
      ...baseConfig,
      sheetName: 'x'.repeat(32),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a sheet name of exactly 31 characters', () => {
    expect(ZExportConfigSchema.safeParse({ ...baseConfig, sheetName: 'x'.repeat(31) }).success).toBe(
      true,
    );
  });

  it('rejects a join alias that would break the key format', () => {
    const result = ZExportConfigSchema.safeParse({
      ...baseConfig,
      joins: [{ id: 'metadata', alias: 'my vendor', options: {} }],
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid join and defaults its options', () => {
    const parsed = ZExportConfigSchema.parse({
      ...baseConfig,
      joins: [{ id: 'metadata', alias: 'vendor' }],
    });
    expect(parsed.joins[0].options).toEqual({});
  });

  it('validates each filter against its own shape', () => {
    const good = ZExportConfigSchema.safeParse({
      ...baseConfig,
      filters: [
        { id: 'status', value: { kind: 'select', value: ['READY'] } },
        { id: 'amount', value: { kind: 'numberRange', min: 100, max: null } },
      ],
    });
    expect(good.success).toBe(true);

    const bad = ZExportConfigSchema.safeParse({
      ...baseConfig,
      filters: [{ id: 'amount', value: { kind: 'numberRange', min: 'lots', max: null } }],
    });
    expect(bad.success).toBe(false);
  });

  it('rejects a non-ISO date range', () => {
    const result = ZExportConfigSchema.safeParse({
      ...baseConfig,
      filters: [{ id: 'received', value: { kind: 'dateRange', from: '2026-06-01', to: null } }],
    });
    expect(result.success).toBe(false);
  });
});
