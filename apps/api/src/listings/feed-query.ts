import {
  FUZZY_MIN_CHARS,
  NEW_LISTING_START_SCORE,
  FUZZY_MIN_SIMILARITY,
  RANK_WEIGHTS,
  RELEVANCE,
  RELEVANCE_SCALE,
  escapeLike,
  expandSearchTerm,
  parseSearchTerms,
  type FeedScope,
  type FeedSort,
} from '@fayda/domain';
import { and, desc, asc, eq, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { follows, listingRankScores, listings, listingVariants, sellers } from '../db/schema.js';

/** Everything the feed can be asked, after the domain rules have checked it. */
export interface FeedRequest {
  cursor?: string;
  /** The signed-in buyer; needed for the Following scope and the "following" flag on each card. */
  userId: string;
  scope: FeedScope;
  q?: string;
  category?: string;
  minPrice?: number;
  maxPrice?: number;
  size?: string;
  acceptsOffers?: boolean;
  sort: FeedSort;
  /** A shop's own page: only this seller's listings. Set by the server, never by a query string. */
  sellerId?: string;
  /** Which ordering the server is set to use for For You (`FEED_RANKER`). Defaults to newest when not given. */
  ranker?: 'newest' | 'scored';
}

/** The ordering a request really gets, after BEST has been resolved. RANKED sorts by relevance, then the ranking score. */
export type FeedPlan = 'NEWEST' | 'PRICE_LOW' | 'PRICE_HIGH' | 'RANKED';

export function feedPlan(r: Pick<FeedRequest, 'sort' | 'q' | 'scope' | 'sellerId' | 'ranker'>): FeedPlan {
  if (r.sort !== 'BEST') return r.sort;
  if (parseSearchTerms(r.q).length) return 'RANKED';
  return r.scope === 'FOR_YOU' && !r.sellerId && r.ranker === 'scored' ? 'RANKED' : 'NEWEST';
}

/** The label stored with impressions and returned with a page. */
export function rankerLabel(r: Pick<FeedRequest, 'sort' | 'q' | 'scope' | 'sellerId' | 'ranker'>): 'NEWEST' | 'SCORED' | 'RELEVANCE' | 'PRICE' {
  const plan = feedPlan(r);
  if (plan === 'PRICE_LOW' || plan === 'PRICE_HIGH') return 'PRICE';
  if (plan === 'NEWEST') return 'NEWEST';
  return parseSearchTerms(r.q).length ? 'RELEVANCE' : 'SCORED';
}

const pat = (w: string) => `%${escapeLike(w)}%`;
const anyOf = (col: SQL, words: string[]): SQL => sql`${col} ILIKE ANY (ARRAY[${sql.join(words.map((w) => sql`${pat(w)}`), sql`, `)}]::text[])`;

const FIELDS = (): { col: SQL; weight: number; fuzzy: boolean }[] => [
  { col: sql`${listings.title}`, weight: RELEVANCE.TITLE, fuzzy: true },
  { col: sql`array_to_string(${listings.tags}, ' ')`, weight: RELEVANCE.TAG, fuzzy: true },
  { col: sql`${listings.category}`, weight: RELEVANCE.CATEGORY, fuzzy: true },
  { col: sql`(${sellers.name} || ' ' || ${sellers.handle})`, weight: RELEVANCE.SHOP, fuzzy: true },
  { col: sql`${listings.description}`, weight: RELEVANCE.DESCRIPTION, fuzzy: false },
];

/**
 * Points one search word earns: the best single field it matches. The word itself earns full points, a synonym or plural 80%,
 * a close misspelling (pg_trgm word similarity) 60%. Zero means the word matches nothing, and the listing is left out.
 */
export function termScore(term: string): SQL {
  const variants = expandSearchTerm(term);
  const typed = variants[0]!;
  const full = (w: number) => w;
  const part = (w: number, pct: number) => Math.round((w * pct) / 100);
  const arms: SQL[] = [];
  for (const f of FIELDS()) {
    arms.push(sql`(case when ${f.col} ILIKE ${pat(typed)} then ${full(f.weight)} when ${anyOf(f.col, variants)} then ${part(f.weight, RELEVANCE.SYNONYM_PERCENT)} else 0 end)`);
    if (f.fuzzy && typed.length >= FUZZY_MIN_CHARS) arms.push(sql`(case when strict_word_similarity(${typed}, ${f.col}) >= ${FUZZY_MIN_SIMILARITY} then ${part(f.weight, RELEVANCE.FUZZY_PERCENT)} else 0 end)`);
  }
  return sql`greatest(${sql.join(arms, sql`, `)})`;
}

/**
 * A cheap test the trigram index can answer: the word, a synonym or a plural appears anywhere in the listing's search text, or a
 * similar word does (`<%`, pg_trgm's own threshold, see FUZZY_MIN_SIMILARITY). It lets Postgres narrow the rows with one index
 * before the exact per-field points are worked out; `termScore(...) > 0` still decides what matches.
 */
export function termPrefilter(term: string): SQL {
  const variants = expandSearchTerm(term);
  const typed = variants[0]!;
  const exact = anyOf(sql`${listings.searchText}`, variants);
  return typed.length >= FUZZY_MIN_CHARS ? sql`(${exact} OR ${typed} <<% ${listings.searchText})` : exact;
}

/** Relevance points for the whole search: the sum over its words. Only meaningful with at least one term. */
export function relevanceExpr(q: string | undefined): SQL {
  const terms = parseSearchTerms(q);
  return terms.length ? sql`(${sql.join(terms.map(termScore), sql` + `)})` : sql`0`;
}

/** The score a RANKED page sorts and pages by: relevance first (scaled), then the stored ranking score, plus the follow boost. */
export function rankKeyExpr(r: Pick<FeedRequest, 'q' | 'userId'>): SQL {
  // The listing's score in the generation the page belongs to; the query joins `listing_rank_scores` for that one generation.
  const boost = sql`(case when exists (select 1 from ${follows} fb where fb.follower_user_id = ${r.userId} and fb.target_type = 'SELLER' and fb.target_id = ${listings.sellerId}) then ${RANK_WEIGHTS.FOLLOW_BOOST} else 0 end)`;
  return sql`((${relevanceExpr(r.q)})::bigint * ${RELEVANCE_SCALE} + coalesce(${listingRankScores.score}, ${NEW_LISTING_START_SCORE}) + ${boost})`;
}

/** The WHERE clauses for a feed request. Always live listings only. */
export function feedConditions(r: FeedRequest): SQL[] {
  const c: SQL[] = [eq(listings.status, 'ACTIVE')];
  if (r.sellerId) c.push(eq(listings.sellerId, r.sellerId));
  if (r.scope === 'FOLLOWING')
    c.push(sql`exists (select 1 from ${follows} f where f.follower_user_id = ${r.userId} and f.target_type = 'SELLER' and f.target_id = ${listings.sellerId})`);
  // Every word must match something: the listing's title, category, tags or description, or the shop's name or handle,
  // as the word itself, a synonym or plural of it, or a close misspelling.
  for (const t of parseSearchTerms(r.q)) c.push(termPrefilter(t), sql`${termScore(t)} > 0`);
  if (r.category) c.push(eq(listings.category, r.category));
  if (r.minPrice != null) c.push(sql`${listings.pricePaise} >= ${r.minPrice}`);
  if (r.maxPrice != null) c.push(sql`${listings.pricePaise} <= ${r.maxPrice}`);
  if (r.acceptsOffers) c.push(sql`${listings.bargainMode} <> 'BUY_NOW'`);
  if (r.size) c.push(sql`exists (select 1 from ${listingVariants} v where v.listing_id = ${listings.id} and lower(v.label) = lower(${r.size.trim()}) and v.stock > 0)`);
  return c;
}

export function feedOrder(r: FeedRequest): SQL[] {
  switch (feedPlan(r)) {
    case 'PRICE_LOW':
      return [asc(listings.pricePaise), asc(listings.id)];
    case 'PRICE_HIGH':
      return [desc(listings.pricePaise), desc(listings.id)];
    case 'RANKED':
      return [desc(rankKeyExpr(r)), desc(listings.id)];
    default:
      return [desc(listings.publishedAt), desc(listings.id)];
  }
}

const UUID = /^[0-9a-f-]{36}$/;
const bad = () => new AppError(400, 'VALIDATION', 'That page marker is not valid.');

/**
 * A page marker names the ordering it belongs to, so one made for another ordering is refused rather than misread.
 * NEWEST holds `published_at` in milliseconds. That is exact because `published_at` is only ever written from a JS
 * Date (millisecond precision); if it ever gets microseconds, the marker must carry them too or rows could repeat or be skipped.
 * RANKED holds the score generation the first page was cut from and the whole-number rank key in that generation, so every
 * later page uses the same scores and a refresh between two pages cannot repeat or skip a listing (DECISIONS I-39). A
 * generation is kept 30 minutes; a marker older than that continues on the newest scores, which can repeat or skip a few.
 */
export function encodeFeedCursor(plan: FeedPlan, row: { publishedAt: Date | null; pricePaise: number; id: string; rankKey?: number | string | null }, generation = 0): string {
  const key = plan === 'NEWEST' ? String(row.publishedAt?.getTime() ?? 0) : plan === 'RANKED' ? `${generation}.${row.rankKey ?? 0}` : String(row.pricePaise);
  return Buffer.from(`${plan}:${key}:${row.id}`).toString('base64url');
}

/** The score generation a RANKED marker belongs to, or null for no marker. Throws for a marker of another ordering or a broken one. */
export function cursorGeneration(r: FeedRequest, cursor: string | undefined): number | null {
  if (!cursor) return null;
  const [s, key] = Buffer.from(cursor, 'base64url').toString().split(':');
  if (s !== 'RANKED' || !/^\d+\.\d+$/.test(key ?? '')) throw bad();
  return Number(key!.split('.')[0]);
}

/** The keyset condition that continues after the cursor. */
export function feedAfter(r: FeedRequest, cursor: string): SQL {
  const plan = feedPlan(r);
  const [s, key, id] = Buffer.from(cursor, 'base64url').toString().split(':');
  if (s !== plan || !id || !UUID.test(id)) throw bad();
  if (plan === 'RANKED') {
    if (!/^\d+\.\d+$/.test(key ?? '')) throw bad();
    return sql`(${rankKeyExpr(r)}, ${listings.id}) < (${key!.split('.')[1]}::bigint, ${id}::uuid)`;
  }
  if (!/^\d+$/.test(key ?? '')) throw bad();
  if (plan === 'NEWEST') return sql`(${listings.publishedAt}, ${listings.id}) < (${new Date(Number(key)).toISOString()}::timestamptz, ${id}::uuid)`;
  return plan === 'PRICE_LOW' ? sql`(${listings.pricePaise}, ${listings.id}) > (${Number(key)}, ${id}::uuid)` : sql`(${listings.pricePaise}, ${listings.id}) < (${Number(key)}, ${id}::uuid)`;
}

export const andAll = (parts: SQL[]): SQL => and(...parts)!;
