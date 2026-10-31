import { index, integer, jsonb, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
  bankHolder: text('bank_holder'),
  bankAccount: text('bank_account'),
  bankIfsc: text('bank_ifsc'),
  bankName: text('bank_name'),
  paymentLink: text('payment_link'),
  website: text('website'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
