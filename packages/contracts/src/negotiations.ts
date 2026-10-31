import { EpochMsSchema, PaiseSchema } from './common.js';
import { z } from './zod.js';

const DealAccessSchema = z.object({ type: z.enum(['CODE', 'LINK']), value: z.string().max(500) }).openapi('NegotiationDealAccess');

// ---------- requests ----------
/** A buyer's first offer on a size. Whole rupees, in paise. */
export const StartOfferSchema = z.object({ variantId: z.string().uuid(), amount: PaiseSchema }).openapi('StartOffer');
export type StartOffer = z.infer<typeof StartOfferSchema>;

/** A counter-offer from either side. A seller on a website listing also sends the code or link that gives that price. */
export const CounterSchema = z.object({ amount: PaiseSchema, dealAccess: DealAccessSchema.nullish() }).openapi('Counter');
export type Counter = z.infer<typeof CounterSchema>;

/** Accepting. A seller on a website listing must send the code or link that gives the agreed price; a buyer sends nothing. */
export const AcceptSchema = z.object({ dealAccess: DealAccessSchema.nullish() }).openapi('Accept');
export type Accept = z.infer<typeof AcceptSchema>;

// ---------- buyer view ----------
const ListingCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  price: PaiseSchema,
  coverUrl: z.string().nullable(),
  variantLabel: z.string(),
  sellerName: z.string(),
});

/**
 * What a buyer sees of a negotiation. Built from an allow-list: no private rules, no pending automatic reply, and
 * nothing that says a reply was automatic (decision B-7). Contract tests scan responses for these.
 */
export const BuyerNegotiationSchema = z
  .object({
    id: z.string(),
    listing: ListingCardSchema,
    status: z.enum(['OPEN', 'AGREED', 'PURCHASED', 'LAPSED', 'CLOSED']),
    statusLabel: z.string(),
    closeReason: z.string().nullable(),
    closeText: z.string().nullable(),
    variantId: z.string(),
    offers: z.array(z.object({ id: z.string(), side: z.enum(['ME', 'SELLER']), amount: PaiseSchema, status: z.string(), at: EpochMsSchema, expiresAt: EpochMsSchema })),
    events: z.array(z.object({ type: z.string(), at: EpochMsSchema, actor: z.enum(['ME', 'SELLER']), reason: z.string().nullable() })),
    pendingExpiresAt: EpochMsSchema.nullable(),
    agreement: z.object({ price: PaiseSchema, deadline: EpochMsSchema, dealAccess: DealAccessSchema.nullable() }).nullable(),
    channel: z.enum(['DIRECT', 'WEBSITE']),
    /** Set once the buyer has placed the order for this agreement. */
    orderId: z.string().nullable(),
    canRespond: z.boolean(),
    canCounter: z.boolean(),
    canWithdraw: z.boolean(),
    counterBounds: z.object({ minExclusive: PaiseSchema, maxExclusive: PaiseSchema }).nullable(),
    offersLeft: z.number().int(),
    updatedAt: EpochMsSchema,
  })
  .openapi('BuyerNegotiation');
export type BuyerNegotiation = z.infer<typeof BuyerNegotiationSchema>;
export const BuyerNegotiationListSchema = z.object({ items: z.array(BuyerNegotiationSchema) }).openapi('BuyerNegotiationList');
export type BuyerNegotiationList = z.infer<typeof BuyerNegotiationListSchema>;

// ---------- seller view ----------
/** The seller sees who made each offer, including their own automatic replies. Never used on a buyer route. */
export const SellerNegotiationSchema = z
  .object({
    id: z.string(),
    listing: ListingCardSchema.extend({ channel: z.enum(['DIRECT', 'WEBSITE']) }),
    buyerName: z.string(),
    status: z.enum(['OPEN', 'AGREED', 'PURCHASED', 'LAPSED', 'CLOSED']),
    closeReason: z.string().nullable(),
    offers: z.array(z.object({ id: z.string(), by: z.enum(['BUYER', 'SELLER', 'SYSTEM']), amount: PaiseSchema, status: z.string(), at: EpochMsSchema, expiresAt: EpochMsSchema, dealAccess: DealAccessSchema.nullable() })),
    agreement: z.object({ price: PaiseSchema, deadline: EpochMsSchema, acceptedBy: z.enum(['BUYER', 'SELLER', 'SYSTEM']), dealAccess: DealAccessSchema.nullable() }).nullable(),
    /** The buyer's offer is waiting for this seller to reply. */
    needsReply: z.boolean(),
    canCounter: z.boolean(),
    /** Bounds for a counter: above the buyer's offer, below the seller's last counter (or the list price). */
    counterBounds: z.object({ minExclusive: PaiseSchema, maxExclusive: PaiseSchema }).nullable(),
    pendingExpiresAt: EpochMsSchema.nullable(),
    updatedAt: EpochMsSchema,
  })
  .openapi('SellerNegotiation');
export type SellerNegotiation = z.infer<typeof SellerNegotiationSchema>;
export const SellerNegotiationListSchema = z.object({ items: z.array(SellerNegotiationSchema), needsReply: z.number().int() }).openapi('SellerNegotiationList');
export type SellerNegotiationList = z.infer<typeof SellerNegotiationListSchema>;

/** Real-time event. It carries ids only; clients refetch what changed. */
export const NegotiationEventSchema = z.object({ negotiationId: z.string(), listingId: z.string() }).openapi('NegotiationEvent');
export type NegotiationEventPayload = z.infer<typeof NegotiationEventSchema>;
