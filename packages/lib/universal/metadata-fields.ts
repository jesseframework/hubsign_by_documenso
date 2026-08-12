/**
 * Organization-defined fields on a metadata record.
 *
 * The directory ships with the fields the product itself needs — contact, role,
 * phone, keywords, SLA, terms, signers. Every organization then has its own: a
 * GL account, a tax number, a purchasing contract reference, whether a supplier
 * is approved. Those cannot be guessed in advance and adding a column to the
 * schema for each of them is not a workable answer.
 *
 * `MetadataRecord.data` is already jsonb and the workflow lookup already spreads
 * the whole bag into its result, so a value stored under a new key is reachable
 * as `{{vars.vendor.glAccount}}` the moment it exists. What was missing was a
 * *definition*: without one, nothing knows the field exists, so the form cannot
 * render it, the table cannot show it, and the spreadsheet cannot carry it.
 *
 * This module is the shared contract between the form, the CSV template, the CSV
 * parser and the server. It is pure so the coercion rules can be tested without
 * a database, and so the client refuses the same values the server would.
 */

/** What kind of value a field holds. Deliberately few — each one is a renderer,
 * a coercion rule, a display format and a CSV round-trip. */
export const METADATA_FIELD_TYPES = ['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT'] as const;

export type MetadataFieldType = (typeof METADATA_FIELD_TYPES)[number];

export type MetadataFieldDefinitionLike = {
  key: string;
  label: string;
  type: MetadataFieldType;
  /** Allowed values for SELECT. Ignored for every other type. */
  options?: string[];
  helpText?: string | null;
  required?: boolean;
};

/**
 * Keys the product itself writes into `MetadataRecord.data`.
 *
 * A custom field shares that one bag, so a field defined as "Terms code" would
 * land on `termsCode` and silently overwrite the value the aging report reads —
 * a field that appears to work while breaking something else entirely. Names
 * that collide are refused at definition time instead.
 *
 * The legacy single-signer keys are included: records written before the signer
 * chain existed still carry them, and `readRecordSigners` still reads them.
 */
export const RESERVED_METADATA_DATA_KEYS = [
  'contactName',
  'role',
  'phone',
  'keywords',
  'ocrTemplateId',
  'ocrTemplateName',
  'signers',
  'signingOrder',
  'signerEmail',
  'signerName',
  'signerRole',
  'slaInternalHours',
  'slaEndToEndHours',
  'termsCode',
] as const;

const RESERVED_LOWER = new Set(RESERVED_METADATA_DATA_KEYS.map((key) => key.toLowerCase()));

/** Longest a derived key may be, so a pasted sentence cannot become a column. */
const MAX_KEY_LENGTH = 60;

/**
 * The storage key a label implies: `GL account` → `glAccount`.
 *
 * Derived rather than typed by hand, because the key is what workflow templates
 * reference (`{{vars.vendor.glAccount}}`) and a field whose key and label were
 * separately editable would let a rename quietly break every workflow using it.
 * camelCase to match the keys the product already writes into the same bag.
 */
export const deriveMetadataFieldKey = (label: string): string => {
  const words = label
    .trim()
    .toLowerCase()
    // Anything that is not a letter or digit is a word break — spaces, slashes,
    // hyphens, the "#" in "PO #".
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return '';
  }

  const key = words
    .map((word, index) => (index === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join('');

  // A key must not start with a digit: it would be awkward in a template
  // expression and reads as an index rather than a name.
  return (/^[0-9]/.test(key) ? `f${key}` : key).slice(0, MAX_KEY_LENGTH);
};

/** Whether a derived key would collide with one the product writes itself. */
export const isReservedMetadataFieldKey = (key: string): boolean =>
  RESERVED_LOWER.has(key.trim().toLowerCase());

export type CoercedFieldValue =
  | { ok: true; value: string | number | boolean | null }
  | { ok: false; message: string };

/**
 * A raw cell or input value, as the type the field promises — or a reason it
 * cannot be.
 *
 * Blank always means "not set" and clears the key, which is how a value gets
 * removed once it has been saved. Refusing rather than guessing matters most for
 * NUMBER and DATE: a number that silently became 0, or a date that silently
 * became today, is worse than an empty field, because it looks like data.
 */
export const coerceMetadataFieldValue = (
  definition: MetadataFieldDefinitionLike,
  raw: unknown,
): CoercedFieldValue => {
  const { label, type } = definition;

  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }

  if (type === 'BOOLEAN') {
    if (typeof raw === 'boolean') {
      return { ok: true, value: raw };
    }

    const text = String(raw).trim().toLowerCase();

    if (text === '') {
      return { ok: true, value: null };
    }
    if (['true', 'yes', 'y', '1'].includes(text)) {
      return { ok: true, value: true };
    }
    if (['false', 'no', 'n', '0'].includes(text)) {
      return { ok: true, value: false };
    }

    return { ok: false, message: `${label} must be yes or no (got "${raw}").` };
  }

  const text = String(raw).trim();

  if (text === '') {
    return { ok: true, value: null };
  }

  if (type === 'NUMBER') {
    // Tolerates what spreadsheets produce: thousands separators, a currency
    // symbol, a trailing space.
    const cleaned = text.replace(/[,\s]/g, '').replace(/^[$£€]/, '');
    const parsed = Number(cleaned);

    if (!Number.isFinite(parsed)) {
      return { ok: false, message: `${label} must be a number (got "${text}").` };
    }

    return { ok: true, value: parsed };
  }

  if (type === 'DATE') {
    // ISO only, and stored as the text `YYYY-MM-DD`. All-numeric slash forms are
    // refused for the same reason the invoice reader refuses them: 03/04/2026 is
    // two different days depending on who typed it, and picking one would be
    // wrong for half the world with nothing to show that it happened.
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);

    if (!match) {
      return { ok: false, message: `${label} must be a date as YYYY-MM-DD (got "${text}").` };
    }

    const parsed = new Date(`${text}T00:00:00.000Z`);

    if (Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(text)) {
      return { ok: false, message: `${label} is not a real date ("${text}").` };
    }

    return { ok: true, value: text };
  }

  if (type === 'SELECT') {
    const options = definition.options ?? [];

    // No options configured means the field cannot be satisfied at all; say that
    // rather than rejecting whatever the user typed as "not one of ()".
    if (options.length === 0) {
      return { ok: false, message: `${label} has no options configured yet.` };
    }

    const matched = options.find((option) => option.toLowerCase() === text.toLowerCase());

    if (!matched) {
      return {
        ok: false,
        message: `${label} must be one of: ${options.join(', ')} (got "${text}").`,
      };
    }

    // The configured spelling wins, so the stored value is consistent whatever
    // case the spreadsheet used.
    return { ok: true, value: matched };
  }

  return { ok: true, value: text };
};

/** A stored value as text — for the table, the form input and the CSV cell. */
export const formatMetadataFieldValue = (
  definition: MetadataFieldDefinitionLike,
  value: unknown,
): string => {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  if (definition.type === 'BOOLEAN') {
    return value === true || value === 'true' ? 'Yes' : 'No';
  }

  return String(value);
};

/**
 * Coerce every defined field present on a record's data bag.
 *
 * Keys with no definition are passed through untouched — that is what carries
 * the product's own built-in keys, and what keeps a value written before its
 * field was deleted from being thrown away.
 */
export const coerceMetadataFieldValues = (
  definitions: MetadataFieldDefinitionLike[],
  data: Record<string, unknown>,
): { data: Record<string, unknown>; errors: string[] } => {
  const out: Record<string, unknown> = { ...data };
  const errors: string[] = [];

  for (const definition of definitions) {
    if (!(definition.key in out)) {
      if (definition.required) {
        errors.push(`${definition.label} is required.`);
      }
      continue;
    }

    const result = coerceMetadataFieldValue(definition, out[definition.key]);

    if (!result.ok) {
      errors.push(result.message);
      continue;
    }

    if (result.value === null) {
      if (definition.required) {
        errors.push(`${definition.label} is required.`);
      }

      // Cleared rather than stored as null: an absent key and a null both read
      // as "not set" everywhere else, and only one of them survives a template.
      delete out[definition.key];
      continue;
    }

    out[definition.key] = result.value;
  }

  return { data: out, errors };
};
