/**
 * Fuzzy vendor-name matching for directory lookups.
 *
 * The name on an invoice is whatever OCR read off the page, and the name in the
 * metadata directory is whatever a person typed months ago. They agree far less
 * often than you would expect: "Company Limited" against "Company Ltd.",
 * "ACME & Sons" against "Acme and Sons", a dropped suffix, a scanning slip.
 * Exact-key lookup misses all of these silently — the workflow simply finds
 * nothing and does nothing, which looks identical to "no rule applied".
 *
 * Matching runs in three widening stages, and stops at the first that answers:
 *
 *   1. EXACT       identical once case, punctuation and spacing are normalised.
 *   2. CORE        identical once the legal form is also removed, so "Ltd",
 *                  "Limited", "LLC" and no suffix at all are one company.
 *   3. FUZZY       similar enough by character and token overlap.
 *
 * The bias throughout is towards precision, because the two failure directions
 * are not symmetrical. A miss means a workflow quietly does nothing and someone
 * notices the invoice sitting there. A WRONG match means a payment confirmation
 * addressed to a different company, or an invoice routed to the wrong approver.
 * So a fuzzy hit must also be unambiguous: if the runner-up scores nearly as
 * well, nothing is returned at all rather than a coin-flip between two vendors.
 */

/**
 * Score at or above which a fuzzy candidate is accepted. Chosen to admit
 * suffix and punctuation drift plus a character or two of OCR noise, while
 * still separating companies that merely share a word.
 */
export const DEFAULT_VENDOR_MATCH_THRESHOLD = 0.85;

/**
 * How far clear of the runner-up the winner must be. Two directory entries
 * scoring 0.90 and 0.89 against the same invoice is not a match, it is a
 * question, and answering it by sort order would be arbitrary.
 */
export const AMBIGUITY_MARGIN = 0.05;

/** Fuzzy matching is not attempted below this many characters in the core name. */
const MIN_FUZZY_CORE_LENGTH = 4;

/**
 * Legal-form tokens that identify the kind of company, not which company.
 *
 * Removed only when something else survives — a vendor genuinely recorded as
 * "Limited" keeps its name rather than becoming the empty string.
 */
const LEGAL_FORM_TOKENS = new Set([
  'ltd', 'ltda', 'limited', 'llc', 'pllc', 'lc', 'llp', 'lllp', 'lp', 'plc', 'inc',
  'incorporated', 'corp', 'corporation', 'co', 'company',
  'gmbh', 'mbh', 'kgaa', 'ag', 'kg', 'ohg', 'bv', 'bvba', 'nv', 'sa', 'sas', 'sarl',
  'srl', 'sro', 'spa', 'sl', 'ooo', 'oao', 'zao', 'jsc', 'pjsc',
  'ab', 'as', 'asa', 'aps', 'oy', 'oyj', 'ehf', 'hf', 'kft', 'zrt', 'doo', 'dd',
  'pty', 'pte', 'sdn', 'bhd', 'pvt', 'pt', 'cv', 'ug', 'se', 'ek', 'fze', 'fzco', 'llp',
]);

/**
 * NOT legal forms, and deliberately absent from the list above: "Group",
 * "Holdings", "Trust", "Foundation", "Partners", "Association", "Institute".
 *
 * These name a different legal person. Treating them as interchangeable suffixes
 * made "Vega Systems Group" and "Vega Systems Ltd" score 0.97 as the same
 * company, which is exactly the leak this module exists to prevent — a parent
 * and its subsidiary are different payees with different bank details.
 */

/** Words that carry no identifying weight at the start of a name. */
const NOISE_TOKENS = new Set(['the', 'and', 'of']);

/**
 * Below this, two aligned tokens are different words rather than one word
 * misread. "consulting"/"consuiting" is a scan artefact at 0.90;
 * "northgate"/"southgate" is a different company at 0.78.
 */
const TOKEN_ALIGNMENT_FLOOR = 0.8;

/** Ceiling applied when the token alignment guard trips. Sits below any threshold. */
const GUARDED_CEILING = 0.8;

/**
 * Case, punctuation and spacing normalisation.
 *
 * Matches `normalizeMetadataKey` in behaviour — directory keys are stored in
 * that form — with the addition of expanding "&", which OCR and typists disagree
 * about constantly.
 */
export const normalizeVendorName = (value: string): string =>
  value
    .normalize('NFKD')
    // Strip diacritics so "Nestlé" and "Nestle" are one vendor.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    // Any letter or digit in any script. An ASCII-only class deleted every
    // Cyrillic, CJK, Greek and Hebrew character, so "Кофе Хаус Ltd" and "Мосгаз
    // Ltd" both reduced to "ltd" and matched each other at a confident 1.00.
    // Note this makes the result no longer byte-identical to
    // `normalizeMetadataKey` for non-Latin names; the two are not interchangeable.
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * The identifying part of the name: normalised, with legal-form and filler
 * words removed.
 *
 * "Northgate Consulting Ltd." and "NORTHGATE CONSULTING LIMITED" both reduce to
 * "northgate consulting".
 */
export const vendorCoreName = (value: string): string => {
  const tokens = normalizeVendorName(value).split(' ').filter(Boolean);
  let start = 0;
  let end = tokens.length;

  // Leading filler only ("The Gleaner Company" → "Gleaner").
  while (start < end && NOISE_TOKENS.has(tokens[start])) start += 1;

  // Legal form is a SUFFIX, and is only stripped there. Removing these tokens
  // wherever they appear treats "Company Limited" as having no name at all —
  // the two halves both being legal-form words — and the fallback then compared
  // "company limited" against "company ltd" and called them 73% alike. Position
  // is what separates a legal form from part of the name: trailing "Company" is
  // the form, leading "Company" is the company.
  while (end > start && (LEGAL_FORM_TOKENS.has(tokens[end - 1]) || NOISE_TOKENS.has(tokens[end - 1]))) {
    end -= 1;
  }

  const kept = tokens.slice(start, end);

  if (kept.length) {
    return kept.join(' ');
  }

  // Every token was a legal form or filler — "Company Limited", "Company Ltd",
  // "The Company". Keep the first of them rather than restoring the whole
  // string: falling back to the full spelling leaves "company limited" and
  // "company ltd" to be compared character by character, which scores 73% and
  // misses. Keeping the leading token makes all three agree on "company".
  const leading = tokens.slice(start, start + 1);

  return (leading.length ? leading : tokens).join(' ');
};

/**
 * Purely numeric tokens, which distinguish "Depot 24" from "Depot 42".
 *
 * Whole-number tokens only. Matching any token merely *containing* a digit swept
 * in OCR glyph slips — "Digital0cean" and "Consu1ting" became numbered units,
 * disagreed with their clean spellings, and were hard-capped at 0.70. O→0 and
 * l→1 are the two commonest misreads there are.
 */
const digitTokens = (value: string): string[] =>
  value.split(' ').filter((t) => /^\d+$/.test(t));

/**
 * Fold glyphs that OCR routinely confuses onto one representative.
 *
 * Used only for token comparison, and only to ask "is this the same word,
 * misread?" — never to decide identity outright. Pure-digit tokens are left
 * alone so the branch-number check above keeps working.
 */
const OCR_CONFUSIONS: [RegExp, string][] = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/cl/g, 'd'],
  [/[il1|!]/g, 'i'],
  [/[o0]/g, 'o'],
  [/[s5]/g, 's'],
  [/[b8]/g, 'b'],
  [/[g9]/g, 'g'],
];

const ocrSkeleton = (token: string): string =>
  /^\d+$/.test(token)
    ? token
    : OCR_CONFUSIONS.reduce((acc, [pattern, to]) => acc.replace(pattern, to), token);

/** Levenshtein distance, two-row DP. */
const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length];
};

/** Levenshtein similarity as a 0–1 ratio. */
const ratio = (a: string, b: string): number => {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : 1 - levenshtein(a, b) / longest;
};

const sortedTokens = (value: string): string => value.split(' ').filter(Boolean).sort().join(' ');

/**
 * Similarity ignoring word order, used ONLY as a floor inside the alignment
 * guard — never as evidence of a match.
 *
 * Order-insensitivity was originally in the main score, on the theory that
 * "Consulting Northgate" should find "Northgate Consulting". It should not:
 * OCR reads left to right and does not shuffle words, so nothing real was
 * gained, while "Bank Trust Caribbean Ltd" and "Caribbean Trust Bank Ltd" —
 * plausibly two different institutions — scored a perfect 1.0.
 */
const tokenSortRatio = (a: string, b: string): number => ratio(sortedTokens(a), sortedTokens(b));

/** Occurrence counts, so a repeated word is not silently deduplicated. */
const tokenCounts = (value: string): Map<string, number> => {
  const counts = new Map<string, number>();
  for (const token of value.split(' ').filter(Boolean)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
};

/**
 * Similarity when one name is contained in the other, e.g. "Northgate
 * Consulting" against "Northgate Consulting Jamaica".
 *
 * Deliberately weighted by how much of the LONGER name the shared part covers,
 * rather than the usual containment ratio of 1.0. Treating a subset as a perfect
 * match is how "Main Company" ends up matching "Main Company Holdings
 * International" — two different legal entities.
 *
 * Counted as a multiset. Using sets made "Mango Mango Ltd" and "Mango Ltd" look
 * like identical one-token names and score 1.0.
 */
const tokenContainmentRatio = (a: string, b: string): number => {
  const tokensA = a.split(' ').filter(Boolean);
  const tokensB = b.split(' ').filter(Boolean);

  if (!tokensA.length || !tokensB.length) return 0;

  // Containment is about one name being a STRICT subset of the other. Equal
  // token counts mean this is a reordering, not a subset, and comparing them as
  // bags of words is blind to order — which is how "Bank Trust Caribbean" was
  // certified as containing "Caribbean Trust Bank". Leave those to the plain
  // character ratio, which is not.
  if (tokensA.length === tokensB.length) return 0;

  const countsB = tokenCounts(b);
  let shared = 0;
  for (const [token, count] of tokenCounts(a)) {
    shared += Math.min(count, countsB.get(token) ?? 0);
  }

  if (shared === 0) return 0;

  const coverageOfLonger = shared / Math.max(tokensA.length, tokensB.length);
  const coverageOfShorter = shared / Math.min(tokensA.length, tokensB.length);

  // Every token of the shorter name must appear in the longer one before this
  // counts at all; a partial overlap is handled by the character ratios.
  return coverageOfShorter === 1 ? coverageOfLonger : 0;
};

/**
 * How alike two vendor names are, 0–1.
 *
 * 1 means the same company beyond doubt; the threshold sits at 0.85 by default.
 */
/**
 * The weakest link when each token of the shorter name is paired with its best
 * partner in the longer one.
 *
 * Whole-string similarity hides a single wrong word inside a long shared tail:
 * "northgate consulting" and "southgate consulting" differ by two characters in
 * twenty and score 0.90, which would route one company's invoice to another.
 * Comparing token by token surfaces it — "northgate" against "southgate" is
 * 0.78, and that is the number that should decide.
 *
 * Surplus tokens in the longer name are ignored here; containment already
 * accounts for them.
 */
const worstAlignedTokenRatio = (a: string, b: string): number => {
  const tokensA = a.split(' ').filter(Boolean);
  const tokensB = b.split(' ').filter(Boolean);

  if (!tokensA.length || !tokensB.length) return 0;

  const [shorter, longer] = tokensA.length <= tokensB.length ? [tokensA, tokensB] : [tokensB, tokensA];
  const available = [...longer];
  let worst = 1;

  for (const token of shorter) {
    let bestRatio = 0;
    let bestIndex = -1;

    for (let i = 0; i < available.length; i += 1) {
      // Compare the words as written and as OCR might have mangled them. A
      // fixed ratio floor is unreachable for short words — one slip in a
      // four-letter word is only 0.75 — so "Skidd View" against "Skidd Vlew"
      // scored exactly the same as "Northgate" against "Southgate". Folding the
      // confusable glyphs separates them: "vlew" and "view" share a skeleton,
      // "kent" and "rent" do not.
      const r = Math.max(
        ratio(token, available[i]),
        ratio(ocrSkeleton(token), ocrSkeleton(available[i])),
      );
      if (r > bestRatio) {
        bestRatio = r;
        bestIndex = i;
      }
    }

    if (bestIndex >= 0) available.splice(bestIndex, 1);
    worst = Math.min(worst, bestRatio);
  }

  return worst;
};

/**
 * The derived forms a name is compared on.
 *
 * Split out so a directory can be reduced once and reused across many lookups:
 * the SLA dashboard matches every invoice in the window against every vendor
 * record, and re-deriving the candidates' core names inside that loop was most
 * of the cost.
 */
export type VendorNamePieces = {
  norm: string;
  core: string;
  squashed: string;
};

export const vendorNamePieces = (value: string): VendorNamePieces => {
  const norm = normalizeVendorName(value);
  const core = vendorCoreName(value);
  return { norm, core, squashed: core.replace(/ /g, '') };
};

/**
 * A score plus whether a guard fired.
 *
 * The guard has to travel alongside the number rather than being folded into it.
 * Expressing it as a cap of 0.80 meant a caller asking for `minScore: 80` — a
 * value the config schema accepts — silently switched the guard off entirely and
 * let every guarded pair through at once.
 */
type ScoreResult = { score: number; guarded: boolean };

/** Tokens whose presence on only one side does not make it a different company. */
const isIgnorableToken = (token: string): boolean =>
  LEGAL_FORM_TOKENS.has(token) || NOISE_TOKENS.has(token);

/**
 * True when every token of one name appears in the other, and the surplus is
 * real words rather than legal form.
 *
 * "National Water Commission of Jamaica" against "National Water Commission of
 * Jamaica Trust" differs by six characters in forty-two, so plain edit distance
 * calls it 0.86 — but a commission and its trust are different payees.
 */
const hasMeaningfulSurplus = (coreA: string, coreB: string): boolean => {
  const setA = new Set(coreA.split(' ').filter(Boolean));
  const setB = new Set(coreB.split(' ').filter(Boolean));
  const [smaller, larger] = setA.size <= setB.size ? [setA, setB] : [setB, setA];

  if (smaller.size === larger.size) return false;
  for (const token of smaller) if (!larger.has(token)) return false;

  for (const token of larger) {
    if (!smaller.has(token) && !isIgnorableToken(token)) return true;
  }

  return false;
};

const scoreFromPieces = (a: VendorNamePieces, b: VendorNamePieces): ScoreResult => {
  const { norm: normA, core: coreA, squashed: squashedA } = a;
  const { norm: normB, core: coreB, squashed: squashedB } = b;

  if (!normA || !normB) return { score: 0, guarded: false };
  if (normA === normB) return { score: 1, guarded: false };

  if (!coreA || !coreB) return { score: 0, guarded: false };
  // Same company, different legal form or punctuation. Not a perfect 1 — the
  // caller can still tell an exact hit from a normalised one.
  if (coreA === coreB) return { score: 0.97, guarded: false };

  // Identical letters, different word breaks: "DigitalOcean" and "Digital
  // Ocean". Token-by-token comparison cannot see through this, so it is settled
  // before the guard below can reject it.
  if (squashedA === squashedB) return { score: 0.97, guarded: false };

  // A disagreement in numbers is a disagreement about which branch or unit this
  // is, and character similarity is blind to it: "Depot 24" and "Depot 42" are
  // one edit apart.
  const digitsA = digitTokens(coreA);
  const digitsB = digitTokens(coreB);
  if (digitsA.join(' ') !== digitsB.join(' ')) {
    return {
      score: Math.min(0.7, Math.max(ratio(coreA, coreB), tokenSortRatio(coreA, coreB))),
      guarded: true,
    };
  }

  // Capped below the identity tiers above. Word-order and repeated-token paths
  // can both reach a literal 1.0 without the names being the same, and a score
  // of 1 is read downstream as certainty.
  const score = Math.min(
    0.96,
    Math.max(
      ratio(coreA, coreB),
      ratio(squashedA, squashedB),
      tokenContainmentRatio(coreA, coreB),
    ),
  );

  // One clearly different word is enough to disqualify, however well the rest of
  // the name lines up — as is a whole extra word that is not just legal form.
  const guarded =
    worstAlignedTokenRatio(coreA, coreB) < TOKEN_ALIGNMENT_FLOOR ||
    hasMeaningfulSurplus(coreA, coreB);

  return { score: guarded ? Math.min(GUARDED_CEILING, score) : score, guarded };
};

export const vendorMatchScore = (a: string, b: string): number =>
  scoreFromPieces(vendorNamePieces(a), vendorNamePieces(b)).score;

export type VendorCandidate<T> = {
  /** The name to match against — the directory label or key. */
  name: string;
  value: T;
};

export type VendorMatch<T> = {
  value: T;
  name: string;
  score: number;
  method: 'exact' | 'core' | 'fuzzy';
};

export type VendorMatchOutcome<T> = {
  /** Null when nothing cleared the threshold, or when the field was too close to call. */
  match: VendorMatch<T> | null;
  /** Set when two candidates scored within `AMBIGUITY_MARGIN` of each other. */
  ambiguousWith: { name: string; score: number }[] | null;
  /** Best score seen, even if rejected — useful for logging a near miss. */
  bestScore: number;
};

export type PreparedVendorCandidate<T> = VendorCandidate<T> & { pieces: VendorNamePieces };

/**
 * Reduce a directory to its comparable forms once.
 *
 * Worth doing whenever the same directory is matched against more than a couple
 * of names — the SLA dashboard runs one lookup per invoice in the window.
 */
export const prepareVendorCandidates = <T>(
  candidates: VendorCandidate<T>[],
): PreparedVendorCandidate<T>[] =>
  candidates.map((candidate) => ({ ...candidate, pieces: vendorNamePieces(candidate.name) }));

/**
 * Find the directory entry that names the same company as `query`.
 *
 * Returns no match rather than a doubtful one: see the ambiguity note at the top
 * of this file.
 */
export const matchVendorName = <T>(
  query: string,
  candidates: (VendorCandidate<T> | PreparedVendorCandidate<T>)[],
  options?: { threshold?: number },
): VendorMatchOutcome<T> => {
  const threshold = options?.threshold ?? DEFAULT_VENDOR_MATCH_THRESHOLD;
  const queryPieces = vendorNamePieces(query);

  if (!queryPieces.norm || candidates.length === 0) {
    return { match: null, ambiguousWith: null, bestScore: 0 };
  }

  const coreQuery = queryPieces.core;

  const scored = candidates
    .map((candidate) => {
      const pieces =
        'pieces' in candidate ? candidate.pieces : vendorNamePieces(candidate.name);
      const { score, guarded } = scoreFromPieces(queryPieces, pieces);
      // Method comes from IDENTITY, not from the number. Inferring "exact" from
      // a score of 1 was wrong: word-order and repeated-token comparisons could
      // both reach 1.0, and the label then skipped every downstream guard.
      const method: VendorMatch<T>['method'] =
        pieces.norm === queryPieces.norm ? 'exact' : score === 0.97 ? 'core' : 'fuzzy';
      return { value: candidate.value, name: candidate.name, score, method, guarded };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];

  // An exact hit is decided by identity. The directory's unique index makes a
  // second one impossible within a category, so there is nothing to weigh.
  if (best.method === 'exact') {
    const { guarded: _guarded, ...match } = best;
    return { match, ambiguousWith: null, bestScore: 1 };
  }

  // A guarded candidate is not eligible at any threshold. Its capped score is
  // still reported, so a near miss is visible in the logs.
  const eligible = scored.filter((c) => !c.guarded);

  if (eligible.length === 0) {
    return { match: null, ambiguousWith: null, bestScore: best.score };
  }

  const { guarded: _bestGuarded, ...winner } = eligible[0];

  // Very short names produce high character similarity by accident.
  if (winner.method === 'fuzzy' && coreQuery.length < MIN_FUZZY_CORE_LENGTH) {
    return { match: null, ambiguousWith: null, bestScore: best.score };
  }

  if (winner.score < threshold) {
    return { match: null, ambiguousWith: null, bestScore: best.score };
  }

  // Anything short of an exact hit can be rivalled — including a core match,
  // since "Acme Ltd" and "Acme LLC" reduce to the same core and would otherwise
  // be separated by nothing but sort order.
  const rivals = eligible
    .slice(1)
    .filter((c) => c.score >= threshold && winner.score - c.score < AMBIGUITY_MARGIN);

  if (rivals.length > 0) {
    return {
      match: null,
      ambiguousWith: [winner, ...rivals].map((c) => ({ name: c.name, score: c.score })),
      bestScore: winner.score,
    };
  }

  return { match: winner, ambiguousWith: null, bestScore: winner.score };
};

/** Percentage, for logs and for anything a workflow condition reads. */
export const asMatchPercent = (score: number): number => Math.round(score * 100);
