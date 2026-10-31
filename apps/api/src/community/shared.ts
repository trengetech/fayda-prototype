import type { MediaRef } from '@fayda/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import type { DbService } from '../db/db.service.js';
import { listingMedia, media, orders, reviews, sellers } from '../db/schema.js';
import { publicMediaUrl } from '../media/media.service.js';
import { ratingSummary, sellerStats, type Order, type SellerStats } from '@fayda/domain';

export type Db = DbService['db'];
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type Q = Db | Tx;

/** "Asha Rao" -> "Asha". Buyers are shown to sellers and to the public by first name only. */
export const firstName = (name: string | null | undefined, fallback = 'Buyer'): string => (name ?? '').trim().split(/\s+/)[0] || fallback;

/** Public addresses for media rows (the id is unguessable; see DECISIONS: review, request and chat photos are not access-controlled). */
export async function mediaRefs(q: Q, ids: string[]): Promise<Map<string, MediaRef>> {
  const out = new Map<string, MediaRef>();
  if (!ids.length) return out;
  const rows = await q.select({ id: media.id, kind: media.kind }).from(media).where(inArray(media.id, ids));
  for (const r of rows) out.set(r.id, { id: r.id, kind: r.kind, url: publicMediaUrl(r.id) });
  return out;
}

/**
 * Checks that every id is a finished upload this user made for `purpose`. Returns a message for the form, or null when fine.
 * `images` restricts to photos (chat and request photos are photos only).
 */
export async function checkOwnedMedia(q: Q, userId: string, ids: string[], purpose: 'REVIEW' | 'REQUEST' | 'CHAT', opts: { images?: boolean; max: number; min?: number }): Promise<string | null> {
  if (ids.length < (opts.min ?? 0)) return 'Add a photo.';
  if (ids.length > opts.max) return `Up to ${opts.max} files.`;
  if (new Set(ids).size !== ids.length) return 'Each file can be added once.';
  if (!ids.length) return null;
  const rows = await q.select().from(media).where(inArray(media.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const r = byId.get(id);
    if (!r || r.ownerUserId !== userId || r.purpose !== purpose || r.status !== 'READY' || (opts.images && r.kind !== 'image'))
      return 'One of the files is missing or has not finished uploading. Upload it again.';
  }
  return null;
}

/** The first photo of each listing (or a video's poster), for cards. */
export async function listingCovers(q: Q, listingIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!listingIds.length) return out;
  const rows = await q
    .select({ listingId: listingMedia.listingId, mediaId: listingMedia.mediaId, posterMediaId: listingMedia.posterMediaId, kind: media.kind })
    .from(listingMedia)
    .innerJoin(media, eq(media.id, listingMedia.mediaId))
    .where(and(inArray(listingMedia.listingId, listingIds), eq(listingMedia.position, 0)));
  for (const r of rows) {
    const id = r.kind === 'image' ? r.mediaId : r.posterMediaId;
    if (id) out.set(r.listingId, publicMediaUrl(id));
  }
  return out;
}

/** Average rating and count per seller. */
export async function sellerRatings(q: Q, sellerIds: string[]): Promise<Map<string, { rating: number | null; reviewCount: number }>> {
  const out = new Map<string, { rating: number | null; reviewCount: number }>();
  if (!sellerIds.length) return out;
  const rows = await q.select({ sellerId: reviews.sellerId, rating: reviews.rating }).from(reviews).where(inArray(reviews.sellerId, sellerIds));
  const by = new Map<string, number[]>();
  for (const r of rows) by.set(r.sellerId, [...(by.get(r.sellerId) ?? []), r.rating]);
  for (const id of sellerIds) out.set(id, ratingSummary(by.get(id) ?? []));
  return out;
}

/** The public record of each seller (O-7) with the rating, from their orders and reviews. */
export async function loadSellerStats(q: Q, sellerIds: string[]): Promise<Map<string, SellerStats>> {
  const out = new Map<string, SellerStats>();
  if (!sellerIds.length) return out;
  const [rows, ratings] = await Promise.all([
    q.select({ sellerId: orders.sellerId, status: orders.status, createdAt: orders.createdAt, confirmedAt: orders.confirmedAt }).from(orders).where(inArray(orders.sellerId, sellerIds)),
    q.select({ sellerId: reviews.sellerId, rating: reviews.rating }).from(reviews).where(inArray(reviews.sellerId, sellerIds)),
  ]);
  for (const id of sellerIds) {
    const mine = rows
      .filter((r) => r.sellerId === id)
      .map((r) => ({ status: r.status, createdAt: r.createdAt.getTime(), confirmedAt: r.confirmedAt ? r.confirmedAt.getTime() : null }) as unknown as Order);
    out.set(id, sellerStats(mine, ratings.filter((r) => r.sellerId === id).map((r) => r.rating)));
  }
  return out;
}

export async function sellerRow(q: Q, userId: string): Promise<{ id: string; userId: string; name: string; categories: string[] } | null> {
  const [s] = await q.select({ id: sellers.id, userId: sellers.userId, name: sellers.name, categories: sellers.categories }).from(sellers).where(eq(sellers.userId, userId)).limit(1);
  return s ?? null;
}
