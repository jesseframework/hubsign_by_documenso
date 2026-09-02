import { describe, expect, it } from 'vitest';

import { containsKeyword, parseKeywords } from './keyword-match';

describe('containsKeyword', () => {
  it('matches a keyword standing as its own word', () => {
    expect(containsKeyword('invoice from northgate supplies ltd', 'northgate')).toBe(true);
  });

  it('ignores case on both sides', () => {
    expect(containsKeyword('ACME Corp Invoice', 'acme')).toBe(true);
  });

  it('matches a multi-word phrase', () => {
    expect(containsKeyword('payment terms net 30 days', 'net 30')).toBe(true);
  });

  it('does not match a different word that merely starts the same', () => {
    expect(containsKeyword('northern tools invoice', 'northgate')).toBe(false);
  });

  // The reason whole-word matching exists at all: a two-letter keyword used to
  // hit inside unrelated words, and every document contains "unit" somewhere.
  it('does not match a keyword buried inside a longer word', () => {
    expect(containsKeyword('total for 1 unit of work', 'it')).toBe(false);
    expect(containsKeyword('deposit received', 'po')).toBe(false);
  });

  it('still matches that same short keyword when it stands alone', () => {
    expect(containsKeyword('po number 4471', 'po')).toBe(true);
  });

  it('does not match a phrase whose words are merely present', () => {
    expect(containsKeyword('netting 30 units', 'net 30')).toBe(false);
  });

  // `\b` would reject these outright — a leading or trailing "-" has no word
  // boundary against a space — which is why the bounds are letter/digit
  // lookarounds instead.
  it('matches keywords containing punctuation', () => {
    expect(containsKeyword('acme-corp ltd', 'acme-corp')).toBe(true);
    expect(containsKeyword('billed to acme-corp.', 'acme-corp')).toBe(true);
  });

  it('treats regex metacharacters in a keyword as literal text', () => {
    expect(containsKeyword('cost is 5.00 usd', '5.00')).toBe(true);
    expect(containsKeyword('cost is 5x00 usd', '5.00')).toBe(false);
    expect(containsKeyword('a (b) c', '(b)')).toBe(true);
  });

  it('matches non-ascii letters', () => {
    expect(containsKeyword('site café nord', 'café')).toBe(true);
  });
});

describe('parseKeywords', () => {
  it('reads an array, normalising each entry', () => {
    expect(parseKeywords([' Northgate ', 'ACME'])).toEqual(['northgate', 'acme']);
  });

  it('reads a comma-separated string', () => {
    expect(parseKeywords('northgate, northgate supplies')).toEqual([
      'northgate',
      'northgate supplies',
    ]);
  });

  // Unquoted CSV cells lose their commas, so the importer writes semicolons and
  // the reader has to accept them.
  it('reads a semicolon-separated string', () => {
    expect(parseKeywords('a; b; c')).toEqual(['a', 'b', 'c']);
  });

  it('drops blank entries rather than emitting empty keywords', () => {
    // An empty keyword would match every document, since every string contains "".
    expect(parseKeywords('northgate,, ,acme')).toEqual(['northgate', 'acme']);
  });

  it('returns nothing for a missing or non-keyword value', () => {
    expect(parseKeywords(undefined)).toEqual([]);
    expect(parseKeywords(null)).toEqual([]);
    expect(parseKeywords(42)).toEqual([]);
  });
});
