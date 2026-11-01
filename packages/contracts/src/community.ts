import { EpochMsSchema, PaiseSchema } from './common.js';
import { z } from './zod.js';

const MediaRefSchema = z.object({ id: z.string(), kind: z.enum(['image', 'video']), url: z.string() });
export type MediaRef = z.infer<typeof MediaRefSchema>;

// ---------- chat ----------
export const SendMessageSchema = z
  .object({
    text: z.string().max(1000).nullish(),
    mediaId: z.string().uuid().nullish(),
    /** A seller may share one of their own live listings. */
    listingId: z.string().uuid().nullish(),
    /** The client's key for this message, so a retry cannot post it twice. */
    clientKey: z.string().min(8).max(64).nullish(),
  })
  .openapi('SendMessage');
export type SendMessage = z.infer<typeof SendMessageSchema>;

export const ChatMessageSchema = z
  .object({
    id: z.string(),
    from: z.enum(['ME', 'OTHER', 'SYSTEM']),
    type: z.enum(['TEXT', 'MEDIA', 'LISTING']),
    text: z.string().nullable(),
    media: MediaRefSchema.nullable(),
    listing: z.object({ id: z.string(), title: z.string(), price: PaiseSchema, coverUrl: z.string().nullable() }).nullable(),
    at: EpochMsSchema,
  })
  .openapi('ChatMessage');
export type ChatMessageView = z.infer<typeof ChatMessageSchema>;

export const ChatThreadSchema = z
  .object({
    id: z.string(),
    kind: z.enum(['ORDER', 'REQUEST']),
    /** What the thread is about: "FD-100001 · Kurta" or the request title. */
    title: z.string(),
    otherName: z.string(),
    orderId: z.string().nullable(),
    requestId: z.string().nullable(),
    /** An order thread stays open for chat after the order closes; contact numbers do not. */
    unread: z.number().int(),
    lastMessage: z.string().nullable(),
    lastAt: EpochMsSchema,
    /** New messages are off because one of the two blocked the other. */
    messagingDisabled: z.boolean(),
    /** I am the one who blocked (so I can unblock from here). */
    youBlocked: z.boolean(),
    messages: z.array(ChatMessageSchema),
  })
  .openapi('ChatThread');
export type ChatThread = z.infer<typeof ChatThreadSchema>;
export const ChatThreadListSchema = z.object({ items: z.array(ChatThreadSchema.omit({ messages: true })), unread: z.number().int() }).openapi('ChatThreadList');
export type ChatThreadList = z.infer<typeof ChatThreadListSchema>;
export const ChatEventSchema = z.object({ threadId: z.string() }).openapi('ChatEvent');
export type ChatEventPayload = z.infer<typeof ChatEventSchema>;

// ---------- reviews ----------
export const PutReviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    text: z.string().max(1000).nullish(),
    /** Omit to keep the existing photos and videos when editing. */
    mediaIds: z.array(z.string().uuid()).max(4).nullish(),
  })
  .openapi('PutReview');
export type PutReview = z.infer<typeof PutReviewSchema>;
export const ShopReviewSchema = z
  .object({ id: z.string(), rating: z.number().int(), text: z.string(), media: z.array(MediaRefSchema), buyerName: z.string(), listingTitle: z.string(), createdAt: EpochMsSchema, verified: z.literal(true) })
  .openapi('ShopReview');
export type ShopReview = z.infer<typeof ShopReviewSchema>;
export const ShopReviewListSchema = z.object({ items: z.array(ShopReviewSchema), rating: z.number().nullable(), reviewCount: z.number().int() }).openapi('ShopReviewList');
export type ShopReviewList = z.infer<typeof ShopReviewListSchema>;

// ---------- requests ----------
export const CreateRequestSchema = z
  .object({
    category: z.string().max(40),
    title: z.string().max(100),
    description: z.string().max(600).nullish(),
    size: z.string().max(20).nullish(),
    budget: PaiseSchema.nullish(),
    mediaIds: z.array(z.string().uuid()).max(4),
  })
  .openapi('CreateRequest');
export type CreateRequest = z.infer<typeof CreateRequestSchema>;
export const RespondSchema = z
  .object({ text: z.string().max(600).nullish(), price: PaiseSchema.nullish(), mediaIds: z.array(z.string().uuid()).max(4) })
  .openapi('RespondToRequest');
export type Respond = z.infer<typeof RespondSchema>;

const ResponseStatusSchema = z.enum(['SENT', 'WANTED', 'DECLINED']);
export const BuyerRequestSchema = z
  .object({
    id: z.string(),
    category: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    size: z.string().nullable(),
    budget: PaiseSchema.nullable(),
    media: z.array(MediaRefSchema),
    status: z.enum(['OPEN', 'CLOSED', 'EXPIRED']),
    expiresAt: EpochMsSchema,
    reachedCount: z.number().int(),
    createdAt: EpochMsSchema,
    responses: z.array(
      z.object({
        id: z.string(),
        status: ResponseStatusSchema,
        seller: z.object({ id: z.string(), name: z.string(), area: z.string(), rating: z.number().nullable(), reviewCount: z.number().int() }),
        text: z.string().nullable(),
        price: PaiseSchema.nullable(),
        media: z.array(MediaRefSchema),
        threadId: z.string().nullable(),
        listingId: z.string().nullable(),
      }),
    ),
  })
  .openapi('BuyerRequest');
export type BuyerRequest = z.infer<typeof BuyerRequestSchema>;
export const BuyerRequestListSchema = z.object({ items: z.array(BuyerRequestSchema) }).openapi('BuyerRequestList');
export type BuyerRequestList = z.infer<typeof BuyerRequestListSchema>;

export const SellerRequestSchema = z
  .object({
    id: z.string(),
    category: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    size: z.string().nullable(),
    budget: PaiseSchema.nullable(),
    media: z.array(MediaRefSchema),
    buyerFirstName: z.string(),
    status: z.enum(['OPEN', 'CLOSED', 'EXPIRED']),
    expiresAt: EpochMsSchema,
    createdAt: EpochMsSchema,
    /** This seller's own response, if any. */
    response: z
      .object({ id: z.string(), status: ResponseStatusSchema, text: z.string().nullable(), price: PaiseSchema.nullable(), media: z.array(MediaRefSchema), threadId: z.string().nullable(), listingId: z.string().nullable() })
      .nullable(),
  })
  .openapi('SellerRequest');
export type SellerRequest = z.infer<typeof SellerRequestSchema>;
export const SellerRequestListSchema = z.object({ items: z.array(SellerRequestSchema), newCount: z.number().int() }).openapi('SellerRequestList');
export type SellerRequestList = z.infer<typeof SellerRequestListSchema>;
export const RequestEventSchema = z.object({ requestId: z.string() }).openapi('RequestEvent');
export type RequestEventPayload = z.infer<typeof RequestEventSchema>;
