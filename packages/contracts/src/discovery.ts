import { EpochMsSchema, PaiseSchema } from './common.js';
import { SellerRecordSchema } from './orders.js';
import { z } from './zod.js';

/** Largest feed page a client may ask for. */
export const MAX_FEED_PAGE = 50;

const boolParam = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean());

/**
 * What a buyer can ask of the feed. `scope` picks For You (everything live) or Following (shops the buyer follows);
 * the rest narrow either one. Prices are paise. Rules for each field live in `packages/domain` (`validateFeedFilters`).
 */
export const FeedQuerySchema = z
  .object({
    cursor: z.string().max(300).optional(),
    limit: z.coerce.number().int().min(1).max(MAX_FEED_PAGE).optional(),
    scope: z.enum(['FOR_YOU', 'FOLLOWING']).optional(),
    q: z.string().max(200).optional(),
    category: z.string().max(60).optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    size: z.string().max(20).optional(),
    acceptsOffers: boolParam.optional(),
    sort: z.enum(['BEST', 'NEWEST', 'PRICE_LOW', 'PRICE_HIGH']).optional(),
  })
  .openapi('FeedQuery');
export type FeedQuery = z.infer<typeof FeedQuerySchema>;

/** A shop page: the allow-listed public profile, the public order record, and the numbers a buyer weighs. Never a phone number. */
export const ShopViewSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    handle: z.string(),
    bio: z.string(),
    area: z.string(),
    city: z.string(),
    categories: z.array(z.string()),
    mapsUrl: z.string(),
    googleProfileUrl: z.string().nullable(),
    socialUrl: z.string().nullable(),
    slaConfirmHours: z.number().int(),
    slaShipDays: z.number().int(),
    record: SellerRecordSchema,
    followerCount: z.number().int(),
    listingCount: z.number().int(),
    /** Whether the signed-in buyer follows this shop. */
    following: z.boolean(),
    /** True when the signed-in person owns this shop (the page then hides Follow). */
    isOwn: z.boolean(),
  })
  .openapi('ShopView');
export type ShopView = z.infer<typeof ShopViewSchema>;

export const FollowStateSchema = z.object({ following: z.boolean(), followerCount: z.number().int() }).openapi('FollowState');
export type FollowState = z.infer<typeof FollowStateSchema>;

export const FollowedShopSchema = z
  .object({ id: z.string(), name: z.string(), handle: z.string(), area: z.string(), city: z.string(), followedAt: EpochMsSchema })
  .openapi('FollowedShop');
export const FollowedShopListSchema = z.object({ items: z.array(FollowedShopSchema), nextCursor: z.string().nullable() }).openapi('FollowedShopList');
export type FollowedShopList = z.infer<typeof FollowedShopListSchema>;

/** The filter choices the app shows: categories, sorts and the size labels in use on live listings. */
export const FeedFacetsSchema = z.object({ categories: z.array(z.string()), sizes: z.array(z.string()), minPrice: PaiseSchema.nullable(), maxPrice: PaiseSchema.nullable() }).openapi('FeedFacets');
export type FeedFacets = z.infer<typeof FeedFacetsSchema>;

/** What the feed showed (I-39): the listings on screen with their place in the page, and which order the page came in. */
export const ImpressionsBodySchema = z
  .object({
    scope: z.enum(['FOR_YOU', 'FOLLOWING', 'SEARCH', 'SHOP']),
    ranker: z.enum(['NEWEST', 'SCORED', 'RELEVANCE', 'PRICE']),
    items: z.array(z.object({ listingId: z.string().uuid(), position: z.number().int().min(0).max(10_000) })).min(1).max(50),
  })
  .openapi('FeedImpressions');
export type ImpressionsBody = z.infer<typeof ImpressionsBodySchema>;
