/**
 * The signer list on a metadata record.
 *
 * A vendor's invoice is rarely signed by one person — an approval chain runs
 * through an approver, a signer, and often a finance address in copy. The
 * directory previously held exactly one signer, so a workflow could only ever
 * ask a single named person, and any real chain had to be assembled by hand on
 * every document.
 *
 * Stored on `MetadataRecord.data.signers` as an ordered array. Position IS the
 * signing order — first in the list signs first — so there is no separate index
 * to keep consistent with the array, and reordering is a move rather than a
 * renumber.
 *
 * `data` is free-form JSON and the workflow lookup already spreads it whole, so
 * `{{vars.vendor.signers}}` resolves with no storage or lookup change. This file
 * only defines the shape and the two conversions: spreadsheet cell ⇄ array.
 */

export const SIGNER_ROLES = ['SIGNER', 'APPROVER', 'CC', 'VIEWER'] as const;

export type SignerRole = (typeof SIGNER_ROLES)[number];

export type MetadataSigner = {
  email: string;
  /** Display name. Optional — an address alone is a usable recipient. */
  name?: string;
  role: SignerRole;
};

/** Whether signers are asked in turn or all at once. */
export type MetadataSigningOrder = 'SEQUENTIAL' | 'PARALLEL';

/**
 * Default for a record with more than one signer.
 *
 * Sequential, because a list whose order carries no meaning would make the
 * ordering in the table decorative — and an approval chain is the reason for
 * having several signers at all.
 */
export const DEFAULT_SIGNING_ORDER: MetadataSigningOrder = 'SEQUENTIAL';

const isEmail = (value: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

const asRole = (value: string | undefined): SignerRole | null => {
  const upper = (value ?? '').trim().toUpperCase();
  return (SIGNER_ROLES as readonly string[]).includes(upper) ? (upper as SignerRole) : null;
};

export type ParsedSignersCell = {
  signers: MetadataSigner[];
  /** Human-readable problems, one per offending entry. Never throws. */
  warnings: string[];
};

/**
 * Parse the spreadsheet cell: `email|role|name`, entries separated by `;`.
 *
 *   jane@x.com|SIGNER|Jane Doe;bob@x.com|APPROVER|Bob Reid
 *
 * Only the email is required, so `jane@x.com;bob@x.com` is valid shorthand and
 * both default to SIGNER. Order in the cell is the signing order.
 *
 * Deliberately forgiving, and reports rather than rejects. A single mistyped
 * role in a two-hundred-row import should not fail the file — the row still
 * carries a usable address, and the warning says exactly what was assumed.
 */
export const parseSignersCell = (raw: string | null | undefined): ParsedSignersCell => {
  const text = (raw ?? '').trim();

  if (!text) {
    return { signers: [], warnings: [] };
  }

  const signers: MetadataSigner[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  // Newlines are accepted alongside `;` because a wrapped cell in Excel is a
  // common way to make a long list readable.
  for (const entry of text.split(/[;\n]/)) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const [rawEmail = '', rawRole = '', ...rest] = trimmed.split('|').map((p) => p.trim());
    const email = rawEmail.toLowerCase();

    if (!isEmail(email)) {
      warnings.push(`"${trimmed}" is not a valid email address and was skipped`);
      continue;
    }

    // The same person twice would create two recipients on one document and ask
    // them to sign it twice.
    if (seen.has(email)) {
      warnings.push(`"${email}" appears more than once and the repeat was dropped`);
      continue;
    }
    seen.add(email);

    const role = asRole(rawRole);

    if (rawRole && !role) {
      warnings.push(`"${rawRole}" is not a known role for ${email} — treated as SIGNER`);
    }

    signers.push({
      email,
      role: role ?? 'SIGNER',
      // Anything after the role is the display name, so a name containing a
      // pipe does not silently truncate.
      ...(rest.length ? { name: rest.join('|') } : {}),
    });
  }

  return { signers, warnings };
};

/** Serialise back to the cell format, so an export/edit/import round-trip is lossless. */
export const formatSignersCell = (signers: MetadataSigner[]): string =>
  signers
    .filter((s) => s.email.trim())
    .map((s) => [s.email.trim(), s.role, s.name?.trim()].filter(Boolean).join('|'))
    .join(';');

/**
 * The signers on a record, whatever era it was written in.
 *
 * Records created before the list existed carry a single `signerEmail` /
 * `signerName` / `signerRole`. Those are read as a one-entry list rather than
 * migrated, so an organization's existing directory and its live workflows keep
 * working untouched — including the `{{vars.vendor.signerEmail}}` placeholder,
 * which is still populated for exactly that reason.
 */
export const readRecordSigners = (data: unknown): MetadataSigner[] => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return [];
  }

  const bag = data as Record<string, unknown>;

  if (Array.isArray(bag.signers)) {
    const signers: MetadataSigner[] = [];
    const seen = new Set<string>();

    for (const entry of bag.signers) {
      if (!entry || typeof entry !== 'object') continue;

      const row = entry as Record<string, unknown>;
      const email = String(row.email ?? '').trim().toLowerCase();

      if (!isEmail(email) || seen.has(email)) continue;
      seen.add(email);

      const name = row.name === undefined || row.name === null ? '' : String(row.name).trim();

      signers.push({
        email,
        role: asRole(typeof row.role === 'string' ? row.role : undefined) ?? 'SIGNER',
        ...(name ? { name } : {}),
      });
    }

    return signers;
  }

  // Legacy single-signer record.
  const email = String(bag.signerEmail ?? '').trim().toLowerCase();

  if (!isEmail(email)) {
    return [];
  }

  const name = String(bag.signerName ?? '').trim();

  return [
    {
      email,
      role: asRole(typeof bag.signerRole === 'string' ? bag.signerRole : undefined) ?? 'SIGNER',
      ...(name ? { name } : {}),
    },
  ];
};

/** The record's signing order, defaulting by list length. */
export const readRecordSigningOrder = (data: unknown): MetadataSigningOrder => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return DEFAULT_SIGNING_ORDER;
  }

  const raw = String((data as Record<string, unknown>).signingOrder ?? '')
    .trim()
    .toUpperCase();

  return raw === 'PARALLEL' || raw === 'SEQUENTIAL' ? raw : DEFAULT_SIGNING_ORDER;
};

/**
 * The `data` fields to write for a signer list.
 *
 * The legacy scalars are kept in step with the first signer so that a workflow
 * still reading `{{vars.vendor.signerEmail}}` keeps resolving after a record is
 * edited in the new table. Dropping them would break live workflows silently —
 * the placeholder would render empty and the send would go nowhere.
 */
export const writeRecordSigners = (
  signers: MetadataSigner[],
  signingOrder: MetadataSigningOrder = DEFAULT_SIGNING_ORDER,
): Record<string, unknown> => {
  const first = signers[0];

  return {
    signers,
    signingOrder,
    signerEmail: first?.email ?? '',
    signerName: first?.name ?? '',
    signerRole: first?.role ?? '',
  };
};
