import { PaiseSchema, EpochMsSchema } from './common.js';
import { MediaKindSchema } from './media.js';
import { SellerRecordSchema } from './orders.js';
import { z } from './zod.js';

const DealAccessSchema = z.object({ type: z.enum(['CODE', 'LINK']), value: z.string().max(500) }).openapi('DealAccess');

/**
 * One listing, as the seller edits it. Drafts and published listings are validated the same way (as in the prototype);
 * publishing adds only the "stock on at least one size" rule. Field rules and messages come from `packages/domain`.
 */
export const ListingInputSchema = z
  .object({
    title: z.string().max(200),
    description: z.string().max(2000).nullish(),
    category: z.string().max(60),
    price: PaiseSchema,
    media: z.array(z.object({ mediaId: z.string().uuid(), posterMediaId: z.string().uuid().nullish() })).max(20),
    /** Search keywords; cleaned and checked by `validateTags` in `packages/domain`. Omit to keep the current tags. */
    tags: z.array(z.string().max(60)).max(30).nullish(),
    variants: z.array(z.object({ id: z.string().uuid().nullish(), label: z.string().max(60), stock: z.number() })).max(30),
    bargaining: z.object({ mode: z.string().max(10), expiryMinutes: z.number() }),
    rules: z.object({ autoAcceptAt: PaiseSchema.nullish(), autoDeclineBelow: PaiseSchema.nullish(), autoCounterAt: PaiseSchema.nullish() }).nullish(),
    checkout: z.object({ channel: z.string().max(10), productUrl: z.string().max(500).nullish() }),
    dealCodes: z.object({ accept: DealAccessSchema.nullish(), counter: DealAccessSchema.nullish() }).nullish(),
    /** True to publish (or keep published); false saves a draft. Ignored for a listing that is already live. */
    publish: z.boolean().default(false),
    /** "Create listing from a request": a WANTED response of this seller. Once published, the listing is shared in that chat. */
    fromResponseId: z.string().uuid().nullish(),
  })
  .openapi('ListingInput');
export type ListingInput = z.infer<typeof ListingInputSchema>;

export const ListingStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'PAUSED']).openapi('ListingStatus');
export const ListingStatusChangeSchema = z.object({ status: z.enum(['ACTIVE', 'PAUSED']) }).openapi('ListingStatusChange');

const ListingMediaSchema = z.object({ mediaId: z.string(), kind: MediaKindSchema, url: z.string(), posterMediaId: z.string().nullable(), posterUrl: z.string().nullable() });

/** The seller's own view. It includes the private rules and deal codes, so it is never used on a buyer route. */
export const SellerListingSchema = z
  .object({
    id: z.string(),
    status: ListingStatusSchema,
    title: z.string(),
    description: z.string(),
    category: z.string(),
    price: PaiseSchema,
    tags: z.array(z.string()),
    media: z.array(ListingMediaSchema),
    variants: z.array(z.object({ id: z.string(), label: z.string(), stock: z.number().int() })),
    bargaining: z.object({ mode: z.string(), expiryMinutes: z.number().int() }),
    rules: z.object({ autoAcceptAt: PaiseSchema.nullable(), autoDeclineBelow: PaiseSchema.nullable(), autoCounterAt: PaiseSchema.nullable() }),
    checkout: z.object({ channel: z.enum(['DIRECT', 'WEBSITE']), productUrl: z.string().nullable() }),
    dealCodes: z.object({ accept: DealAccessSchema.nullable(), counter: DealAccessSchema.nullable() }),
    publishedAt: EpochMsSchema.nullable(),
    updatedAt: EpochMsSchema,
    /** Counts only; the seller never sees who liked or saved. */
    stats: z.object({ likes: z.number().int(), saves: z.number().int(), comments: z.number().int() }),
  })
  .openapi('SellerListing');
export type SellerListing = z.infer<typeof SellerListingSchema>;

export const SellerListingListSchema = z.object({ items: z.array(SellerListingSchema) }).openapi('SellerListingList');

// ---------- buyer side: built from public fields only, so private rules and deal codes cannot appear ----------
const PublicSellerSchema = z.object({
  id: z.string(),
  name: z.string(),
  handle: z.string(),
  area: z.string(),
  city: z.string(),
  /** Average stars to 1 decimal place; null with no reviews. Shown on every listing. */
  rating: z.number().nullable(),
  reviewCount: z.number().int(),
});
/** The seller card on a product page: declared times, categories and the public order record (never contact numbers). */
const ProductSellerSchema = PublicSellerSchema.extend({
  slaConfirmHours: z.number().int(),
  slaShipDays: z.number().int(),
  categories: z.array(z.string()),
  record: SellerRecordSchema,
});

export const BuyerFeedItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    price: PaiseSchema,
    category: z.string(),
    soldOut: z.boolean(),
    acceptsOffers: z.boolean(),
    /** A photo to show on the card: the first photo, or the poster of the first video. */
    coverUrl: z.string().nullable(),
    hasVideo: z.boolean(),
    /** The first video, for a reel: its file and poster. Null on a photo-only listing. */
    video: z.object({ url: z.string(), posterUrl: z.string().nullable() }).nullable(),
    /** Whether the signed-in buyer follows this seller. */
    following: z.boolean(),
    likeCount: z.number().int(),
    commentCount: z.number().int(),
    /** Whether the signed-in buyer has liked or saved this listing. */
    liked: z.boolean(),
    saved: z.boolean(),
    /** True when the signed-in person owns this shop (they can't follow or buy from it). */
    ownShop: z.boolean(),
    seller: PublicSellerSchema,
  })
  .openapi('BuyerFeedItem');

export const BuyerFeedSchema = z.object({ items: z.array(BuyerFeedItemSchema), nextCursor: z.string().nullable() }).openapi('BuyerFeed');
export type BuyerFeed = z.infer<typeof BuyerFeedSchema>;

export const BuyerListingSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    price: PaiseSchema,
    soldOut: z.boolean(),
    likeCount: z.number().int(),
    commentCount: z.number().int(),
    liked: z.boolean(),
    saved: z.boolean(),
    /** True when the signed-in person owns this listing (they can't like it or buy it). */
    ownListing: z.boolean(),
    media: z.array(ListingMediaSchema.omit({ mediaId: true, posterMediaId: true })),
    variants: z.array(z.object({ id: z.string(), label: z.string(), available: z.boolean(), low: z.boolean() })),
    bargaining: z.object({ mode: z.string(), acceptsOffers: z.boolean(), expiryMinutes: z.number().int() }),
    /** `payMethods`: how this seller can be paid directly (UPI, BANK, LINK). Names only, never the details (O-3). Empty for website listings. */
    checkout: z.object({ channel: z.enum(['DIRECT', 'WEBSITE']), productUrl: z.string().nullable(), payMethods: z.array(z.enum(['UPI', 'BANK', 'LINK'])) }),
    seller: ProductSellerSchema,
  })
  .openapi('BuyerListing');
export type BuyerListing = z.infer<typeof BuyerListingSchema>;
