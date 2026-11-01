import { ALWAYS_ON_CATEGORIES, type NotificationCategory } from '@fayda/contracts';

/** Which settings switch a notification code belongs to. Every code in `render.ts` must be listed here (a test checks). */
export const CATEGORY_CODES: Record<NotificationCategory, string[]> = {
  ORDERS: ['PAYMENT_RECEIVED', 'ORDER_CONFIRMED_WEBSITE', 'ORDER_SHIPPED', 'SHIPMENT_UPDATED', 'ORDER_DELIVERED', 'ORDER_CANCELLED', 'ORDER_EXPIRED', 'ORDER_PLACED'],
  OFFERS: ['SELLER_COUNTERED', 'OFFER_ACCEPTED', 'YOU_ACCEPTED', 'SELLER_DECLINED', 'OFFER_EXPIRED', 'AGREEMENT_LAPSED', 'NEGOTIATION_CLOSED', 'NEW_OFFER', 'AUTO_COUNTERED', 'AUTO_DECLINED', 'AUTO_ACCEPTED', 'BUYER_ACCEPTED', 'BUYER_DECLINED', 'BUYER_WITHDREW'],
  CHAT: ['NEW_MESSAGE'],
  REQUESTS: ['NEW_RESPONSE', 'REQUEST_EXPIRED', 'NEW_REQUEST', 'RESPONSE_WANTED', 'RESPONSE_DECLINED'],
  COMMENTS: ['NEW_COMMENT'],
  REVIEWS: ['REVIEW_POSTED', 'REVIEW_UPDATED'],
};

export const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  ORDERS: 'Orders',
  OFFERS: 'Offers and bargaining',
  CHAT: 'Messages',
  REQUESTS: 'Requests',
  COMMENTS: 'Comments',
  REVIEWS: 'Reviews',
};

export const CATEGORIES = Object.keys(CATEGORY_CODES) as NotificationCategory[];
export const isAlwaysOn = (c: NotificationCategory): boolean => ALWAYS_ON_CATEGORIES.includes(c);

const byCode = new Map<string, NotificationCategory>(CATEGORIES.flatMap((c) => CATEGORY_CODES[c].map((code) => [code, c] as const)));
/** An unknown code is treated as ORDERS (never mutable), so a new kind is never silently hidden before it is classified. */
export const categoryOf = (code: string): NotificationCategory => byCode.get(code) ?? 'ORDERS';
