import { EpochMsSchema, PaiseSchema } from './common.js';
import { z } from './zod.js';

const DealAccessSchema = z.object({ type: z.enum(['CODE', 'LINK']), value: z.string().max(500) }).openapi('OrderDealAccess');
export const OrderStatusSchema = z.enum(['PLACED', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'EXPIRED']).openapi('OrderStatus');
export const PayMethodSchema = z.enum(['UPI', 'BANK', 'LINK']).openapi('PayMethod');
export const CancelReasonSchema = z.enum(['PAYMENT_NOT_RECEIVED', 'WEBSITE_ORDER_NOT_FOUND', 'OUT_OF_STOCK', 'BUYER_REQUEST', 'OTHER']).openapi('CancelReason');

// ---------- requests ----------
/**
 * Places an order. Prices are never sent: the server takes them from the listing, or from the agreement when `negotiationId` is set.
 * A direct listing needs an address and a way to pay; a website deal (agreement on a website listing) needs neither.
 */
export const PlaceOrderSchema = z
  .object({
    listingId: z.string().uuid().nullish(),
    variantId: z.string().uuid().nullish(),
    negotiationId: z.string().uuid().nullish(),
    addressId: z.string().uuid().nullish(),
    paymentMethod: PayMethodSchema.nullish(),
  })
  .openapi('PlaceOrder');
export type PlaceOrder = z.infer<typeof PlaceOrderSchema>;

export const ShipmentSchema = z
  .object({
    courier: z.string().max(60).nullish(),
    trackingNo: z.string().max(60).nullish(),
    trackingUrl: z.string().max(500).nullish(),
    expectedDate: z.string().max(10).nullish(),
    note: z.string().max(200).nullish(),
  })
  .openapi('ShipmentInput');
export type ShipmentBody = z.infer<typeof ShipmentSchema>;
export const ConfirmOrderSchema = z.object({ shipment: ShipmentSchema.nullish() }).openapi('ConfirmOrder');
export type ConfirmOrder = z.infer<typeof ConfirmOrderSchema>;
export const CancelOrderSchema = z.object({ reason: CancelReasonSchema, note: z.string().max(200).nullish() }).openapi('CancelOrder');
export type CancelOrder = z.infer<typeof CancelOrderSchema>;

// ---------- shared pieces ----------
const ShipmentViewSchema = z.object({
  courier: z.string().nullable(),
  trackingNo: z.string().nullable(),
  trackingUrl: z.string().nullable(),
  expectedDate: z.string().nullable(),
  note: z.string().nullable(),
});
const AddressSchema = z.object({ name: z.string(), line1: z.string(), line2: z.string(), pin: z.string(), city: z.string(), state: z.string() });
const ContactSchema = z.object({ phone: z.string().nullable(), whatsapp: z.string().nullable() });
const OrderListingSchema = z.object({ id: z.string(), title: z.string(), coverUrl: z.string().nullable(), variantLabel: z.string(), channel: z.enum(['DIRECT', 'WEBSITE']) });
/** The public record of a seller (O-7), plus the rating. */
export const SellerRecordSchema = z
  .object({
    orders: z.number().int(),
    completed: z.number().int(),
    confirmed: z.number().int(),
    cancelled: z.number().int(),
    expired: z.number().int(),
    medianConfirmMs: z.number().nullable(),
    rating: z.number().nullable(),
    reviewCount: z.number().int(),
  })
  .openapi('SellerRecord');
export type SellerRecord = z.infer<typeof SellerRecordSchema>;

/** How to pay. Present only on the buyer's own direct order while it is PLACED (O-3). */
export const PaymentInstructionsSchema = z
  .object({
    method: PayMethodSchema,
    /** The order number: the buyer writes it as the payment note. */
    note: z.string(),
    amount: PaiseSchema,
    payeeName: z.string(),
    upiId: z.string().nullable(),
    /** `upi://pay?...` for "Pay in a UPI app". Null unless the method is UPI and the seller has a UPI ID. */
    upiUri: z.string().nullable(),
    /** The seller's QR image is private; this is the order-scoped address that serves it. */
    upiQrUrl: z.string().nullable(),
    bank: z.object({ holder: z.string(), account: z.string(), ifsc: z.string(), bankName: z.string().nullable() }).nullable(),
    paymentLink: z.string().nullable(),
  })
  .openapi('PaymentInstructions');
export type PaymentInstructions = z.infer<typeof PaymentInstructionsSchema>;

const ReviewViewSchema = z.object({ id: z.string(), rating: z.number().int(), text: z.string(), media: z.array(z.object({ id: z.string(), kind: z.enum(['image', 'video']), url: z.string() })), createdAt: EpochMsSchema, editedAt: EpochMsSchema.nullable() });
export type ReviewView = z.infer<typeof ReviewViewSchema>;
const BuyAgainSchema = z.object({ listingId: z.string(), channel: z.enum(['DIRECT', 'WEBSITE']), variantId: z.string().nullable(), anyAvailable: z.boolean() });

// ---------- buyer view ----------
export const BuyerOrderSchema = z
  .object({
    id: z.string(),
    number: z.string(),
    status: OrderStatusSchema,
    statusLabel: z.string(),
    listing: OrderListingSchema,
    price: PaiseSchema,
    listPrice: PaiseSchema,
    priceSource: z.enum(['LIST', 'NEGOTIATED']),
    channel: z.enum(['DIRECT', 'WEBSITE']),
    paymentMethod: PayMethodSchema.nullable(),
    dealAccess: DealAccessSchema.nullable(),
    address: AddressSchema.nullable(),
    createdAt: EpochMsSchema,
    confirmBy: EpochMsSchema,
    confirmedAt: EpochMsSchema.nullable(),
    shipment: ShipmentViewSchema.nullable(),
    cancelText: z.string().nullable(),
    seller: z.object({
      id: z.string(),
      name: z.string(),
      area: z.string(),
      slaConfirmHours: z.number().int(),
      slaShipDays: z.number().int(),
      record: SellerRecordSchema,
      /** The seller's phone and WhatsApp, only while the order is open (D12). */
      contact: ContactSchema.nullable(),
    }),
    payment: PaymentInstructionsSchema.nullable(),
    review: ReviewViewSchema.nullable(),
    canReview: z.boolean(),
    buyAgain: BuyAgainSchema.nullable(),
    threadId: z.string().nullable(),
    unread: z.number().int(),
  })
  .openapi('BuyerOrder');
export type BuyerOrder = z.infer<typeof BuyerOrderSchema>;
export const BuyerOrderListSchema = z.object({ items: z.array(BuyerOrderSchema), unread: z.number().int() }).openapi('BuyerOrderList');
export type BuyerOrderList = z.infer<typeof BuyerOrderListSchema>;

// ---------- seller view ----------
export const SellerOrderSchema = z
  .object({
    id: z.string(),
    number: z.string(),
    status: OrderStatusSchema,
    statusLabel: z.string(),
    listing: OrderListingSchema,
    price: PaiseSchema,
    priceSource: z.enum(['LIST', 'NEGOTIATED']),
    channel: z.enum(['DIRECT', 'WEBSITE']),
    paymentMethod: PayMethodSchema.nullable(),
    dealAccess: DealAccessSchema.nullable(),
    buyerName: z.string(),
    address: AddressSchema.nullable(),
    createdAt: EpochMsSchema,
    confirmBy: EpochMsSchema,
    confirmedAt: EpochMsSchema.nullable(),
    shipment: ShipmentViewSchema.nullable(),
    cancelText: z.string().nullable(),
    /** The buyer's phone and WhatsApp, only while the order is open (D12). */
    buyerContact: ContactSchema.nullable(),
    review: ReviewViewSchema.nullable(),
    canConfirm: z.boolean(),
    canShip: z.boolean(),
    canDeliver: z.boolean(),
    canCancel: z.boolean(),
    threadId: z.string().nullable(),
    unread: z.number().int(),
  })
  .openapi('SellerOrder');
export type SellerOrder = z.infer<typeof SellerOrderSchema>;
export const SellerOrderListSchema = z.object({ items: z.array(SellerOrderSchema), needsConfirm: z.number().int(), unread: z.number().int() }).openapi('SellerOrderList');
export type SellerOrderList = z.infer<typeof SellerOrderListSchema>;

/** Real-time: ids only. */
export const OrderEventSchema = z.object({ orderId: z.string() }).openapi('OrderEvent');
export type OrderEventPayload = z.infer<typeof OrderEventSchema>;
