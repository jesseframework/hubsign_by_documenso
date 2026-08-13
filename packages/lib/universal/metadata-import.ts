/**
 * Shared contract for the Metadata spreadsheet import.
 *
 * The downloadable template, the CSV parser, and the server-side bulk upsert
 * all read their column names from here so the three can't drift apart — a
 * renamed column in the template would otherwise silently stop importing.
 */

/** Column headers, in the order they appear in the downloadable template. */
export const METADATA_IMPORT_COLUMNS = [
  'Category',
  'Name',
  'Contact name',
  'Email',
  'Role',
  'Phone',
  'Keywords',
  'OCR template',
  'Signers',
  'SLA internal hours',
  'SLA signing hours',
  'SLA end-to-end hours',
  'Terms code',
] as const;

/** The fields a parsed row can carry, keyed by our internal names. */
export type MetadataImportField =
  | 'category'
  | 'label'
  | 'contactName'
  | 'email'
  | 'role'
  | 'phone'
  | 'keywords'
  | 'ocrTemplate'
  | 'signers'
  | 'signerName'
  | 'signerEmail'
  | 'signerRole'
  | 'slaInternalHours'
  | 'slaEndToEndHours'
  | 'slaSigningHours'
  | 'termsCode';

/**
 * Header text (lowercased, trimmed) → internal field. Generous on purpose:
 * people rename columns, paste from other systems, and keep the parenthetical
 * hints from the on-screen form. Anything unrecognised is ignored rather than
 * failing the import.
 */
export const METADATA_IMPORT_HEADER_ALIASES: Record<string, MetadataImportField> = {
  category: 'category',
  type: 'category',
  group: 'category',

  name: 'label',
  'name (lookup key)': 'label',
  'lookup key': 'label',
  label: 'label',
  vendor: 'label',
  'vendor name': 'label',
  'company name': 'label',

  'contact name': 'contactName',
  contactname: 'contactName',
  contact: 'contactName',
  'contact person': 'contactName',

  email: 'email',
  'email address': 'email',
  'e-mail': 'email',

  role: 'role',
  'signing role': 'role',

  phone: 'phone',
  'phone number': 'phone',
  telephone: 'phone',
  mobile: 'phone',

  keywords: 'keywords',
  'keywords (comma-separated)': 'keywords',
  keyword: 'keywords',
  tags: 'keywords',

  // Written as the template's NAME — the BMS ML API takes a numeric id, so the
  // name is resolved against the org's template list on import.
  'ocr template': 'ocrTemplate',
  ocrtemplate: 'ocrTemplate',
  template: 'ocrTemplate',
  'template name': 'ocrTemplate',
  'extraction template': 'ocrTemplate',

  // The whole approval chain in one cell: `email|role|name`, entries separated
  // by `;`, and the order in the cell IS the signing order. One column rather
  // than a numbered block because five signers across three fields each would
  // widen the sheet to 25 columns, most of them blank on most rows.
  signers: 'signers',
  'signer list': 'signers',
  'signing chain': 'signers',
  'approval chain': 'signers',

  // The single-signer columns from before the chain existed. Still read, so a
  // spreadsheet someone saved last month imports unchanged.
  'signer name': 'signerName',
  signername: 'signerName',
  'signee name': 'signerName',
  'approver name': 'signerName',

  'signer email': 'signerEmail',
  signeremail: 'signerEmail',
  'signee email': 'signerEmail',
  'approver email': 'signerEmail',

  'signer role': 'signerRole',
  signerrole: 'signerRole',
  'signee role': 'signerRole',

  // Turnaround targets in BUSINESS hours; blank means "use the org default".
  'terms code': 'termsCode',
  termscode: 'termsCode',
  terms: 'termsCode',
  'payment terms': 'termsCode',
  'payment term': 'termsCode',
  'credit terms': 'termsCode',
  net: 'termsCode',

  'sla internal hours': 'slaInternalHours',
  slainternalhours: 'slaInternalHours',
  'internal sla': 'slaInternalHours',
  'sla hours': 'slaInternalHours',

  'sla end-to-end hours': 'slaEndToEndHours',
  'sla end to end hours': 'slaEndToEndHours',
  slaendtoendhours: 'slaEndToEndHours',
  'end to end sla': 'slaEndToEndHours',

  'sla signing hours': 'slaSigningHours',
  slasigninghours: 'slaSigningHours',
  'signing sla': 'slaSigningHours',
  'sla signing': 'slaSigningHours',
};

/**
 * Upper bound on rows per import. Guards the request size and the sequential
 * upsert loop; a directory this size is already far past what anyone maintains
 * by hand.
 */
export const MAX_METADATA_IMPORT_ROWS = 1000;

/**
 * Example rows shipped in the template so the expected shape is self-evident.
 *
 * The three deliberately show the three shapes of the Signers cell: a full
 * chain, a single signer, and none at all.
 */
const TEMPLATE_EXAMPLE_ROWS: string[][] = [
  // One row per vendor carries both halves of the invoice flow: `Email` is
  // where the receipt confirmation goes, `Signers` is who gets asked to sign.
  //
  // Chain of three. Order in the cell is the order they are asked, so Alex signs
  // first and Finance is only copied at the end.
  [
    'vendor',
    'Skidd View Ltd.',
    'Jane Doe',
    'accounts@skiddview.com',
    '',
    '+1 555 0100',
    'skidd, skidd view, consulting',
    '',
    'alex.kim@example.com|SIGNER|Alex Kim;dana.reid@example.com|APPROVER|Dana Reid;ap@skiddview.com|CC|Finance',
    '8',
    '48',
    '72',
    '30d',
  ],
  // Just an address: role defaults to SIGNER and the name is optional.
  [
    'vendor',
    'Northgate Supplies',
    'Sam Patel',
    'accounts@northgate.com',
    '',
    '',
    'northgate',
    'Flow Bill v2.0',
    'dana.reid@example.com',
    '24',
    '',
    '120',
    'net45',
  ],
  // A vendor with no signer set is still valid — it just gets the confirmation
  // email and stops there.
  ['vendor', 'Acme Freight', 'Billing Dept', 'billing@acmefreight.com', '', '', 'acme', '', '', '', '', '', '0d'],
];

/** RFC 4180 quoting — only quote when the value would otherwise break the row. */
const csvCell = (value: string): string =>
  /["\r\n,]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const toCsv = (rows: readonly (readonly string[])[]): string =>
  rows.map((row) => row.map(csvCell).join(',')).join('\r\n');

/**
 * The template file's contents.
 *
 * Prefixed with a UTF-8 BOM because Excel otherwise decodes the file as the
 * local ANSI codepage — which mangles any accented vendor name on the round
 * trip out and back in.
 */
const UTF8_BOM = '﻿';

/**
 * The template file's contents, with the org's own fields appended.
 *
 * Custom columns go after the built-in ones and carry the field's label as the
 * header, because that is the name the person filling the sheet in sees on the
 * form. The example rows are padded to match so every row has the same number of
 * cells — a short row is legal CSV but reads as corrupt in Excel.
 *
 * A SELECT field lists its options in the first example row rather than leaving
 * the cell blank: the allowed values are otherwise invisible until an import
 * rejects them.
 */
export const buildMetadataTemplateCsv = (
  customFields: readonly { label: string; type?: string; options?: string[] }[] = [],
): string => {
  const headers = [...METADATA_IMPORT_COLUMNS, ...customFields.map((field) => field.label)];

  const rows = TEMPLATE_EXAMPLE_ROWS.map((row, rowIndex) => [
    ...row,
    ...customFields.map((field) =>
      rowIndex === 0 && field.type === 'SELECT' && field.options?.length
        ? field.options.join(' / ')
        : '',
    ),
  ]);

  return UTF8_BOM + toCsv([headers, ...rows]);
};

/**
 * Which column of a parsed row holds a custom field's value.
 *
 * `transformHeader` lowercases anything it does not recognise, so a column
 * titled "GL Account" arrives as `gl account`. Both the label and the storage key
 * are accepted: an export or a sheet written against the API would use the key.
 */
export const readCustomFieldCell = (
  row: Record<string, string>,
  field: { key: string; label: string },
): string | undefined => {
  const candidates = [field.label.trim().toLowerCase(), field.key.toLowerCase(), field.key];

  for (const candidate of candidates) {
    const value = row[candidate];

    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }

  return undefined;
};

/**
 * Split a keywords cell. Accepts semicolons as well as commas: a comma-bearing
 * cell has to be quoted in CSV, and hand-edited files frequently aren't.
 */
export const parseKeywordsCell = (value: string): string[] =>
  value
    .split(/[,;]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
