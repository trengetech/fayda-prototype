import { Inject, Injectable } from '@nestjs/common';
import type { DashboardWindow, ListingDashboardRow, ListingNumbers, SellerDashboard } from '@fayda/contracts';
import type { Clock } from '@fayda/domain';
import { and, count, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { DbService } from '../db/db.service.js';
import { comments, likes, listingViews, listings, negotiations, orders, saves, sellers } from '../db/schema.js';
import { NegotiationsService } from '../negotiations/negotiations.service.js';
import { OrdersService } from '../orders/orders.service.js';

const DAY = 86_400_000;
const WINDOWS = [7, 30] as const;

/**
 * The seller's own numbers. Only their data, from rows the API already keeps. Reach is views (product page opens, once per person per hour), likes, saves and comments. "Delivered" counts orders now delivered that were last touched in the window.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OrdersService) private readonly ordersService: OrdersService,
    @Inject(NegotiationsService) private readonly negotiationsService: NegotiationsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async window(sellerId: string, sellerUserId: string, days: number, now: number): Promise<DashboardWindow> {
    const since = new Date(now - days * DAY);
    const mine = eq(listings.sellerId, sellerId);
    const n = async (q: Promise<{ n: number }[]>): Promise<number> => (await q)[0]?.n ?? 0;
    const [views, offersReceived, offersAgreed, ordersPlaced, ordersConfirmed, ordersDelivered, likeCount, saveCount, commentCount] = await Promise.all([
      n(this.db.select({ n: count() }).from(listingViews).innerJoin(listings, and(eq(listings.id, listingViews.listingId), mine)).where(gte(listingViews.createdAt, since))),
      n(this.db.select({ n: count() }).from(negotiations).where(and(eq(negotiations.sellerId, sellerId), gte(negotiations.createdAt, since)))),
      n(this.db.select({ n: count() }).from(negotiations).where(and(eq(negotiations.sellerId, sellerId), sql`${negotiations.agreement} is not null and (${negotiations.agreement}->>'at')::bigint >= ${since.getTime()}`))),
      n(this.db.select({ n: count() }).from(orders).where(and(eq(orders.sellerId, sellerId), gte(orders.createdAt, since)))),
      n(this.db.select({ n: count() }).from(orders).where(and(eq(orders.sellerId, sellerId), gte(orders.confirmedAt, since)))),
      n(this.db.select({ n: count() }).from(orders).where(and(eq(orders.sellerId, sellerId), eq(orders.status, 'DELIVERED'), gte(orders.updatedAt, since)))),
      n(this.db.select({ n: count() }).from(likes).innerJoin(listings, and(eq(listings.id, likes.targetId), mine)).where(and(eq(likes.targetType, 'LISTING'), gte(likes.createdAt, since)))),
      n(this.db.select({ n: count() }).from(saves).innerJoin(listings, and(eq(listings.id, saves.targetId), mine)).where(and(eq(saves.targetType, 'LISTING'), gte(saves.createdAt, since)))),
      // Other people's comments only; the shop's own replies are not "reach".
      n(this.db.select({ n: count() }).from(comments).innerJoin(listings, and(eq(listings.id, comments.listingId), mine)).where(and(isNull(comments.removedAt), ne(comments.authorUserId, sellerUserId), gte(comments.createdAt, since)))),
    ]);
    return { days, views, offersReceived, offersAgreed, ordersPlaced, ordersConfirmed, ordersDelivered, likes: likeCount, saves: saveCount, comments: commentCount };
  }

  /** One window of numbers for each listing, from grouped queries (none per listing). A listing with no activity is all zeros. */
  private async perListing(sellerId: string, sellerUserId: string, ids: string[], days: number, now: number): Promise<Map<string, ListingNumbers>> {
    const since = new Date(now - days * DAY);
    const out = new Map<string, ListingNumbers>(ids.map((id) => [id, { views: 0, likes: 0, saves: 0, comments: 0, offers: 0, orders: 0, conversionPct: null }]));
    if (!ids.length) return out;
    const fill = (rows: { id: string; n: number }[], key: 'views' | 'likes' | 'saves' | 'comments' | 'offers' | 'orders') => {
      for (const r of rows) {
        const o = out.get(r.id);
        if (o) o[key] = r.n;
      }
    };
    const [views, likeRows, saveRows, commentRows, offerRows, orderRows] = await Promise.all([
      this.db.select({ id: listingViews.listingId, n: count() }).from(listingViews).where(and(inArray(listingViews.listingId, ids), gte(listingViews.createdAt, since))).groupBy(listingViews.listingId),
      this.db.select({ id: likes.targetId, n: count() }).from(likes).where(and(eq(likes.targetType, 'LISTING'), inArray(likes.targetId, ids), gte(likes.createdAt, since))).groupBy(likes.targetId),
      this.db.select({ id: saves.targetId, n: count() }).from(saves).where(and(eq(saves.targetType, 'LISTING'), inArray(saves.targetId, ids), gte(saves.createdAt, since))).groupBy(saves.targetId),
      this.db.select({ id: comments.listingId, n: count() }).from(comments).where(and(inArray(comments.listingId, ids), isNull(comments.removedAt), ne(comments.authorUserId, sellerUserId), gte(comments.createdAt, since))).groupBy(comments.listingId),
      this.db.select({ id: negotiations.listingId, n: count() }).from(negotiations).where(and(eq(negotiations.sellerId, sellerId), inArray(negotiations.listingId, ids), gte(negotiations.createdAt, since))).groupBy(negotiations.listingId),
      this.db.select({ id: orders.listingId, n: count() }).from(orders).where(and(eq(orders.sellerId, sellerId), inArray(orders.listingId, ids), gte(orders.createdAt, since))).groupBy(orders.listingId),
    ]);
    fill(views, 'views'); fill(likeRows, 'likes'); fill(saveRows, 'saves'); fill(commentRows, 'comments'); fill(offerRows, 'offers'); fill(orderRows, 'orders');
    for (const o of out.values()) o.conversionPct = o.views > 0 ? Math.round((o.orders / o.views) * 1000) / 10 : null;
    return out;
  }

  private async listingRows(sellerId: string, sellerUserId: string, now: number): Promise<ListingDashboardRow[]> {
    const mine = await this.db.select({ id: listings.id, title: listings.title, status: listings.status }).from(listings).where(and(eq(listings.sellerId, sellerId), ne(listings.status, 'DRAFT'))).orderBy(desc(listings.updatedAt)).limit(100);
    const ids = mine.map((l) => l.id);
    const [w7, w30] = await Promise.all([this.perListing(sellerId, sellerUserId, ids, 7, now), this.perListing(sellerId, sellerUserId, ids, 30, now)]);
    return mine
      .map((l) => ({ id: l.id, title: l.title, status: l.status as 'ACTIVE' | 'PAUSED', last7: w7.get(l.id)!, last30: w30.get(l.id)! }))
      .sort((a, b) => b.last30.views - a.last30.views || a.title.localeCompare(b.title));
  }

  async forSeller(userId: string): Promise<SellerDashboard> {
    const [s] = await this.db.select({ id: sellers.id }).from(sellers).where(eq(sellers.userId, userId)).limit(1);
    if (!s) throw new AppError(403, 'NO_SELLER', 'Set up your shop first.');
    const now = this.clock.now();
    const [windows, record, offers, ords, rows] = await Promise.all([
      Promise.all(WINDOWS.map((d) => this.window(s.id, userId, d, now))),
      this.ordersService.recordOfUser(userId),
      this.negotiationsService.listForSeller(userId),
      this.ordersService.listForSeller(userId),
      this.listingRows(s.id, userId, now),
    ]);
    return { windows, record, needsReply: offers.needsReply, needsConfirm: ords.needsConfirm, listings: rows };
  }
}
