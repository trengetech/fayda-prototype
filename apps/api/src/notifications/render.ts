import type { NotificationTarget } from '@fayda/contracts';
import { formatRupees } from '@fayda/domain';

type App = 'buyer' | 'seller';
type Params = Record<string, string | number> | null;
export interface RenderedText {
  title: string;
  body: string;
}

const rupees = (p: Params): string => (typeof p?.amount === 'number' ? formatRupees(p.amount) : '');
const num = (p: Params): string => (p?.number ? String(p.number) : 'your order');
const REASONS: Record<string, string> = { SOLD_OUT: 'it is sold out', LISTING_PAUSED: 'the listing was paused', LISTING_REMOVED: 'the listing was removed', EXPIRED: 'it expired' };

/**
 * The words of a notification, written per app from the stored `code` and `params`. Buyer text is built from what a buyer
 * may know: an automatic counter, accept or decline reads like the seller's own reply (the buyer codes never say "auto").
 * Seller-only codes are never rendered for the buyer app, and the reverse.
 */
const BUYER: Record<string, (p: Params) => RenderedText> = {
  SELLER_COUNTERED: (p) => ({ title: 'The seller replied', body: `The seller countered with ${rupees(p)}.` }),
  OFFER_ACCEPTED: (p) => ({ title: 'Your offer was accepted', body: `Agreed at ${rupees(p)}. Place your order before the hold ends.` }),
  YOU_ACCEPTED: (p) => ({ title: 'Deal agreed', body: `You accepted ${rupees(p)}. Place your order before the hold ends.` }),
  SELLER_DECLINED: () => ({ title: 'Offer declined', body: 'The seller declined your offer.' }),
  OFFER_EXPIRED: () => ({ title: 'Offer expired', body: 'Your offer ran out of time.' }),
  AGREEMENT_LAPSED: () => ({ title: 'Deal lapsed', body: 'The hold on your agreed deal has ended.' }),
  NEGOTIATION_CLOSED: (p) => ({ title: 'Offer closed', body: `Your offer was closed${typeof p?.reason === 'string' && REASONS[p.reason] ? ` because ${REASONS[p.reason]}` : ''}.` }),
  PAYMENT_RECEIVED: (p) => ({ title: 'Order confirmed', body: `The seller confirmed ${num(p)}.` }),
  ORDER_CONFIRMED_WEBSITE: (p) => ({ title: 'Order recorded', body: `The seller confirmed ${num(p)}.` }),
  ORDER_SHIPPED: (p) => ({ title: 'Order shipped', body: `${num(p)} is on its way.` }),
  SHIPMENT_UPDATED: (p) => ({ title: 'Shipping update', body: `The shipping details for ${num(p)} changed.` }),
  ORDER_DELIVERED: (p) => ({ title: 'Order delivered', body: `${num(p)} was marked delivered.` }),
  ORDER_CANCELLED: (p) => ({ title: 'Order cancelled', body: `The seller cancelled ${num(p)}.` }),
  ORDER_EXPIRED: (p) => ({ title: 'Order expired', body: `${num(p)} was not confirmed in time and has expired.` }),
  NEW_MESSAGE: () => ({ title: 'New message', body: 'You have a new message.' }),
  NEW_RESPONSE: () => ({ title: 'A shop replied to your request', body: 'Open it to see the answer.' }),
  REQUEST_EXPIRED: () => ({ title: 'Request expired', body: 'Your request has ended.' }),
};

const SELLER: Record<string, (p: Params) => RenderedText> = {
  NEW_OFFER: (p) => ({ title: 'New offer', body: `A buyer offered ${rupees(p)}.` }),
  AUTO_COUNTERED: (p) => ({ title: 'Automatic counter sent', body: `Your rule countered with ${rupees(p)}.` }),
  AUTO_DECLINED: (p) => ({ title: 'Automatic decline', body: `Your rule declined an offer of ${rupees(p)}.` }),
  AUTO_ACCEPTED: (p) => ({ title: 'Automatic accept', body: `Your rule accepted ${rupees(p)}.` }),
  BUYER_ACCEPTED: (p) => ({ title: 'Buyer accepted', body: `The buyer accepted ${rupees(p)}. An order may follow.` }),
  YOU_ACCEPTED: (p) => ({ title: 'Deal agreed', body: `You accepted ${rupees(p)}.` }),
  BUYER_DECLINED: () => ({ title: 'Buyer declined', body: 'The buyer declined your counter.' }),
  BUYER_WITHDREW: () => ({ title: 'Offer withdrawn', body: 'The buyer withdrew their offer.' }),
  OFFER_EXPIRED: () => ({ title: 'Offer expired', body: 'An offer ran out of time.' }),
  AGREEMENT_LAPSED: () => ({ title: 'Deal lapsed', body: 'An agreed deal was not ordered in time.' }),
  NEGOTIATION_CLOSED: (p) => ({ title: 'Offer closed', body: `An offer was closed${typeof p?.reason === 'string' && REASONS[p.reason] ? ` because ${REASONS[p.reason]}` : ''}.` }),
  ORDER_PLACED: (p) => ({ title: 'New order', body: `${num(p)} is waiting for you to confirm.` }),
  ORDER_EXPIRED: (p) => ({ title: 'Order expired', body: `${num(p)} was not confirmed in time and has expired.` }),
  NEW_MESSAGE: () => ({ title: 'New message', body: 'You have a new message.' }),
  NEW_REQUEST: () => ({ title: 'New buyer request', body: 'A buyer is looking for something in your category.' }),
  RESPONSE_WANTED: () => ({ title: 'Buyer wants your listing', body: 'A buyer wants what you offered.' }),
  RESPONSE_DECLINED: () => ({ title: 'Buyer passed', body: 'A buyer passed on your response.' }),
  REVIEW_POSTED: (p) => ({ title: 'New review', body: typeof p?.rating === 'number' ? `A buyer left ${p.rating} ${p.rating === 1 ? 'star' : 'stars'}.` : 'A buyer left a review.' }),
  REVIEW_UPDATED: () => ({ title: 'Review updated', body: 'A buyer changed their review.' }),
  NEW_COMMENT: (p) => ({ title: 'New comment', body: `${typeof p?.title === 'string' ? `On ${p.title}: ` : ''}${typeof p?.snippet === 'string' ? p.snippet : 'Open it to read.'}` }),
};

export function renderNotification(app: App, code: string, params: Params): RenderedText {
  const fn = (app === 'buyer' ? BUYER : SELLER)[code];
  return fn ? fn(params) : { title: 'Fayda', body: 'You have an update.' };
}

/** Where a tap goes. Orders and negotiations beat threads, which beat requests and listings. */
export function targetOf(r: { negotiationId: string | null; orderId: string | null; threadId: string | null; requestId: string | null; listingId: string | null; code: string }): NotificationTarget | null {
  if (r.code === 'NEW_MESSAGE' && r.threadId) return { kind: 'THREAD', id: r.threadId };
  if (r.orderId) return { kind: 'ORDER', id: r.orderId };
  if (r.negotiationId) return { kind: 'NEGOTIATION', id: r.negotiationId };
  if (r.threadId) return { kind: 'THREAD', id: r.threadId };
  if (r.requestId) return { kind: 'REQUEST', id: r.requestId };
  if (r.listingId) return { kind: 'LISTING', id: r.listingId };
  return null;
}
