import { Inject, Injectable } from '@nestjs/common';
import type { FeedFacets, ShopView } from '@fayda/contracts';
import { CATEGORIES } from '@fayda/domain';
import { and, count, eq, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { loadSellerStats } from '../community/shared.js';
import { DbService } from '../db/db.service.js';
import { listingVariants, listings, sellers } from '../db/schema.js';
import { FollowsService } from './follows.service.js';

/** Shop pages and the filter choices. Feed queries themselves live in `ListingsService`, beside the listing code they read. */
@Injectable()
export class DiscoveryService {
  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(FollowsService) private readonly follows: FollowsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** A shop by its handle (any case). Public fields only: no phone or WhatsApp, no payment details (profiles allow-list). */
  async shopByHandle(userId: string, handle: string): Promise<ShopView> {
    const [s] = await this.db.select().from(sellers).where(eq(sellers.handle, handle.trim().toLowerCase())).limit(1);
    if (!s) throw new AppError(404, 'NOT_FOUND', 'Shop not found.');
    const [stats, state, live] = await Promise.all([
      loadSellerStats(this.db, [s.id]),
      this.follows.state(userId, s.id),
      this.db.select({ n: count() }).from(listings).where(and(eq(listings.sellerId, s.id), eq(listings.status, 'ACTIVE'))),
    ]);
    return {
      id: s.id,
      name: s.name,
      handle: s.handle,
      bio: s.bio,
      area: s.area,
      city: s.city,
      categories: s.categories,
      mapsUrl: s.mapsUrl,
      googleProfileUrl: s.googleProfileUrl,
      socialUrl: s.socialUrl,
      slaConfirmHours: s.slaConfirmHours,
      slaShipDays: s.slaShipDays,
      record: stats.get(s.id)!,
      followerCount: state.followerCount,
      listingCount: live[0]?.n ?? 0,
      following: state.following,
      isOwn: s.userId === userId,
    };
  }

  /** The id behind a handle, for the shop's listing page. */
  async sellerIdByHandle(handle: string): Promise<string> {
    const [s] = await this.db.select({ id: sellers.id }).from(sellers).where(eq(sellers.handle, handle.trim().toLowerCase())).limit(1);
    if (!s) throw new AppError(404, 'NOT_FOUND', 'Shop not found.');
    return s.id;
  }

  /** What the filter sheet offers: the fixed categories, the sizes that are in stock on live listings, and the price span. */
  async facets(): Promise<FeedFacets> {
    const sizesQuery = this.db
      .select({ label: sql<string>`lower(${listingVariants.label})`, n: count() })
      .from(listingVariants)
      .innerJoin(listings, eq(listings.id, listingVariants.listingId))
      .where(and(eq(listings.status, 'ACTIVE'), sql`${listingVariants.stock} > 0`))
      .groupBy(sql`lower(${listingVariants.label})`)
      .orderBy(sql`count(*) desc`, sql`lower(${listingVariants.label})`)
      .limit(30);
    const spanQuery = this.db.select({ lo: sql<number | null>`min(${listings.pricePaise})`, hi: sql<number | null>`max(${listings.pricePaise})` }).from(listings).where(eq(listings.status, 'ACTIVE'));
    const [sizes, [span]] = await Promise.all([sizesQuery, spanQuery]);
    return { categories: [...CATEGORIES], sizes: sizes.map((s) => s.label), minPrice: span?.lo ?? null, maxPrice: span?.hi ?? null };
  }
}
