import type { Paise } from './money.js';
import { CANCEL_REASONS, RULES, type CancelReason } from './rules.js';
import { hasShipment, validateShipment, type PaymentProfile, type Shipment, type ShipmentInput } from './validators.js';
import { fail, type Channel, type DealAccess, type Notice, type PayMethod, type Result } from './types.js';
import { directMethods } from './validators.js';
import { ratingSummary } from './reviews.js';

export type OrderStatus = 'PLACED' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED' | 'EXPIRED';

export interface Order {
  id: string;
  number: string;
  buyerId: string;
  sellerId: string;
  listingId: string;
  variantId: string;
  price: Paise;
  listPrice: Paise;
  priceSource: 'LIST' | 'NEGOTIATED';
  negotiationId: string | null;
  channel: Channel;
  paymentMethod: PayMethod | null;
  dealAccess: DealAccess | null;
  status: OrderStatus;
  createdAt: number;
  /** The seller must confirm by this time or the order expires. */
  confirmBy: number;
  confirmedAt: number | null;
  shipment: Shipment | null;
  cancelReason: CancelReason | null;
  cancelNote: string | null;
  restocked: boolean;
}

// ---------- placement ----------
export interface PlacementCheck {
  /** Set when buying from an agreed negotiation. */
  agreement: { status: string; belongsToBuyer: boolean } | null;
  listingActive: boolean;
  isOwnListing: boolean;
  channel: Channel;
  variantExists: boolean;
  availableUnits: number;
  addressOk: boolean;
  paymentMethod: PayMethod | undefined;
  sellerPayment: PaymentProfile | null;
}
/** Checks a buyer can place an order. Prices are never taken from the client. */
export function validatePlacement(c: PlacementCheck): Result<{ priceSource: 'LIST' | 'NEGOTIATED' }> {
  let priceSource: 'LIST' | 'NEGOTIATED';
  if (c.agreement) {
    if (!c.agreement.belongsToBuyer) return fail('NOT_FOUND', 'Agreement not found.');
    if (c.agreement.status !== 'AGREED')
      return fail('NOT_AGREED', c.agreement.status === 'LAPSED' ? 'The checkout window for this price has closed.' : 'This offer hasn’t been agreed.');
    priceSource = 'NEGOTIATED';
  } else {
    if (!c.listingActive) return fail('NOT_AVAILABLE', 'This listing isn’t available.');
    if (c.isOwnListing) return fail('OWN_LISTING', 'You can’t buy your own listing.');
    if (c.channel === 'WEBSITE') return fail('USE_WEBSITE', 'This seller sells through their website. Use Buy on website.');
    if (!c.variantExists) return fail('NO_VARIANT', 'Choose a size.');
    if (c.availableUnits < 1) return fail('OUT_OF_STOCK', 'This size just sold out.');
    priceSource = 'LIST';
  }
  if (c.channel === 'DIRECT') {
    if (!c.addressOk) return fail('NO_ADDRESS', 'Choose a delivery address.');
    if (!c.paymentMethod || !directMethods(c.sellerPayment).includes(c.paymentMethod))
      return fail('NO_METHOD', 'Choose how you’ll pay the seller.');
  }
  return { ok: true, priceSource };
}

export function newOrder(init: {
  id: string;
  number: string;
  buyerId: string;
  sellerId: string;
  listingId: string;
  variantId: string;
  price: Paise;
  listPrice: Paise;
  priceSource: 'LIST' | 'NEGOTIATED';
  negotiationId: string | null;
  channel: Channel;
  paymentMethod: PayMethod | null;
  dealAccess: DealAccess | null;
  now: number;
}): Order {
  const { now, ...rest } = init;
  return {
    ...rest,
    status: 'PLACED',
    createdAt: now,
    confirmBy: now + RULES.ORDER_CONFIRM_WINDOW_MS,
    confirmedAt: null,
    shipment: null,
    cancelReason: null,
    cancelNote: null,
    restocked: false,
  };
}

// ---------- seller-driven state changes (only the seller moves an order) ----------
export interface Transition {
  order: Order;
  /** The API must add one unit back to the variant's stock. */
  restock: boolean;
  notices: Notice[];
}

export function confirmOrder(o: Order, shipment: ShipmentInput | undefined, now: number): Result<Transition> {
  if (o.status !== 'PLACED') return fail('INVALID_STATE', 'This order is no longer waiting for confirmation.');
  let clean: Shipment | null = null;
  if (shipment && hasShipment(shipment)) {
    const v = validateShipment(shipment);
    if ('fields' in v) return fail('VALIDATION', 'Check the shipment details.', v.fields);
    clean = v.clean;
  }
  const notices: Notice[] = [{ audience: 'buyer', code: o.channel === 'WEBSITE' ? 'ORDER_CONFIRMED_WEBSITE' : 'PAYMENT_RECEIVED', at: now }];
  let order: Order = { ...o, status: 'CONFIRMED', confirmedAt: now };
  if (clean) {
    order = { ...order, status: 'SHIPPED', shipment: clean };
    notices.push({ audience: 'buyer', code: 'ORDER_SHIPPED', at: now });
  }
  return { ok: true, order, restock: false, notices };
}

export function shipOrder(o: Order, shipment: ShipmentInput, now: number): Result<Transition> {
  if (o.status !== 'CONFIRMED' && o.status !== 'SHIPPED')
    return fail('INVALID_STATE', 'Confirm the order before adding shipment details.');
  const v = validateShipment(shipment);
  if ('fields' in v) return fail('VALIDATION', 'Check the shipment details.', v.fields);
  const first = o.status === 'CONFIRMED';
  return {
    ok: true,
    order: { ...o, status: 'SHIPPED', shipment: v.clean },
    restock: false,
    notices: [{ audience: 'buyer', code: first ? 'ORDER_SHIPPED' : 'SHIPMENT_UPDATED', at: now }],
  };
}

export function deliverOrder(o: Order, now: number): Result<Transition> {
  if (o.status !== 'CONFIRMED' && o.status !== 'SHIPPED')
    return fail('INVALID_STATE', 'Only confirmed orders can be marked delivered.');
  return { ok: true, order: { ...o, status: 'DELIVERED' }, restock: false, notices: [{ audience: 'buyer', code: 'ORDER_DELIVERED', at: now }] };
}

export function cancelOrder(o: Order, reason: string, note: string | undefined, now: number): Result<Transition> {
  if (o.status !== 'PLACED' && o.status !== 'CONFIRMED')
    return fail('INVALID_STATE', 'Shipped or finished orders can’t be cancelled here.');
  if (!(reason in CANCEL_REASONS)) return fail('VALIDATION', 'Choose a reason.', { reason: 'Choose a reason.' });
  const r = reason as CancelReason;
  const restock = r !== 'OUT_OF_STOCK' && !o.restocked;
  return {
    ok: true,
    order: { ...o, status: 'CANCELLED', cancelReason: r, cancelNote: (note ?? '').trim().slice(0, 200), restocked: o.restocked || restock || r === 'OUT_OF_STOCK' },
    restock,
    notices: [{ audience: 'buyer', code: 'ORDER_CANCELLED', at: now, params: { reason: r } }],
  };
}

/** Unconfirmed orders expire after the confirmation window and restock. */
export function expireOrderIfDue(o: Order, now: number): Transition | null {
  if (o.status !== 'PLACED' || now < o.confirmBy) return null;
  const restock = !o.restocked;
  return {
    order: { ...o, status: 'EXPIRED', restocked: true },
    restock,
    notices: [
      { audience: 'buyer', code: 'ORDER_EXPIRED', at: now },
      { audience: 'seller', code: 'ORDER_EXPIRED', at: now },
    ],
  };
}

// ---------- public seller record (O-7) ----------
export interface SellerStats {
  orders: number;
  completed: number;
  confirmed: number;
  cancelled: number;
  expired: number;
  medianConfirmMs: number | null;
  /** Average star rating to 1 decimal place, or null with no reviews. */
  rating: number | null;
  reviewCount: number;
}
export function sellerStats(orders: readonly Order[], ratings: readonly number[] = []): SellerStats {
  const times = orders
    .filter((o) => o.confirmedAt != null)
    .map((o) => (o.confirmedAt as number) - o.createdAt)
    .sort((a, b) => a - b);
  return {
    orders: orders.length,
    completed: orders.filter((o) => o.status === 'DELIVERED').length,
    confirmed: orders.filter((o) => o.confirmedAt != null).length,
    cancelled: orders.filter((o) => o.status === 'CANCELLED').length,
    expired: orders.filter((o) => o.status === 'EXPIRED').length,
    medianConfirmMs: times.length ? (times[Math.floor((times.length - 1) / 2)] as number) : null,
    ...ratingSummary(ratings),
  };
}

/** O-3: seller payment details are visible only to the buyer of a direct order that is still PLACED. */
export const buyerMaySeePayment = (o: Pick<Order, 'status' | 'channel'>): boolean => o.status === 'PLACED' && o.channel === 'DIRECT';

export type BuyAgain =
  | { listingId: string; channel: Channel; /** Set when the order's size is in stock: go straight to checkout. */ variantId: string | null; anyAvailable: boolean }
  | null;
/** Buy again is offered only while the listing is ACTIVE. Website listings always open the product page. */
export function buyAgain(l: { id: string; status: string; channel: Channel } | null, variantId: string, availableByVariant: Record<string, number>): BuyAgain {
  if (!l || l.status !== 'ACTIVE') return null;
  return {
    listingId: l.id,
    channel: l.channel,
    variantId: l.channel === 'DIRECT' && (availableByVariant[variantId] ?? 0) > 0 ? variantId : null,
    anyAvailable: Object.values(availableByVariant).some((n) => n > 0),
  };
}
