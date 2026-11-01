import { EpochMsSchema } from './common.js';
import { z } from './zod.js';

/** Where tapping a notification goes. Ids only; the app opens its own screen for that kind. */
export const NotificationTargetSchema = z.object({ kind: z.enum(['ORDER', 'THREAD', 'NEGOTIATION', 'REQUEST', 'LISTING']), id: z.string() }).openapi('NotificationTarget');
export type NotificationTarget = z.infer<typeof NotificationTargetSchema>;

/**
 * One notification, with its words already written by the server for the app that asks. Buyer notifications are
 * built from buyer facts only: an automatic counter reads like the seller's own reply (R-private rules).
 */
export const NotificationSchema = z
  .object({
    id: z.string(),
    code: z.string(),
    title: z.string(),
    body: z.string(),
    at: EpochMsSchema,
    read: z.boolean(),
    target: NotificationTargetSchema.nullable(),
  })
  .openapi('Notification');
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationListSchema = z.object({ items: z.array(NotificationSchema), nextCursor: z.string().nullable(), unread: z.number().int() }).openapi('NotificationList');
export type NotificationList = z.infer<typeof NotificationListSchema>;

export const NotificationQuerySchema = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(50).optional() }).openapi('NotificationQuery');
export type NotificationQuery = z.infer<typeof NotificationQuerySchema>;

export const UnreadCountSchema = z.object({ unread: z.number().int() }).openapi('UnreadCount');
export type UnreadCount = z.infer<typeof UnreadCountSchema>;

/** The phone's push address (an Expo push token). Sent after sign-in and whenever it changes. */
export const PushTokenInputSchema = z
  .object({ token: z.string().min(10).max(200).regex(/^(Expo|Exponent)PushToken\[[^\]]+\]$/, 'Not an Expo push token'), platform: z.enum(['android', 'ios']) })
  .openapi('PushTokenInput');
export type PushTokenInput = z.infer<typeof PushTokenInputSchema>;

/** Real-time: a notification was written for this person in this app. Ids only; the app refetches. */
export const NotificationEventSchema = z.object({ notificationId: z.string() });
export type NotificationEventPayload = z.infer<typeof NotificationEventSchema>;
