/**
 * Keyword matching for directory lookups.
 *
 * The sibling of [[vendor-match]]: where that one asks "is this the same name",
 * this one asks "does this word appear in this document". It backs KEYWORD mode
 * on the LOOKUP_METADATA workflow action, where each metadata record carries a
 * list of keywords and the first record whose keyword appears in a document's
 * text wins.
 *
 * The bias here differs from vendor-match's. A keyword list is a deliberately
 * loose net — a person adds "northgate" precisely so it catches whatever the
 * page happens to say — so the job is not to be clever about near-misses but to
 * avoid the one failure that a loose net makes easy: matching a keyword that is
 * really a fragment of some longer, unrelated word.
 */

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Does `keyword` appear in `haystack` as a whole word (or whole phrase)?
 *
 * A plain substring test made every short keyword a liability — "it" matched
 * "unit", "po" matched "deposit" — and the more text being scanned, the more
 * often that fires. Whole-word matching is what people already assume keywords
 * do, so this mostly removes surprises rather than adding a rule.
 *
 * The bounds are letter/digit lookarounds rather than `\b` because a keyword
 * frequently starts or ends in punctuation — "acme-corp", "&co", "5.00" — and
 * `\b` refuses those outright: it anchors to a word-character edge, which a
 * leading "&" does not have. Matching is case-insensitive, and the keyword is
 * escaped, so a "." in a keyword means a literal dot rather than any character.
 */
export const containsKeyword = (haystack: string, keyword: string): boolean => {
  try {
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExp(keyword)}(?![\\p{L}\\p{N}])`,
      'iu',
    );
    return pattern.test(haystack);
  } catch {
    // A keyword that will not compile — a lone surrogate from a bad paste, say
    // — degrades to a substring test rather than failing the whole lookup and
    // stalling the workflow run.
    return haystack.includes(keyword);
  }
};

/**
 * Splits a stored keyword value into normalised keywords.
 *
 * Accepts either an array or a delimited string, because the value arrives from
 * three places that each write it differently: the metadata form, a CSV import,
 * and the API. Semicolons count as separators alongside commas — a CSV cell
 * containing commas has to be quoted, and hand-edited files frequently are not,
 * so "a; b; c" survives a round trip where unquoted "a, b, c" does not.
 */
export const parseKeywords = (raw: unknown): string[] => {
  const list = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === 'string'
      ? raw.split(/[,;]/)
      : [];

  return list.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean);
};
