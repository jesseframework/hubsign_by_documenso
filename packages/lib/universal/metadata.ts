/**
 * Normalize a metadata lookup key so directory entries and runtime lookups match
 * regardless of case, punctuation, or spacing — e.g. "Northgate Consulting Ltd.",
 * "northgate consulting ltd", and "Northgate  Consulting  LTD" all collapse to
 * the same key. Used by both the metadata router (on save) and the
 * LOOKUP_METADATA workflow action (on lookup).
 */
export const normalizeMetadataKey = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
