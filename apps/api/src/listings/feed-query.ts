import { escapeLike, parseSearchTerms, type FeedScope, type FeedSort } from '@fayda/domain';
import { and, desc, asc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { follows, listings, listingVariants, sellers } from '../db/schema.js';

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
}

/** The WHERE clauses for a feed request. Always live listings only. */
export function feedConditions(r: FeedRequest): SQL[] {
  const c: SQL[] = [eq(listings.status, 'ACTIVE')];
  if (r.sellerId) c.push(eq(listings.sellerId, r.sellerId));
  if (r.scope === 'FOLLOWING')
    c.push(sql`exists (select 1 from ${follows} f where f.follower_user_id = ${r.userId} and f.target_type = 'SELLER' and f.target_id = ${listings.sellerId})`);
  // Every word must match something: the listing's title, category, tags or description, or the shop's name or handle.
  for (const t of parseSearchTerms(r.q)) {
    const like = `%${escapeLike(t)}%`;
    c.push(
      or(
        ilike(listings.title, like),
        ilike(listings.category, like),
        ilike(listings.description, like),
        ilike(sql`array_to_string(${listings.tags}, ' ')`, like),
        ilike(sellers.name, like),
        ilike(sellers.handle, like),
      )!,
    );
  }
  if (r.category) c.push(eq(listings.category, r.category));
  if (r.minPrice != null) c.push(sql`${listings.pricePaise} >= ${r.minPrice}`);
  if (r.maxPrice != null) c.push(sql`${listings.pricePaise} <= ${r.maxPrice}`);
  if (r.acceptsOffers) c.push(sql`${listings.bargainMode} <> 'BUY_NOW'`);
  if (r.size) c.push(sql`exists (select 1 from ${listingVariants} v where v.listing_id = ${listings.id} and lower(v.label) = lower(${r.size.trim()}) and v.stock > 0)`);
  return c;
}

export const feedOrder = (sort: FeedSort): SQL[] =>
  sort === 'PRICE_LOW' ? [asc(listings.pricePaise), asc(listings.id)] : sort === 'PRICE_HIGH' ? [desc(listings.pricePaise), desc(listings.id)] : [desc(listings.publishedAt), desc(listings.id)];

const UUID = /^[0-9a-f-]{36}$/;
const bad = () => new AppError(400, 'VALIDATION', 'That page marker is not valid.');

/** A page marker names the sort it belongs to, so one made for another sort is refused rather than misread. */
// The NEWEST marker holds `published_at` in milliseconds. That is exact because `published_at` is only ever written from a JS
// Date (millisecond precision); if it ever gets microseconds, the marker must carry them too or rows could repeat or be skipped.
export function encodeFeedCursor(sort: FeedSort, row: { publishedAt: Date | null; pricePaise: number; id: string }): string {
  const key = sort === 'NEWEST' ? String(row.publishedAt?.getTime() ?? 0) : String(row.pricePaise);
  return Buffer.from(`${sort}:${key}:${row.id}`).toString('base64url');
}

/** The keyset condition that continues after the cursor. */
export function feedAfter(sort: FeedSort, cursor: string): SQL {
  const [s, key, id] = Buffer.from(cursor, 'base64url').toString().split(':');
  if (s !== sort || !id || !UUID.test(id) || !/^\d+$/.test(key ?? '')) throw bad();
  if (sort === 'NEWEST') return sql`(${listings.publishedAt}, ${listings.id}) < (${new Date(Number(key)).toISOString()}::timestamptz, ${id}::uuid)`;
  return sort === 'PRICE_LOW' ? sql`(${listings.pricePaise}, ${listings.id}) > (${Number(key)}, ${id}::uuid)` : sql`(${listings.pricePaise}, ${listings.id}) < (${Number(key)}, ${id}::uuid)`;
}

export const andAll = (parts: SQL[]): SQL => and(...parts)!;
