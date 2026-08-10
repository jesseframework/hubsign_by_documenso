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
  'Signer name',
  'Signer email',
  'Signer role',
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
  | 'signerName'
  | 'signerEmail'
  | 'signerRole';

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

  // Who signs documents from this vendor. Kept on the same row as the vendor so
  // one record drives both the confirmation email and the signature request.
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
};

/**
 * Upper bound on rows per import. Guards the request size and the sequential
 * upsert loop; a directory this size is already far past what anyone maintains
 * by hand.
 */
export const MAX_METADATA_IMPORT_ROWS = 1000;

/** Example rows shipped in the template so the expected shape is self-evident. */
const TEMPLATE_EXAMPLE_ROWS: string[][] = [
  // One row per vendor carries both halves of the invoice flow: `Email` is
  // where the receipt confirmation goes, `Signer *` is who gets asked to sign.
  [
    'vendor',
    'Skidd View Ltd.',
    'Jane Doe',
    'accounts@skiddview.com',
    '',
    '+1 555 0100',
    'skidd, skidd view, consulting',
    '',
    'Alex Kim',
    'alex.kim@example.com',
    'SIGNER',
  ],
  [
    'vendor',
    'Northgate Supplies',
    'Sam Patel',
    'accounts@northgate.com',
    '',
    '',
    'northgate',
    'Flow Bill v2.0',
    'Dana Reid',
    'dana.reid@example.com',
    'APPROVER',
  ],
  // A vendor with no signer set is still valid — it just gets the confirmation
  // email and stops there.
  ['vendor', 'Acme Freight', 'Billing Dept', 'billing@acmefreight.com', '', '', 'acme', '', '', '', ''],
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

export const buildMetadataTemplateCsv = (): string =>
  UTF8_BOM + toCsv([METADATA_IMPORT_COLUMNS, ...TEMPLATE_EXAMPLE_ROWS]);

/**
 * Split a keywords cell. Accepts semicolons as well as commas: a comma-bearing
 * cell has to be quoted in CSV, and hand-edited files frequently aren't.
 */
export const parseKeywordsCell = (value: string): string[] =>
  value
    .split(/[,;]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
