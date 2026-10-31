import { CATEGORIES, RULES } from './rules.js';
import { isWholeRupees, type Paise } from './money.js';

/**
 * Discovery rules: listing tags, search terms, feed filters and follows. Pure; the API runs the query, these decide
 * what a valid request is, so the app and the server cannot disagree.
 */

export const MAX_TAGS_PER_LISTING = 8;
export const TAG_MIN_CHARS = 2;
export const TAG_MAX_CHARS = 24;
export const MAX_SEARCH_TERMS = 5;
export const SEARCH_TERM_MIN_CHARS = 2;
export const SEARCH_TERM_MAX_CHARS = 40;
export const FEED_SORTS = ['NEWEST', 'PRICE_LOW', 'PRICE_HIGH'] as const;
export type FeedSort = (typeof FEED_SORTS)[number];
export const FEED_SCOPES = ['FOR_YOU', 'FOLLOWING'] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];
/** What a person can follow. Only shops today; the follow table is keyed by this so later kinds need no new table. */
export const FOLLOW_TARGETS = ['SELLER'] as const;
export type FollowTarget = (typeof FOLLOW_TARGETS)[number];

const TAG_SHAPE = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} -]*$/u;

/** One tag as stored: lower case, no leading "#", single spaces. Returns '' for something that is not a tag. */
export function normalizeTag(raw: string): string {
  return String(raw ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Tags from a free-text box ("cotton, summer, #kurta"), split on commas and new lines, repeats removed. */
export function parseTagInput(raw: string): string[] {
  const tags = String(raw ?? '')
    .split(/[,\n]/)
    .map(normalizeTag)
    .filter(Boolean);
  return [...new Set(tags)];
}

/**
 * Checks and cleans a listing's tags. Duplicates after cleaning are dropped (not an error, they are the same tag).
 * `tags` is the cleaned list; `error` is a message for the form, or null.
 */
export function validateTags(input: readonly string[] | null | undefined): { tags: string[]; error: string | null } {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input ?? []) {
    const t = normalizeTag(raw);
    if (!t || seen.has(t)) continue;
    if (t.length < TAG_MIN_CHARS || t.length > TAG_MAX_CHARS || !TAG_SHAPE.test(t))
      return { tags, error: `Each tag is ${TAG_MIN_CHARS}–${TAG_MAX_CHARS} letters or numbers, such as “cotton” or “summer wear”.` };
    seen.add(t);
    tags.push(t);
  }
  if (tags.length > MAX_TAGS_PER_LISTING) return { tags, error: `Up to ${MAX_TAGS_PER_LISTING} tags.` };
  return { tags, error: null };
}

/**
 * Splits what the buyer typed into search terms: lower-cased, at most MAX_SEARCH_TERMS, each at least
 * SEARCH_TERM_MIN_CHARS (a single letter matches everything). Over-long terms are cut, not refused.
 * A listing must match every term, in any of its searchable fields.
 */
export function parseSearchTerms(raw: string | null | undefined): string[] {
  const out: string[] = [];
  for (const w of String(raw ?? '').normalize('NFKC').toLowerCase().split(/\s+/)) {
    const t = w.replace(/^#+/, '').slice(0, SEARCH_TERM_MAX_CHARS);
    if (t.length >= SEARCH_TERM_MIN_CHARS && !out.includes(t)) out.push(t);
    if (out.length === MAX_SEARCH_TERMS) break;
  }
  return out;
}

/** A term as a SQL LIKE pattern body: `%`, `_` and the escape character mean themselves. */
export const escapeLike = (term: string): string => term.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface FeedFilterInput {
  category?: string | null;
  minPrice?: Paise | null;
  maxPrice?: Paise | null;
  size?: string | null;
  acceptsOffers?: boolean | null;
}

/** Checks the filters a buyer set. Prices are paise; a range must not be backwards. */
export function validateFeedFilters(f: FeedFilterInput): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.category != null && !(CATEGORIES as readonly string[]).includes(f.category)) e.category = 'Choose one of the listed categories.';
  for (const k of ['minPrice', 'maxPrice'] as const) {
    const v = f[k];
    if (v != null && (!isWholeRupees(v) || v < 0 || v > RULES.MAX_PRICE_PAISE)) e[k] = 'Enter a whole number of rupees.';
  }
  if (!e.minPrice && !e.maxPrice && f.minPrice != null && f.maxPrice != null && f.minPrice > f.maxPrice) e.maxPrice = 'The highest price must be at least the lowest.';
  if (f.size != null && (f.size.trim().length < 1 || f.size.length > 20)) e.size = 'Enter a size, such as M or 32.';
  return e;
}

export const FOLLOW_LIMIT = 1000;

export type FollowFailure = 'OWN_SHOP' | 'LIMIT';
/** Whether this person may follow this shop: not their own, and not past the cap (which only guards abuse). */
export function mayFollow(c: { followerUserId: string; sellerUserId: string; currentCount: number }): { ok: true } | { ok: false; code: FollowFailure; message: string } {
  if (c.followerUserId === c.sellerUserId) return { ok: false, code: 'OWN_SHOP', message: 'You can’t follow your own shop.' };
  if (c.currentCount >= FOLLOW_LIMIT) return { ok: false, code: 'LIMIT', message: `You can follow up to ${FOLLOW_LIMIT} shops. Unfollow one first.` };
  return { ok: true };
}
