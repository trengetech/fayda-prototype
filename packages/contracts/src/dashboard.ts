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

export const SellerDashboardSchema = z
  .object({
    /** Last 7 days and last 30 days. */
    windows: z.array(DashboardWindowSchema),
    /** All time, as buyers see it (includes the median time to confirm). */
    record: SellerRecordSchema,
    needsReply: z.number().int(),
    needsConfirm: z.number().int(),
  })
  .openapi('SellerDashboard');
export type SellerDashboard = z.infer<typeof SellerDashboardSchema>;
