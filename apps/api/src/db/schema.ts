import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { DealAccess, Negotiation } from '@fayda/domain';

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
    purpose: text('purpose', { enum: ['LISTING', 'UPI_QR'] }).notNull(),
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
  (t) => [index('listings_seller_idx').on(t.sellerId, t.status), index('listings_feed_idx').on(t.status, t.publishedAt, t.id)],
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.app, t.createdAt)],
);
