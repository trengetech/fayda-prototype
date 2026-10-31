import { describe, expect, it } from 'vitest';
import {
  FOLLOW_LIMIT,
  MAX_SEARCH_TERMS,
  MAX_TAGS_PER_LISTING,
  escapeLike,
  mayFollow,
  normalizeTag,
  parseSearchTerms,
  parseTagInput,
  validateFeedFilters,
  validateListingDraft,
  validateTags,
} from '../src/index.js';

describe('tags', () => {
  it('cleans case, hashes and spacing', () => {
    expect(normalizeTag('  #Summer   Wear ')).toBe('summer wear');
    expect(parseTagInput('Cotton, #kurta,\nSILK ,, ')).toEqual(['cotton', 'kurta', 'silk']);
    expect(parseTagInput('Cotton, cotton, #COTTON')).toEqual(['cotton']);
  });
  it('drops duplicates after cleaning and keeps order', () => {
    expect(validateTags(['Cotton', 'cotton', '#COTTON', 'silk'])).toEqual({ tags: ['cotton', 'silk'], error: null });
  });
  it('refuses too short, too long, symbol and too many', () => {
    expect(validateTags(['a']).error).toBeTruthy();
    expect(validateTags(['x'.repeat(25)]).error).toBeTruthy();
    expect(validateTags(['cotton!!']).error).toBeTruthy();
    expect(validateTags(['a-b', 'ok tag', 'कुर्ता']).error).toBeNull();
    const nine = Array.from({ length: MAX_TAGS_PER_LISTING + 1 }, (_, i) => `tag${i}`);
    expect(validateTags(nine).error).toMatch(/Up to 8/);
  });
  it('a listing draft reports bad tags on the tags field', () => {
    const { errors } = validateListingDraft({ tags: ['x'] });
    expect(errors.tags).toBeTruthy();
    expect(validateListingDraft({ tags: ['cotton'] }).errors.tags).toBeUndefined();
  });
});

describe('search terms', () => {
  it('lower-cases, drops one-letter words and repeats, and caps the count', () => {
    expect(parseSearchTerms('  Red  a KURTA kurta #cotton ')).toEqual(['red', 'kurta', 'cotton']);
    expect(parseSearchTerms('aa bb cc dd ee ff gg')).toHaveLength(MAX_SEARCH_TERMS);
    expect(parseSearchTerms('')).toEqual([]);
    expect(parseSearchTerms(null)).toEqual([]);
  });
  it('cuts an over-long word instead of refusing it', () => {
    expect(parseSearchTerms('x'.repeat(100))[0]).toHaveLength(40);
  });
  it('escapes LIKE wildcards so "50%" searches for the text 50%', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('feed filters', () => {
  it('accepts a sensible set and none', () => {
    expect(validateFeedFilters({})).toEqual({});
    expect(validateFeedFilters({ category: 'Ethnic wear', minPrice: 10_000, maxPrice: 50_000, size: 'M', acceptsOffers: true })).toEqual({});
  });
  it('refuses an unknown category, a backwards range and a bad price', () => {
    expect(validateFeedFilters({ category: 'Toys' }).category).toBeTruthy();
    expect(validateFeedFilters({ minPrice: 9_000, maxPrice: 1_000 }).maxPrice).toBeTruthy();
    expect(validateFeedFilters({ minPrice: -1 }).minPrice).toBeTruthy();
    expect(validateFeedFilters({ maxPrice: 1.5 }).maxPrice).toBeTruthy();
    expect(validateFeedFilters({ minPrice: 1050 }).minPrice).toBe('Enter a whole number of rupees.'); // paise that are not whole rupees
  });
});

describe('following', () => {
  it('lets a person follow another shop, not their own, and not past the cap', () => {
    expect(mayFollow({ followerUserId: 'a', sellerUserId: 'b', currentCount: 0 })).toEqual({ ok: true });
    expect(mayFollow({ followerUserId: 'a', sellerUserId: 'a', currentCount: 0 })).toMatchObject({ ok: false, code: 'OWN_SHOP' });
    expect(mayFollow({ followerUserId: 'a', sellerUserId: 'b', currentCount: FOLLOW_LIMIT })).toMatchObject({ ok: false, code: 'LIMIT' });
    expect(mayFollow({ followerUserId: 'a', sellerUserId: 'b', currentCount: FOLLOW_LIMIT - 1 })).toEqual({ ok: true });
  });
});
