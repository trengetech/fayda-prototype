import { DAY, HOUR } from './clock.js';

/** Provisional policy values (see docs/DECISIONS.md). Money is in paise. */
export const RULES = Object.freeze({
  OFFER_MIN_RATIO: 0.1,
  MAX_OFFERS_PER_NEGOTIATION: 6,
  MAX_NEW_NEGOTIATIONS_PER_LISTING_24H: 3,
  DEFAULT_EXPIRY_MINUTES: 1440,
  AUTO_DECLINE_DELAY_MS: 2 * 60_000,
  AUTO_COUNTER_DELAY_MS: 5_000,
  CHECKOUT_WINDOW_MS: 12 * HOUR,
  ORDER_CONFIRM_WINDOW_MS: 48 * HOUR,
  MIN_PRICE_PAISE: 50 * 100,
  MAX_PRICE_PAISE: 1_000_000 * 100,
  MAX_MEDIA_PER_LISTING: 6,
  /** Upload caps (I-13). The phone enforces the reel length; the server enforces size, as it cannot probe duration. */
  MAX_PHOTO_BYTES: 15_000_000,
  MAX_VIDEO_BYTES: 80_000_000,
  MAX_REEL_SECONDS: 60,
  REQUEST_OPEN_MS: 7 * DAY,
  MAX_MEDIA_PER_REVIEW: 4,
  MAX_MEDIA_PER_REQUEST: 4,
  MAX_MESSAGE_CHARS: 1000,
  LOW_RATING_MAX: 2,
  LOW_RATING_MIN_TEXT: 10,
  AGREEMENT_VERSION: 'draft-2026-10',
  CONDUCT_VERSION: 'draft-2026-10',
});

export const CONFIRM_HOURS_OPTIONS = [1, 2, 4, 6, 12, 24, 48] as const;
export const SHIP_DAYS_OPTIONS = [1, 2, 3, 5, 7] as const;

export const CATEGORIES = ['Ethnic wear', 'Western wear', 'Menswear', 'Accessories', 'Footwear'] as const;
export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const VIDEO_MIMES = ['video/mp4', 'video/quicktime', 'video/webm'] as const;
export const MEDIA_PURPOSES = ['LISTING', 'UPI_QR', 'REVIEW', 'REQUEST', 'CHAT'] as const;

export const BARGAIN_MODES = ['BUY_NOW', 'BOTH'] as const;
/** How long a bargaining offer stays open, chosen per listing by the seller: 30 min, 1 h, 3 h, 6 h, 24 h. */
export const OFFER_EXPIRY_MINUTES = [30, 60, 180, 360, 1440] as const;

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
