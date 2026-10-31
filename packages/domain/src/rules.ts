import { DAY, HOUR } from './clock.js';

/** Provisional policy values (see docs/DECISIONS.md). Money is in paise. */
export const RULES = Object.freeze({
  OFFER_MIN_RATIO: 0.1,
  MAX_OFFERS_PER_NEGOTIATION: 6,
  MAX_NEW_NEGOTIATIONS_PER_LISTING_24H: 3,
  DEFAULT_EXPIRY_HOURS: 24,
  MIN_EXPIRY_HOURS: 6,
  MAX_EXPIRY_HOURS: 72,
  AUTO_DECLINE_DELAY_MS: 2 * 60_000,
  AUTO_COUNTER_DELAY_MS: 5_000,
  CHECKOUT_WINDOW_MS: 12 * HOUR,
  ORDER_CONFIRM_WINDOW_MS: 48 * HOUR,
  MIN_PRICE_PAISE: 50 * 100,
  MAX_PRICE_PAISE: 1_000_000 * 100,
  MAX_MEDIA_PER_LISTING: 6,
  REQUEST_OPEN_MS: 7 * DAY,
  MAX_MEDIA_PER_REVIEW: 4,
  MAX_MEDIA_PER_REQUEST: 4,
  MAX_MESSAGE_CHARS: 1000,
  LOW_RATING_MAX: 2,
  LOW_RATING_MIN_TEXT: 10,
  AGREEMENT_VERSION: 'draft-2026-10',
});

export const CONFIRM_HOURS_OPTIONS = [1, 2, 4, 6, 12, 24, 48] as const;
export const SHIP_DAYS_OPTIONS = [1, 2, 3, 5, 7] as const;

export const CATEGORIES = ['Ethnic wear', 'Western wear', 'Menswear', 'Accessories', 'Footwear'] as const;
export const BARGAIN_MODES = ['FIXED', 'PRIVATE', 'PUBLIC', 'BOTH'] as const;

export const CANCEL_REASONS = {
  PAYMENT_NOT_RECEIVED: 'Payment not received',
  WEBSITE_ORDER_NOT_FOUND: 'No matching order on the website',
  OUT_OF_STOCK: 'Out of stock',
  BUYER_REQUEST: 'Buyer asked to cancel',
  OTHER: 'Other',
} as const;
export type CancelReason = keyof typeof CANCEL_REASONS;

export const PAY_METHODS = { UPI: 'UPI', BANK: 'Bank transfer', LINK: 'Payment link' } as const;

export const CLOSE_TEXT: Record<string, string> = {
  DECLINED: 'Offer declined',
  AUTO_DECLINED: 'Offer declined',
  EXPIRED: 'Offer expired',
  WITHDRAWN: 'Offer withdrawn',
  SOLD_OUT: 'This size sold out',
  LISTING_PAUSED: 'Listing paused by the seller',
  PRICE_DROPPED: 'Price dropped below the offer — buy at the new price',
  FIXED_PRICE: 'Seller switched to fixed price',
  LAPSED: 'Checkout window passed',
  PURCHASED: 'Purchased',
};
