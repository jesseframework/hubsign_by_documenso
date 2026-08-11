import { describe, expect, it } from 'vitest';

import {
  DEFAULT_VENDOR_MATCH_THRESHOLD,
  asMatchPercent,
  matchVendorName,
  normalizeVendorName,
  vendorCoreName,
  vendorMatchScore,
} from './vendor-match';

/**
 * Vendor names arrive from OCR and have to find a directory record that a person
 * typed months earlier. The two rarely agree character for character.
 *
 * The asymmetry to keep in mind when changing any threshold here: a miss means a
 * workflow quietly does nothing and someone eventually notices the invoice. A
 * WRONG match means a payment confirmation sent to a different company, or an
 * invoice routed to the wrong approver. The should-not-match block is therefore
 * the more important of the two.
 */

const scoreOf = (a: string, b: string) => vendorMatchScore(a, b);

/**
 * Goes through `matchVendorName`, not the raw score, so the guards that only
 * live in the matcher — guarded-candidate rejection, the short-core floor, the
 * ambiguity margin — are exercised by every case below. An earlier version of
 * this file compared scores directly and left all three untested.
 */
const matches = (a: string, b: string) =>
  matchVendorName(a, [{ name: b, value: b }]).match !== null;

describe('vendorCoreName', () => {
  it('strips the legal form from the end', () => {
    expect(vendorCoreName('Northgate Consulting Ltd.')).toBe('northgate consulting');
    expect(vendorCoreName('NORTHGATE CONSULTING LIMITED')).toBe('northgate consulting');
    expect(vendorCoreName('Northgate Consulting, LLC')).toBe('northgate consulting');
  });

  it('strips leading filler', () => {
    expect(vendorCoreName('The Gleaner Company Limited')).toBe('gleaner');
  });

  it('keeps a legal-form word that is part of the name', () => {
    // Leading "Company" is the name; trailing "Company" is the form.
    expect(vendorCoreName('Company Services Ltd')).toBe('company services');
  });

  it('keeps the leading token when the whole name is legal-form words', () => {
    // Otherwise "company limited" and "company ltd" fall back to their full
    // spellings and score 73% against each other — a miss on the commonest
    // variation there is.
    expect(vendorCoreName('Company Limited')).toBe('company');
    expect(vendorCoreName('Company Ltd')).toBe('company');
    expect(vendorCoreName('Company')).toBe('company');
    expect(vendorCoreName('Limited')).toBe('limited');
  });

  it('expands ampersands and drops accents', () => {
    expect(normalizeVendorName('ACME & Sons')).toBe('acme and sons');
    expect(normalizeVendorName('Nestlé')).toBe('nestle');
  });
});

describe('vendorMatchScore — the same company', () => {
  it('sees through legal-form drift', () => {
    expect(matches('Company Limited', 'Company Ltd')).toBe(true);
    expect(matches('Company Limited', 'Company Ltd.')).toBe(true);
    expect(matches('Company Limited', 'Company')).toBe(true);
    expect(matches('Skidd View Ltd.', 'Skidd View Limited')).toBe(true);
    expect(matches('NATIONAL COMMERCIAL BANK', 'National Commercial Bank Ltd')).toBe(true);
  });

  it('sees through case, punctuation, accents and ampersands', () => {
    expect(scoreOf('Northgate Consulting Ltd.', 'Northgate Consulting Ltd')).toBe(1);
    expect(matches('ACME & Sons Ltd', 'Acme and Sons Limited')).toBe(true);
    expect(matches('Nestlé Jamaica', 'Nestle Jamaica')).toBe(true);
  });

  it('sees through word breaks', () => {
    expect(matches('DigitalOcean LLC', 'Digital Ocean LLC')).toBe(true);
  });

  it('tolerates a character or two of scanning noise', () => {
    expect(matches('Northgate Consuiting Ltd', 'Northgate Consulting Ltd')).toBe(true);
    expect(matches('Aluplus Windoors', 'Aluplus Windoor')).toBe(true);
  });

  it('does not credit a word-order permutation as the same company', () => {
    // OCR reads left to right; it does not shuffle words. Treating order as
    // irrelevant bought nothing real and scored "Bank Trust Caribbean" against
    // "Caribbean Trust Bank" at a perfect 1.0.
    expect(matches('Bank Trust Caribbean Ltd', 'Caribbean Trust Bank Ltd')).toBe(false);
  });

  it('counts repeated words rather than deduplicating them', () => {
    expect(matches('Mango Mango Ltd', 'Mango Ltd')).toBe(false);
  });
});

describe('vendorMatchScore — different companies', () => {
  it('rejects a one-word difference behind a long shared tail', () => {
    // The expensive false positive: whole-string similarity puts these at 90%
    // because only two of twenty characters differ.
    expect(matches('Northgate Consulting Ltd', 'Southgate Consulting Ltd')).toBe(false);
  });

  it('rejects a shared prefix with a different distinguishing word', () => {
    expect(matches('Caribbean Cement', 'Caribbean Steel')).toBe(false);
    expect(matches('GreenLeaf Landscaping', 'GreenLeaf Catering')).toBe(false);
    expect(matches('Future Edge Technology', 'Future Edge Logistics')).toBe(false);
    expect(matches('First National Bank', 'First National Trust')).toBe(false);
    expect(matches('J Wray and Nephew', 'J Wray and Sons')).toBe(false);
  });

  it('rejects a name that merely contains the other', () => {
    expect(matches('Main Company', 'Main Company Holdings International')).toBe(false);
    expect(matches('Skidd View Ltd', 'Skidd Viewing Ltd')).toBe(false);
  });

  it('rejects differing branch numbers, however close the spelling', () => {
    expect(matches('Depot 24 Ltd', 'Depot 42 Ltd')).toBe(false);
    expect(matches('Store 7 Limited', 'Store 9 Limited')).toBe(false);
  });

  it('rejects near-identical initialisms', () => {
    expect(matches('ABC Ltd', 'ABD Ltd')).toBe(false);
  });

  it('does not treat Group, Holdings or Trust as interchangeable legal forms', () => {
    // A parent and its subsidiary are different payees with different bank
    // details. These scored 0.97 while "Group" was on the legal-form list.
    expect(matches('Vega Systems Group', 'Vega Systems Ltd')).toBe(false);
    expect(matches('Sagicor Holdings', 'Sagicor Ltd')).toBe(false);
    expect(matches('Vega Systems Foundation', 'Vega Systems Ltd')).toBe(false);
    expect(matches('First National Trust', 'First National Ltd')).toBe(false);
  });

  it('rejects a name carrying a whole extra word', () => {
    expect(matches('National Water Commission of Jamaica', 'National Water Commission of Jamaica Trust')).toBe(false);
  });

  it('keeps non-Latin names distinct instead of collapsing them to their suffix', () => {
    // An ASCII-only normaliser reduced all of these to "ltd"/"co" and matched
    // them at a confident 1.00 "exact".
    expect(matches('Кофе Хаус Ltd', 'Мосгаз Ltd')).toBe(false);
    expect(matches('北京科技 Ltd', '上海科技 Ltd')).toBe(false);
    expect(matches('ソニー Co', '株式会社サンプル Co')).toBe(false);
    // The same company in the same script still matches.
    expect(matches('Мосгаз Ltd', 'Мосгаз Limited')).toBe(true);
  });

  it('never reports a word-order permutation as an exact hit', () => {
    // 'exact' is read downstream as certainty and skips the ambiguity guard.
    const out = matchVendorName('Sanchez Perez Ltd', [
      { name: 'Perez Sanchez Ltd', value: 'permutation' },
      { name: 'Sanchez Perez Ltd', value: 'the real one' },
    ]);
    expect(out.match?.value).toBe('the real one');
    expect(out.match?.method).toBe('exact');
  });

  it('holds the guard at a threshold a caller is allowed to ask for', () => {
    // GUARDED_CEILING used to equal the alignment floor, so minScore: 80 —
    // accepted by the config schema — switched every guard off at once.
    const southgate = [{ name: 'Southgate Consulting Ltd', value: 'south' }];
    expect(matchVendorName('Northgate Consulting Ltd', southgate, { threshold: 0.8 }).match).toBeNull();
    expect(matchVendorName('Northgate Consulting Ltd', southgate, { threshold: 0.5 }).match).toBeNull();
  });
});

describe('OCR glyph confusion', () => {
  it('recovers a misread short word instead of writing it off', () => {
    // A flat ratio floor is unreachable for short words: one slip in a
    // four-letter word is 0.75. "Skidd View Ltd." is a live directory record.
    expect(matches('Skidd Vlew Ltd.', 'Skidd View Ltd')).toBe(true);
    expect(matches('Modem Interiors Ltd', 'Modern Interiors Ltd')).toBe(true);
    expect(matches('Bums Electrical Ltd', 'Burns Electrical Ltd')).toBe(true);
  });

  it('still separates words that merely differ by one letter', () => {
    expect(matches('Kent Supplies Ltd', 'Rent Supplies Ltd')).toBe(false);
    expect(matches('Hall Trading Ltd', 'Ball Trading Ltd')).toBe(false);
    expect(matches('Mark Foods Ltd', 'Mars Foods Ltd')).toBe(false);
  });

  it('does not mistake a glyph slip for a branch number', () => {
    // /\d/ over whole tokens made "Digital0cean" a numbered unit and capped it
    // at 0.70 against its own clean spelling.
    expect(matches('Digital0cean LLC', 'DigitalOcean LLC')).toBe(true);
    expect(matches('Northgate Consu1ting Ltd', 'Northgate Consulting Ltd')).toBe(true);
  });

  it('still rejects genuinely different branch numbers', () => {
    expect(matches('Depot 24 Ltd', 'Depot 42 Ltd')).toBe(false);
    expect(matches('Dep0t 24 Ltd', 'Depot 42 Ltd')).toBe(false);
  });
});

describe('matchVendorName', () => {
  const directory = [
    { name: 'Northgate Consulting Ltd', value: 'northgate' },
    { name: 'Skidd View Ltd.', value: 'skidd' },
  ];

  it('reports how the match was made', () => {
    expect(matchVendorName('Northgate Consulting Ltd.', directory).match).toEqual({
      value: 'northgate',
      name: 'Northgate Consulting Ltd',
      score: 1,
      method: 'exact',
    });
    expect(matchVendorName('NORTHGATE CONSULTING LIMITED', directory).match?.method).toBe('core');
    expect(matchVendorName('Northgate Consultng Ltd', directory).match?.method).toBe('fuzzy');
  });

  it('returns nothing for an unrelated vendor', () => {
    const out = matchVendorName('DigitalOcean LLC', directory);
    expect(out.match).toBeNull();
    expect(out.bestScore < DEFAULT_VENDOR_MATCH_THRESHOLD).toBe(true);
  });

  it('refuses to choose between two equally good candidates', () => {
    // Two directory records reducing to the same core name. Returning either
    // would be sort order deciding which company gets emailed.
    const twins = [
      { name: 'Acme Ltd', value: 'a' },
      { name: 'Acme LLC', value: 'b' },
    ];
    const out = matchVendorName('Acme Limited', twins);
    expect(out.match).toBeNull();
    expect(out.ambiguousWith?.length).toBe(2);
  });

  it('does not fuzzy-match very short names', () => {
    expect(matchVendorName('ABC', [{ name: 'ABD Ltd', value: 'x' }]).match).toBeNull();
  });

  it('honours a raised threshold', () => {
    // "Northgate Consultng" is a fuzzy hit at the default and not at 99%.
    expect(matchVendorName('Northgate Consultng Ltd', directory).match).not.toBeNull();
    expect(
      matchVendorName('Northgate Consultng Ltd', directory, { threshold: 0.99 }).match,
    ).toBeNull();
  });

  it('handles an empty query and an empty directory', () => {
    expect(matchVendorName('', directory).match).toBeNull();
    expect(matchVendorName('Anything', []).match).toBeNull();
  });
});

describe('asMatchPercent', () => {
  it('reports a whole-number percentage', () => {
    expect(asMatchPercent(1)).toBe(100);
    expect(asMatchPercent(0.97)).toBe(97);
    expect(asMatchPercent(0.8543)).toBe(85);
  });
});
