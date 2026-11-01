import { SellerRecordSchema } from './orders.js';
import { z } from './zod.js';

/** What happened in a window. */
export const DashboardWindowSchema = z
  .object({
    days: z.number().int(),
    /** Buyers opening the product page: one per person per listing per hour, your own opens excluded. */
    views: z.number().int(),
    offersReceived: z.number().int(),
    offersAgreed: z.number().int(),
    ordersPlaced: z.number().int(),
    ordersConfirmed: z.number().int(),
    ordersDelivered: z.number().int(),
    likes: z.number().int(),
    saves: z.number().int(),
    comments: z.number().int(),
  })
  .openapi('DashboardWindow');
export type DashboardWindow = z.infer<typeof DashboardWindowSchema>;

/** One listing's numbers in one window. Views are product-page opens (one per person per hour, your own excluded). */
export const ListingNumbersSchema = z
  .object({
    views: z.number().int(),
    likes: z.number().int(),
    saves: z.number().int(),
    /** Other people's comments; the shop's own replies are not counted. */
    comments: z.number().int(),
    offers: z.number().int(),
    orders: z.number().int(),
    /** Orders placed per 100 views, to one decimal place. Null with no views. */
    conversionPct: z.number().nullable(),
  })
  .openapi('ListingNumbers');
export type ListingNumbers = z.infer<typeof ListingNumbersSchema>;

export const ListingDashboardRowSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    status: z.enum(['ACTIVE', 'PAUSED']),
    /** Keyed by window length in days: "7" and "30". */
    last7: ListingNumbersSchema,
    last30: ListingNumbersSchema,
  })
  .openapi('ListingDashboardRow');
export type ListingDashboardRow = z.infer<typeof ListingDashboardRowSchema>;

export const SellerDashboardSchema = z
  .object({
    /** Last 7 days and last 30 days. */
    windows: z.array(DashboardWindowSchema),
    /** All time, as buyers see it (includes the median time to confirm). */
    record: SellerRecordSchema,
    needsReply: z.number().int(),
    needsConfirm: z.number().int(),
    /** Each live or paused listing with its own numbers, busiest (most views in 30 days) first. Seller-only: buyers never get offers, orders or conversion. */
    listings: z.array(ListingDashboardRowSchema),
  })
  .openapi('SellerDashboard');
export type SellerDashboard = z.infer<typeof SellerDashboardSchema>;
