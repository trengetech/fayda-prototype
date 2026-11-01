import { bigint, boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { DealAccess, Negotiation, Shipment } from '@fayda/domain';

/**
 * Replays the stored response when a client retries a mutating request with the same Idempotency-Key.
 * `scope` is the caller (user id) plus route, so keys never collide across users.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    requestHash: text('request_hash').notNull(),
    status: text('status', { enum: ['IN_PROGRESS', 'COMPLETED'] }).notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.key] }), index('idempotency_keys_expires_idx').on(t.expiresAt)],
);

// ---------- identity ----------
/** One row per phone number: the same number is the same user in both apps. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Normalised 10-digit Indian mobile. */
  phone: text('phone').notNull().unique(),
  name: text('name'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** One session per user per app. The refresh token is stored only as a hash and rotates on every use. */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    app: text('app', { enum: ['buyer', 'seller'] }).notNull(),
    refreshHash: text('refresh_hash').notNull().unique(),
    /** The hash before the last rotation. Presenting it again means the token was copied, so the session is revoked. */
    previousRefreshHash: text('previous_refresh_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_app_idx').on(t.userId, t.app), index('sessions_previous_hash_idx').on(t.previousRefreshHash)],
);

/** Wrong sign-in codes per phone number, shared by every API process. `locked_until` is set once the limit is reached. */
export const otpAttempts = pgTable('otp_attempts', {
  phone: text('phone').primaryKey(),
  count: integer('count').notNull(),
  lockedUntil: timestamp('locked_until', { withTimezone: true }),
});

// ---------- buyer ----------
export const buyerProfiles = pgTable('buyer_profiles', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  contactPhone: text('contact_phone'),
  contactWhatsapp: text('contact_whatsapp'),
  agreementVersion: text('agreement_version'),
  agreementAcceptedAt: timestamp('agreement_accepted_at', { withTimezone: true }),
  defaultAddressId: uuid('default_address_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const buyerAddresses = pgTable(
  'buyer_addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    line1: text('line1').notNull(),
    line2: text('line2').notNull(),
    pin: text('pin').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('buyer_addresses_user_idx').on(t.userId)],
);

// ---------- seller ----------
export const sellers = pgTable('sellers', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  sellerType: text('seller_type', { enum: ['INDIVIDUAL', 'BUSINESS'] }).notNull(),
  name: text('name').notNull(),
  handle: text('handle').notNull().unique(),
  area: text('area').notNull(),
  city: text('city').notNull(),
  gstin: text('gstin'),
  bio: text('bio').notNull().default(''),
  categories: text('categories').array().notNull(),
  mapsUrl: text('maps_url').notNull(),
  googleProfileUrl: text('google_profile_url'),
  socialUrl: text('social_url'),
  contactPhone: text('contact_phone'),
  contactWhatsapp: text('contact_whatsapp'),
  slaConfirmHours: integer('sla_confirm_hours').notNull(),
  slaShipDays: integer('sla_ship_days').notNull(),
  conductVersion: text('conduct_version'),
  conductAcceptedAt: timestamp('conduct_accepted_at', { withTimezone: true }),
  verification: text('verification').notNull().default('UNVERIFIED'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Private to the seller. Buyers see these details only on their own direct order while it is PLACED. */
export const sellerPaymentProfiles = pgTable('seller_payment_profiles', {
  sellerId: uuid('seller_id').primaryKey().references(() => sellers.id, { onDelete: 'cascade' }),
  upiId: text('upi_id'),
  /** A READY `UPI_QR` media row, checked against `upiId` when saved. Private: served to a buyer only through their own PLACED order. */
  upiQrMediaId: uuid('upi_qr_media_id'),
  bankHolder: text('bank_holder'),
  bankAccount: text('bank_account'),
  bankIfsc: text('bank_ifsc'),
  bankName: text('bank_name'),
  paymentLink: text('payment_link'),
  website: text('website'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- media ----------
/**
 * One uploaded file. The row is created by an upload intent (`PENDING`) and becomes `READY` when the upload is
 * verified. `storageKey` is opaque to callers, so the disk adapter can later be swapped for R2 or Stream.
 */
export const media = pgTable(
  'media',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['image', 'video'] }).notNull(),
    purpose: text('purpose', { enum: ['LISTING', 'UPI_QR', 'REVIEW', 'REQUEST', 'CHAT'] }).notNull(),
    mime: text('mime').notNull(),
    declaredSize: integer('declared_size').notNull(),
    size: integer('size'),
    durationSec: integer('duration_sec'),
    status: text('status', { enum: ['PENDING', 'READY'] }).notNull().default('PENDING'),
    adapter: text('adapter').notNull(),
    storageKey: text('storage_key').notNull(),
    /** SHA-256 of the one-time token in the upload address. Null once the file has arrived. */
    uploadTokenHash: text('upload_token_hash'),
    uploadExpiresAt: timestamp('upload_expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    readyAt: timestamp('ready_at', { withTimezone: true }),
  },
  (t) => [index('media_owner_idx').on(t.ownerUserId), index('media_status_created_idx').on(t.status, t.createdAt)],
);

// ---------- listings ----------
export const listings = pgTable(
  'listings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: uuid('seller_id').notNull().references(() => sellers.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['DRAFT', 'ACTIVE', 'PAUSED'] }).notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull(),
    /** Search keywords, lower case (`validateTags`). Public: shown on the product page and matched by search. */
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    pricePaise: integer('price_paise').notNull(),
    bargainMode: text('bargain_mode', { enum: ['BUY_NOW', 'BOTH'] }).notNull(),
    /** How long a bargaining offer on this listing stays open: 30, 60, 180, 360 or 1440 minutes. */
    expiryMinutes: integer('expiry_minutes').notNull().default(1440),
    channel: text('channel', { enum: ['DIRECT', 'WEBSITE'] }).notNull(),
    productUrl: text('product_url'),
    // Seller-only. These columns are never selected by a buyer query; buyer responses are built from buyer schemas.
    autoAcceptAt: integer('auto_accept_at'),
    autoDeclineBelow: integer('auto_decline_below'),
    autoCounterAt: integer('auto_counter_at'),
    dealAccept: jsonb('deal_accept').$type<DealAccess | null>(),
    dealCounter: jsonb('deal_counter').$type<DealAccess | null>(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('listings_seller_idx').on(t.sellerId, t.status),
    index('listings_feed_idx').on(t.status, t.publishedAt, t.id),
    index('listings_tags_idx').using('gin', t.tags),
    index('listings_price_idx').on(t.status, t.pricePaise, t.id),
  ],
);

export const listingMedia = pgTable(
  'listing_media',
  {
    listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    mediaId: uuid('media_id').notNull().references(() => media.id),
    /** Poster photo for a video (made on the seller's phone, I-14). */
    posterMediaId: uuid('poster_media_id').references(() => media.id),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.position] }), index('listing_media_media_idx').on(t.mediaId)],
);

export const listingVariants = pgTable(
  'listing_variants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    label: text('label').notNull(),
    stock: integer('stock').notNull(),
  },
  (t) => [index('listing_variants_listing_idx').on(t.listingId)],
);

// ---------- bargaining ----------
/**
 * One negotiation, stored as the domain aggregate: offers and events are JSON because a negotiation has at most 6 offers
 * and is always read and written whole. `nextDueAt` is the earliest moment something is due (automatic counter or decline,
 * offer expiry, agreement lapse); the 1 s sweep and the lazy check on read both use it. `offers` holds private fields
 * (pending automatic replies), so it is never returned directly: buyer responses are built from `buyerNegotiationView`.
 */
export const negotiations = pgTable(
  'negotiations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id').notNull().references(() => listings.id),
    /** No foreign key: a size the seller removes closes its negotiations (SOLD_OUT) and then disappears. */
    variantId: uuid('variant_id').notNull(),
    buyerUserId: uuid('buyer_user_id').notNull().references(() => users.id),
    sellerId: uuid('seller_id').notNull().references(() => sellers.id),
    status: text('status', { enum: ['OPEN', 'AGREED', 'PURCHASED', 'LAPSED', 'CLOSED'] }).notNull(),
    closeReason: text('close_reason'),
    offers: jsonb('offers').$type<Negotiation['offers']>().notNull(),
    events: jsonb('events').$type<Negotiation['events']>().notNull(),
    agreement: jsonb('agreement').$type<Negotiation['agreement']>(),
    nextDueAt: timestamp('next_due_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('negotiations_buyer_idx').on(t.buyerUserId, t.updatedAt),
    index('negotiations_seller_idx').on(t.sellerId, t.status, t.updatedAt),
    index('negotiations_listing_idx').on(t.listingId, t.status),
    index('negotiations_due_idx').on(t.nextDueAt),
  ],
);

/** One unit of a size held for a buyer while an agreement is open. Counted against stock until it is released or used. */
export const reservations = pgTable(
  'reservations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    negotiationId: uuid('negotiation_id').notNull().references(() => negotiations.id),
    variantId: uuid('variant_id').notNull(),
    status: text('status', { enum: ['ACTIVE', 'CONSUMED', 'RELEASED'] }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reservations_variant_idx').on(t.variantId, t.status, t.expiresAt), index('reservations_negotiation_idx').on(t.negotiationId)],
);

/** What the domain says someone should be told. Written now, shown in the notification centres in M3.7. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    app: text('app', { enum: ['buyer', 'seller'] }).notNull(),
    code: text('code').notNull(),
    params: jsonb('params').$type<Record<string, string | number>>(),
    negotiationId: uuid('negotiation_id'),
    orderId: uuid('order_id'),
    threadId: uuid('thread_id'),
    requestId: uuid('request_id'),
    listingId: uuid('listing_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** Set when the notification has been told to the person's open apps (real-time) and sent as a push. Null = not yet. */
    pushedAt: timestamp('pushed_at', { withTimezone: true }),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.app, t.createdAt),
    index('notifications_unpushed_idx').on(t.createdAt).where(sql`${t.pushedAt} is null`),
  ],
);

// ---------- orders (M3.4) ----------
/**
 * One order. `seq` is a database identity (bigint), so the readable number `FD-100001` never runs out and never repeats;
 * the number is built from it on read (`formatOrderNumber`). Prices, the address and the listing's title are snapshots:
 * later edits to the listing or the buyer's address never change an order.
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity({ startWith: 100001 }),
    buyerUserId: uuid('buyer_user_id').notNull().references(() => users.id),
    sellerId: uuid('seller_id').notNull().references(() => sellers.id),
    listingId: uuid('listing_id').notNull().references(() => listings.id),
    /** No foreign key: a seller may later remove a size; the order keeps its label. */
    variantId: uuid('variant_id').notNull(),
    variantLabel: text('variant_label').notNull(),
    listingTitle: text('listing_title').notNull(),
    coverMediaId: uuid('cover_media_id'),
    pricePaise: integer('price_paise').notNull(),
    listPricePaise: integer('list_price_paise').notNull(),
    priceSource: text('price_source', { enum: ['LIST', 'NEGOTIATED'] }).notNull(),
    negotiationId: uuid('negotiation_id').references(() => negotiations.id),
    channel: text('channel', { enum: ['DIRECT', 'WEBSITE'] }).notNull(),
    paymentMethod: text('payment_method', { enum: ['UPI', 'BANK', 'LINK'] }),
    dealAccess: jsonb('deal_access').$type<DealAccess | null>(),
    /** Delivery address as it was when the order was placed. Null for website orders. */
    address: jsonb('address').$type<{ name: string; line1: string; line2: string; pin: string; city: string; state: string } | null>(),
    status: text('status', { enum: ['PLACED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED'] }).notNull(),
    confirmBy: timestamp('confirm_by', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    shipment: jsonb('shipment').$type<Shipment | null>(),
    cancelReason: text('cancel_reason'),
    cancelNote: text('cancel_note'),
    restocked: boolean('restocked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('orders_buyer_idx').on(t.buyerUserId, t.createdAt),
    index('orders_seller_idx').on(t.sellerId, t.status, t.createdAt),
    index('orders_confirm_due_idx').on(t.status, t.confirmBy),
    uniqueIndex('orders_seq_idx').on(t.seq),
    // One order per agreement: a double tap or a retry cannot make two.
    uniqueIndex('orders_negotiation_idx').on(t.negotiationId),
  ],
);

// ---------- chat ----------
export const chatThreads = pgTable(
  'chat_threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: text('kind', { enum: ['ORDER', 'REQUEST'] }).notNull(),
    orderId: uuid('order_id').references(() => orders.id),
    requestId: uuid('request_id'),
    responseId: uuid('response_id'),
    buyerUserId: uuid('buyer_user_id').notNull().references(() => users.id),
    sellerId: uuid('seller_id').notNull().references(() => sellers.id),
    sellerUserId: uuid('seller_user_id').notNull().references(() => users.id),
    buyerReadAt: timestamp('buyer_read_at', { withTimezone: true }).notNull(),
    sellerReadAt: timestamp('seller_read_at', { withTimezone: true }).notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('chat_threads_order_idx').on(t.orderId),
    uniqueIndex('chat_threads_response_idx').on(t.responseId),
    index('chat_threads_buyer_idx').on(t.buyerUserId, t.lastMessageAt),
    index('chat_threads_seller_idx').on(t.sellerUserId, t.lastMessageAt),
  ],
);

export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id').notNull().references(() => chatThreads.id, { onDelete: 'cascade' }),
    from: text('from', { enum: ['BUYER', 'SELLER', 'SYSTEM'] }).notNull(),
    type: text('type', { enum: ['TEXT', 'MEDIA', 'LISTING'] }).notNull(),
    text: text('text'),
    mediaId: uuid('media_id').references(() => media.id),
    listingId: uuid('listing_id').references(() => listings.id),
    /** Idempotency for a retried send: the client's key per thread. */
    clientKey: text('client_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('chat_messages_thread_idx').on(t.threadId, t.createdAt), uniqueIndex('chat_messages_client_key_idx').on(t.threadId, t.clientKey)],
);

// ---------- reviews ----------
export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull().references(() => orders.id),
    buyerUserId: uuid('buyer_user_id').notNull().references(() => users.id),
    sellerId: uuid('seller_id').notNull().references(() => sellers.id),
    listingId: uuid('listing_id').notNull().references(() => listings.id),
    rating: integer('rating').notNull(),
    text: text('text').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('reviews_order_idx').on(t.orderId), index('reviews_seller_idx').on(t.sellerId, t.createdAt), index('reviews_listing_idx').on(t.listingId)],
);
export const reviewMedia = pgTable(
  'review_media',
  {
    reviewId: uuid('review_id').notNull().references(() => reviews.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    mediaId: uuid('media_id').notNull().references(() => media.id),
  },
  (t) => [primaryKey({ columns: [t.reviewId, t.position] })],
);

// ---------- buyer requests ----------
export const buyerRequests = pgTable(
  'buyer_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buyerUserId: uuid('buyer_user_id').notNull().references(() => users.id),
    category: text('category').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    size: text('size'),
    budgetPaise: integer('budget_paise'),
    status: text('status', { enum: ['OPEN', 'CLOSED', 'EXPIRED'] }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    reachedCount: integer('reached_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('buyer_requests_buyer_idx').on(t.buyerUserId, t.createdAt), index('buyer_requests_open_idx').on(t.status, t.expiresAt), index('buyer_requests_category_idx').on(t.category, t.status)],
);
export const requestMedia = pgTable(
  'request_media',
  {
    requestId: uuid('request_id').notNull().references(() => buyerRequests.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    mediaId: uuid('media_id').notNull().references(() => media.id),
  },
  (t) => [primaryKey({ columns: [t.requestId, t.position] })],
);
export const requestResponses = pgTable(
  'request_responses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id').notNull().references(() => buyerRequests.id, { onDelete: 'cascade' }),
    sellerId: uuid('seller_id').notNull().references(() => sellers.id),
    text: text('text'),
    pricePaise: integer('price_paise'),
    status: text('status', { enum: ['SENT', 'WANTED', 'DECLINED'] }).notNull(),
    threadId: uuid('thread_id'),
    listingId: uuid('listing_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  // One response per seller per request.
  (t) => [uniqueIndex('request_responses_seller_idx').on(t.requestId, t.sellerId)],
);
export const responseMedia = pgTable(
  'response_media',
  {
    responseId: uuid('response_id').notNull().references(() => requestResponses.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    mediaId: uuid('media_id').notNull().references(() => media.id),
  },
  (t) => [primaryKey({ columns: [t.responseId, t.position] })],
);

/**
 * Who follows what. One row per (follower, kind, target); `target_type` says what `target_id` points at, so following
 * other things later (a collection, a person) needs no new table. Today the only kind is SELLER, and the service checks
 * the target exists. Deleting a follow is a plain delete. Counts come from the indexes below.
 */
export const follows = pgTable(
  'follows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    followerUserId: uuid('follower_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type', { enum: ['SELLER'] }).notNull(),
    targetId: uuid('target_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('follows_edge_idx').on(t.followerUserId, t.targetType, t.targetId),
    index('follows_target_idx').on(t.targetType, t.targetId),
    index('follows_follower_idx').on(t.followerUserId, t.targetType, t.createdAt, t.id),
  ],
);

/**
 * Likes and saves (M3.6). Same shape as `follows`: one row per (person, kind of thing, thing), `target_type` says what
 * `target_id` points at, so liking a comment or saving a shop later needs a new type, not a new table. Only listings today.
 * Counts come from the target index; a like is public as a number only (the seller never sees who).
 */
export const likes = pgTable(
  'likes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type', { enum: ['LISTING'] }).notNull(),
    targetId: uuid('target_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('likes_edge_idx').on(t.userId, t.targetType, t.targetId), index('likes_target_idx').on(t.targetType, t.targetId)],
);

/** Private bookmarks. Nobody but the person sees them; the seller sees only a count. */
export const saves = pgTable(
  'saves',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type', { enum: ['LISTING'] }).notNull(),
    targetId: uuid('target_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex('saves_edge_idx').on(t.userId, t.targetType, t.targetId),
    index('saves_target_idx').on(t.targetType, t.targetId),
    index('saves_person_idx').on(t.userId, t.targetType, t.createdAt, t.id),
  ],
);

/**
 * Public comments on a listing, flat (the foundation's P0: a Q&A, no threads). A comment is never really deleted: the
 * author or the listing's owner sets `removed_at` and `removed_by`, and readers stop seeing it. `client_key` makes a
 * retried post return the first answer.
 */
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    listingId: uuid('listing_id').notNull().references(() => listings.id, { onDelete: 'cascade' }),
    authorUserId: uuid('author_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    clientKey: text('client_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    removedBy: text('removed_by', { enum: ['AUTHOR', 'SELLER'] }),
  },
  (t) => [
    index('comments_listing_idx').on(t.listingId, t.createdAt, t.id),
    index('comments_author_idx').on(t.authorUserId, t.createdAt),
    uniqueIndex('comments_client_key_idx').on(t.authorUserId, t.clientKey),
  ],
);

// ---------- notifications, push, safety (M3.7) ----------
/** One phone's push address for one app. A token belongs to one person at a time: signing in as someone else on the phone rebinds it. */
export const pushTokens = pgTable(
  'push_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    app: text('app', { enum: ['buyer', 'seller'] }).notNull(),
    token: text('token').notNull(),
    platform: text('platform', { enum: ['android', 'ios'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('push_tokens_token_app_idx').on(t.token, t.app), index('push_tokens_user_idx').on(t.userId, t.app)],
);

/** One person blocking another. By person, across both apps (one identity). */
export const userBlocks = pgTable(
  'user_blocks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    blockerUserId: uuid('blocker_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    blockedUserId: uuid('blocked_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('user_blocks_edge_idx').on(t.blockerUserId, t.blockedUserId), index('user_blocks_blocked_idx').on(t.blockedUserId)],
);

/**
 * A report of a comment or a chat message (a message with a photo keeps its photo). `snapshot` keeps the words as reported,
 * so removing the comment afterwards does not erase the evidence. `status` is for a moderation list; the review screen comes later.
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterUserId: uuid('reporter_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    targetType: text('target_type', { enum: ['COMMENT', 'CHAT_MESSAGE'] }).notNull(),
    targetId: uuid('target_id').notNull(),
    /** The person who wrote it. */
    targetUserId: uuid('target_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    reason: text('reason', { enum: ['SPAM', 'ABUSE', 'SCAM', 'OTHER'] }).notNull(),
    note: text('note'),
    snapshot: text('snapshot'),
    mediaId: uuid('media_id'),
    status: text('status', { enum: ['OPEN', 'REVIEWED', 'ACTIONED'] }).notNull().default('OPEN'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('reports_once_idx').on(t.reporterUserId, t.targetType, t.targetId), index('reports_status_idx').on(t.status, t.createdAt), index('reports_reporter_idx').on(t.reporterUserId, t.createdAt)],
);
