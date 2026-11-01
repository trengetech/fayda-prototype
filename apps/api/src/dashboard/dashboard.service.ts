import { Inject, Injectable } from '@nestjs/common';
import type { DashboardWindow, SellerDashboard } from '@fayda/contracts';
import type { Clock } from '@fayda/domain';
import { and, count, eq, gte, isNull, ne, sql } from 'drizzle-orm';
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

  async forSeller(userId: string): Promise<SellerDashboard> {
    const [s] = await this.db.select({ id: sellers.id }).from(sellers).where(eq(sellers.userId, userId)).limit(1);
    if (!s) throw new AppError(403, 'NO_SELLER', 'Set up your shop first.');
    const now = this.clock.now();
    const [windows, record, offers, ords] = await Promise.all([
      Promise.all(WINDOWS.map((d) => this.window(s.id, userId, d, now))),
      this.ordersService.recordOfUser(userId),
      this.negotiationsService.listForSeller(userId),
      this.ordersService.listForSeller(userId),
    ]);
    return { windows, record, needsReply: offers.needsReply, needsConfirm: ords.needsConfirm };
  }
}
