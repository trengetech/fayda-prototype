import { Inject, Injectable } from '@nestjs/common';
import type { PutReview, ReviewView, ShopReview, ShopReviewList } from '@fayda/contracts';
import { canReviewOrder, ratingSummary, validateReview, type Clock } from '@fayda/domain';
import { desc, eq, inArray } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { checkOwnedMedia, firstName, mediaRefs, sellerRow, type Q } from '../community/shared.js';
import { DbService } from '../db/db.service.js';
import { listings, notifications, orders, reviewMedia, reviews, sellers, users } from '../db/schema.js';
import { NegotiationEvents } from '../negotiations/negotiation-events.js';
import { throwFail } from '../negotiations/negotiations.service.js';

type ReviewRow = typeof reviews.$inferSelect;

/** Reviews: one per order, only after the seller confirmed it (D15). The buyer is shown to others by first name only. */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NegotiationEvents) private readonly events: NegotiationEvents,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** Review views for these orders (used by the order screens). Orders without a review are absent. */
  async viewsForOrders(q: Q, orderIds: string[]): Promise<Map<string, ReviewView>> {
    const out = new Map<string, ReviewView>();
    if (!orderIds.length) return out;
    const rows = await q.select().from(reviews).where(inArray(reviews.orderId, orderIds));
    const media = await this.mediaOf(q, rows.map((r) => r.id));
    for (const r of rows) out.set(r.orderId, this.toView(r, media.get(r.id) ?? []));
    return out;
  }

  private toView(r: ReviewRow, media: ReviewView['media']): ReviewView {
    return { id: r.id, rating: r.rating, text: r.text, media, createdAt: r.createdAt.getTime(), editedAt: r.editedAt ? r.editedAt.getTime() : null };
  }

  private async mediaOf(q: Q, reviewIds: string[]): Promise<Map<string, ReviewView['media']>> {
    const out = new Map<string, ReviewView['media']>();
    if (!reviewIds.length) return out;
    const links = await q.select().from(reviewMedia).where(inArray(reviewMedia.reviewId, reviewIds)).orderBy(reviewMedia.reviewId, reviewMedia.position);
    const refs = await mediaRefs(q, links.map((l) => l.mediaId));
    for (const l of links) {
      const ref = refs.get(l.mediaId);
      if (ref) out.set(l.reviewId, [...(out.get(l.reviewId) ?? []), ref]);
    }
    return out;
  }

  /** Creates or edits the buyer's one review of an order. Omitting `mediaIds` keeps the existing files. */
  async put(userId: string, orderId: string, input: PutReview): Promise<ReviewView> {
    const evs: Parameters<NegotiationEvents['publish']>[0] = [];
    const id = await this.db.transaction(async (tx) => {
      // The order row is locked, so two simultaneous first reviews of one order are handled one after the other.
      const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for('update');
      const can = canReviewOrder({ buyerId: o?.buyerUserId ?? '', confirmedAt: o?.confirmedAt ? o.confirmedAt.getTime() : null }, userId);
      if (!o || !can.ok) throwFail(can.ok ? { ok: false, code: 'NOT_FOUND', message: 'Order not found.' } : can);
      const v = validateReview({ rating: input.rating, text: input.text ?? null, media: input.mediaIds ?? undefined });
      if (Object.keys(v.errors).length) throw new AppError(400, 'VALIDATION', 'Check the highlighted fields.', v.errors);
      if (input.mediaIds) {
        const bad = await checkOwnedMedia(tx, userId, input.mediaIds, 'REVIEW', { max: 4 });
        if (bad) throw new AppError(400, 'VALIDATION', 'Check the files.', { media: bad });
      }
      const now = new Date(this.clock.now());
      // The unique index on order_id makes two simultaneous first reviews end up as one.
      const [existing] = await tx.select().from(reviews).where(eq(reviews.orderId, orderId)).for('update');
      let reviewId: string;
      if (existing) {
        reviewId = existing.id;
        await tx.update(reviews).set({ rating: v.rating, text: v.text, editedAt: now }).where(eq(reviews.id, reviewId));
      } else {
        const [created] = await tx.insert(reviews).values({ orderId, buyerUserId: userId, sellerId: o.sellerId, listingId: o.listingId, rating: v.rating, text: v.text, createdAt: now }).returning({ id: reviews.id });
        reviewId = created!.id;
      }
      if (input.mediaIds) {
        await tx.delete(reviewMedia).where(eq(reviewMedia.reviewId, reviewId));
        if (input.mediaIds.length) await tx.insert(reviewMedia).values(input.mediaIds.map((mediaId, position) => ({ reviewId, position, mediaId })));
      }
      const [s] = await tx.select({ userId: sellers.userId }).from(sellers).where(eq(sellers.id, o.sellerId)).limit(1);
      if (s) {
        await tx.insert(notifications).values({ userId: s.userId, app: 'seller', code: existing ? 'REVIEW_UPDATED' : 'REVIEW_POSTED', params: { rating: v.rating }, orderId, createdAt: now });
        evs.push({ name: 'order.updated', payload: { orderId }, buyerUserId: userId, sellerUserId: s.userId });
      }
      return reviewId;
    });
    this.events.publish(evs);
    const [row] = await this.db.select().from(reviews).where(eq(reviews.id, id)).limit(1);
    return this.toView(row!, (await this.mediaOf(this.db, [id])).get(id) ?? []);
  }

  /** Public reviews of one shop: first names only, no contact details. */
  async forShop(sellerId: string, limit = 100): Promise<ShopReviewList> {
    const [exists] = await this.db.select({ id: sellers.id }).from(sellers).where(eq(sellers.id, sellerId)).limit(1);
    if (!exists) throw new AppError(404, 'NOT_FOUND', 'Shop not found.');
    const rows = await this.db
      .select({ r: reviews, buyerName: users.name, listingTitle: listings.title })
      .from(reviews)
      .innerJoin(users, eq(users.id, reviews.buyerUserId))
      .innerJoin(listings, eq(listings.id, reviews.listingId))
      .where(eq(reviews.sellerId, sellerId))
      .orderBy(desc(reviews.createdAt), desc(reviews.id))
      .limit(limit);
    const all = await this.db.select({ rating: reviews.rating }).from(reviews).where(eq(reviews.sellerId, sellerId));
    const media = await this.mediaOf(this.db, rows.map((x) => x.r.id));
    const items: ShopReview[] = rows.map((x) => ({
      id: x.r.id,
      rating: x.r.rating,
      text: x.r.text,
      media: media.get(x.r.id) ?? [],
      buyerName: firstName(x.buyerName),
      listingTitle: x.listingTitle,
      createdAt: x.r.createdAt.getTime(),
      verified: true,
    }));
    return { items, ...ratingSummary(all.map((x) => x.rating)) };
  }

  async forSeller(userId: string): Promise<ShopReviewList> {
    const s = await sellerRow(this.db, userId);
    if (!s) throw new AppError(403, 'NO_SELLER', 'Set up your shop first.');
    return this.forShop(s.id);
  }
}
