import { Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Put, Query, UseGuards } from '@nestjs/common';
import {
  BuyerFeedSchema,
  FeedFacetsSchema,
  FeedQuerySchema,
  FollowStateSchema,
  FollowedShopListSchema,
  ShopViewSchema,
  z,
  type BuyerFeed,
  type FeedFacets,
  type FeedQuery,
  type FollowState,
  type FollowedShopList,
  type ShopView,
} from '@fayda/contracts';
import { validateFeedFilters } from '@fayda/domain';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import { AppError } from '../common/app-error.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { ListingsService } from '../listings/listings.service.js';
import { DiscoveryService } from './discovery.service.js';
import { FollowsService, MAX_FOLLOW_PAGE } from './follows.service.js';

const IdParam = new ParseUUIDPipe();
const FollowListQuery = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(MAX_FOLLOW_PAGE).optional() });

/** Checks the filters with the same rules the app uses and turns them into a feed request. */
function toFeedRequest(userId: string, q: FeedQuery, sellerId?: string) {
  const fields = validateFeedFilters({ category: q.category ?? null, minPrice: q.minPrice ?? null, maxPrice: q.maxPrice ?? null, size: q.size ?? null });
  if (Object.keys(fields).length) throw new AppError(400, 'VALIDATION', 'Check the filters.', fields);
  return {
    userId,
    scope: q.scope ?? 'FOR_YOU',
    sort: q.sort ?? 'NEWEST',
    ...(q.cursor ? { cursor: q.cursor } : {}),
    ...(q.q ? { q: q.q } : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.minPrice != null ? { minPrice: q.minPrice } : {}),
    ...(q.maxPrice != null ? { maxPrice: q.maxPrice } : {}),
    ...(q.size ? { size: q.size } : {}),
    ...(q.acceptsOffers ? { acceptsOffers: true } : {}),
    ...(sellerId ? { sellerId } : {}),
  } as const;
}

/**
 * Discovery for the buyer app: the feed (For You and Following, search, filters, sort), shop pages and follows.
 * All routes are the buyer's: a seller token cannot reach them.
 */
@Controller('buyer')
@UseGuards(AuthGuard)
@Audience('buyer')
export class BuyerDiscoveryController {
  constructor(
    @Inject(ListingsService) private readonly listings: ListingsService,
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(FollowsService) private readonly follows: FollowsService,
  ) {}

  @Get('feed')
  async feed(@Auth() who: AccessClaims, @Query(new ZodPipe(FeedQuerySchema)) q: FeedQuery): Promise<BuyerFeed> {
    return BuyerFeedSchema.parse(await this.listings.feed(toFeedRequest(who.userId, q), q.limit));
  }

  @Get('feed/facets')
  async facets(): Promise<FeedFacets> {
    return FeedFacetsSchema.parse(await this.discovery.facets());
  }

  @Get('shops/:handle')
  async shop(@Auth() who: AccessClaims, @Param('handle') handle: string): Promise<ShopView> {
    return ShopViewSchema.parse(await this.discovery.shopByHandle(who.userId, handle));
  }

  /** A shop's live listings, with the same filters, search and sort as the feed. */
  @Get('shops/:handle/listings')
  async shopListings(@Auth() who: AccessClaims, @Param('handle') handle: string, @Query(new ZodPipe(FeedQuerySchema)) q: FeedQuery): Promise<BuyerFeed> {
    const sellerId = await this.discovery.sellerIdByHandle(handle);
    return BuyerFeedSchema.parse(await this.listings.feed(toFeedRequest(who.userId, { ...q, scope: 'FOR_YOU' }, sellerId), q.limit));
  }

  @Get('follows')
  async list(@Auth() who: AccessClaims, @Query(new ZodPipe(FollowListQuery)) q: { cursor?: string; limit?: number }): Promise<FollowedShopList> {
    return FollowedShopListSchema.parse(await this.follows.list(who.userId, q.cursor, q.limit));
  }

  /** Follow a shop. Repeating it changes nothing, so a retry after a lost reply is safe without a key. */
  @Put('follows/sellers/:sellerId')
  async follow(@Auth() who: AccessClaims, @Param('sellerId', IdParam) sellerId: string): Promise<FollowState> {
    return FollowStateSchema.parse(await this.follows.follow(who.userId, sellerId));
  }

  @Delete('follows/sellers/:sellerId')
  async unfollow(@Auth() who: AccessClaims, @Param('sellerId', IdParam) sellerId: string): Promise<FollowState> {
    return FollowStateSchema.parse(await this.follows.unfollow(who.userId, sellerId));
  }
}
