import { describe, expect, it } from 'vitest';

import {
  formatSignersCell,
  parseSignersCell,
  readRecordSigners,
  readRecordSigningOrder,
  writeRecordSigners,
} from './metadata-signers';

/**
 * The spreadsheet cell is the fragile half of this feature: it is hand-edited in
 * Excel, so it must survive typos without failing the import, and a round-trip
 * through a spreadsheet must not lose a signer or reorder a chain.
 *
 * The back-compat block matters just as much. Records written before this
 * existed carry a single `signerEmail`, and a live workflow still reads
 * `{{vars.vendor.signerEmail}}` — breaking either would stop real sends with no
 * error, because an unresolved placeholder renders as empty string.
 */

describe('parseSignersCell', () => {
  it('reads a full chain and preserves order', () => {
    const { signers, warnings } = parseSignersCell(
      'jane@x.com|SIGNER|Jane Doe;bob@x.com|APPROVER|Bob Reid;ap@x.com|CC|Finance',
    );

    expect(warnings).toEqual([]);
    expect(signers).toEqual([
      { email: 'jane@x.com', role: 'SIGNER', name: 'Jane Doe' },
      { email: 'bob@x.com', role: 'APPROVER', name: 'Bob Reid' },
      { email: 'ap@x.com', role: 'CC', name: 'Finance' },
    ]);
  });

  it('accepts bare addresses as SIGNER', () => {
    const { signers } = parseSignersCell('jane@x.com;bob@x.com');
    expect(signers.map((s) => [s.email, s.role])).toEqual([
      ['jane@x.com', 'SIGNER'],
      ['bob@x.com', 'SIGNER'],
    ]);
  });

  it('is case-insensitive on role and address', () => {
    const { signers } = parseSignersCell('JANE@X.COM|approver');
    expect(signers[0]).toEqual({ email: 'jane@x.com', role: 'APPROVER' });
  });

  it('tolerates whitespace and a trailing separator', () => {
    const { signers } = parseSignersCell('  jane@x.com | SIGNER | Jane Doe ; ');
    expect(signers).toEqual([{ email: 'jane@x.com', role: 'SIGNER', name: 'Jane Doe' }]);
  });

  it('splits on newlines too, for a wrapped cell', () => {
    const { signers } = parseSignersCell('jane@x.com|SIGNER\nbob@x.com|APPROVER');
    expect(signers.length).toBe(2);
  });

  it('reports an unknown role instead of failing, and defaults to SIGNER', () => {
    const { signers, warnings } = parseSignersCell('jane@x.com|APROVER');
    expect(signers[0].role).toBe('SIGNER');
    expect(warnings.length).toBe(1);
    expect(warnings[0].includes('APROVER')).toBe(true);
  });

  it('skips an unusable address and says which', () => {
    const { signers, warnings } = parseSignersCell('not-an-email;bob@x.com');
    expect(signers.map((s) => s.email)).toEqual(['bob@x.com']);
    expect(warnings[0].includes('not-an-email')).toBe(true);
  });

  it('drops a repeated address — one person cannot sign the same document twice', () => {
    const { signers, warnings } = parseSignersCell('jane@x.com|SIGNER;JANE@x.com|APPROVER');
    expect(signers.length).toBe(1);
    expect(warnings[0].includes('more than once')).toBe(true);
  });

  it('keeps a name containing a pipe intact', () => {
    const { signers } = parseSignersCell('jane@x.com|SIGNER|Doe|Jane');
    expect(signers[0].name).toBe('Doe|Jane');
  });

  it('returns nothing for an empty cell', () => {
    for (const value of ['', '   ', null, undefined]) {
      expect(parseSignersCell(value).signers).toEqual([]);
    }
  });
});

describe('formatSignersCell', () => {
  it('round-trips through a spreadsheet without loss', () => {
    const cell = 'jane@x.com|SIGNER|Jane Doe;bob@x.com|APPROVER|Bob Reid';
    expect(formatSignersCell(parseSignersCell(cell).signers)).toBe(cell);
  });

  it('omits an absent name', () => {
    expect(formatSignersCell([{ email: 'jane@x.com', role: 'CC' }])).toBe('jane@x.com|CC');
  });
});

describe('readRecordSigners', () => {
  it('reads the array form', () => {
    const signers = readRecordSigners({
      signers: [
        { email: 'jane@x.com', role: 'SIGNER', name: 'Jane' },
        { email: 'bob@x.com', role: 'APPROVER' },
      ],
    });
    expect(signers.length).toBe(2);
    expect(signers[1]).toEqual({ email: 'bob@x.com', role: 'APPROVER' });
  });

  it('reads a legacy single-signer record as a one-entry chain', () => {
    // Every record in an existing directory looks like this.
    expect(
      readRecordSigners({
        signerEmail: 'Jane@X.com',
        signerName: 'Jane Doe',
        signerRole: 'APPROVER',
      }),
    ).toEqual([{ email: 'jane@x.com', role: 'APPROVER', name: 'Jane Doe' }]);
  });

  it('prefers the array when a record carries both', () => {
    const signers = readRecordSigners({
      signers: [{ email: 'new@x.com', role: 'SIGNER' }],
      signerEmail: 'old@x.com',
    });
    expect(signers).toEqual([{ email: 'new@x.com', role: 'SIGNER' }]);
  });

  it('ignores malformed entries rather than producing a broken recipient', () => {
    const signers = readRecordSigners({
      signers: [{ email: 'nope' }, null, 'string', { email: 'ok@x.com' }],
    });
    expect(signers).toEqual([{ email: 'ok@x.com', role: 'SIGNER' }]);
  });

  it('returns nothing for a record with no signer at all', () => {
    for (const data of [null, undefined, {}, { keywords: ['x'] }, []]) {
      expect(readRecordSigners(data)).toEqual([]);
    }
  });
});

describe('readRecordSigningOrder', () => {
  it('defaults to sequential', () => {
    expect(readRecordSigningOrder({})).toBe('SEQUENTIAL');
    expect(readRecordSigningOrder(null)).toBe('SEQUENTIAL');
    expect(readRecordSigningOrder({ signingOrder: 'nonsense' })).toBe('SEQUENTIAL');
  });

  it('honours an explicit parallel', () => {
    expect(readRecordSigningOrder({ signingOrder: 'PARALLEL' })).toBe('PARALLEL');
    expect(readRecordSigningOrder({ signingOrder: 'parallel' })).toBe('PARALLEL');
  });
});

describe('writeRecordSigners', () => {
  it('keeps the legacy scalars pointed at the first signer', () => {
    // A workflow still reading {{vars.vendor.signerEmail}} must keep resolving
    // after a record is edited in the new table.
    const written = writeRecordSigners([
      { email: 'jane@x.com', role: 'SIGNER', name: 'Jane Doe' },
      { email: 'bob@x.com', role: 'APPROVER' },
    ]);

    expect(written.signerEmail).toBe('jane@x.com');
    expect(written.signerName).toBe('Jane Doe');
    expect(written.signerRole).toBe('SIGNER');
    expect(written.signingOrder).toBe('SEQUENTIAL');
  });

  it('clears the legacy scalars when the chain is emptied', () => {
    const written = writeRecordSigners([]);
    expect(written.signerEmail).toBe('');
    expect(written.signers).toEqual([]);
  });
});
