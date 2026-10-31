import type { Paise } from './money.js';

export type Side = 'BUYER' | 'SELLER';
/** Who authored an offer. SYSTEM is the seller's automatic rule; buyers must never be able to tell. */
export type Author = 'BUYER' | 'SELLER' | 'SYSTEM';

/** BUY_NOW: fixed price, no offers. BOTH: a Buy button at list price plus private offers (D-bargain, 31 Oct 2026). */
export type BargainMode = 'BUY_NOW' | 'BOTH';
export type Channel = 'DIRECT' | 'WEBSITE';
export type PayMethod = 'UPI' | 'BANK' | 'LINK';

export interface DealAccess {
  type: 'CODE' | 'LINK';
  value: string;
}

export interface PrivateRules {
  autoAcceptAt: Paise | null;
  autoDeclineBelow: Paise | null;
  autoCounterAt: Paise | null;
}

export interface DealCodes {
  accept?: DealAccess | null;
  counter?: DealAccess | null;
}

export type OfferStatus =
  | 'PENDING'
  | 'COUNTERED'
  | 'ACCEPTED'
  | 'DECLINED'
  | 'EXPIRED'
  | 'WITHDRAWN'
  | 'INVALIDATED';

export interface Offer {
  id: string;
  by: Author;
  amount: Paise;
  status: OfferStatus;
  at: number;
  expiresAt: number;
  resolvedAt?: number;
  dealAccess?: DealAccess | null;
  /** Private: when a delayed automatic decline is due. Never sent to buyers. */
  autoDeclineAt?: number | null;
  /** Private: when a delayed automatic counter is due, and its amount. Never sent to buyers. */
  autoCounterDueAt?: number | null;
  autoCounterAmount?: Paise | null;
}

export type NegotiationStatus = 'OPEN' | 'AGREED' | 'PURCHASED' | 'LAPSED' | 'CLOSED';

export type CloseReason =
  | 'DECLINED'
  | 'AUTO_DECLINED'
  | 'EXPIRED'
  | 'WITHDRAWN'
  | 'SOLD_OUT'
  | 'LISTING_PAUSED'
  | 'PRICE_DROPPED'
  | 'FIXED_PRICE'
  | 'LAPSED'
  | 'PURCHASED';

export interface Agreement {
  price: Paise;
  deadline: number;
  acceptedBy: Author;
  at: number;
  dealAccess: DealAccess | null;
}

export interface NegotiationEvent {
  type: 'OFFERED' | 'COUNTERED' | 'ACCEPTED' | 'CLOSED' | 'LAPSED' | 'PURCHASED';
  actor: Author;
  at: number;
  amount?: Paise;
  reason?: CloseReason;
}

export interface Negotiation {
  id: string;
  listingId: string;
  variantId: string;
  buyerId: string;
  status: NegotiationStatus;
  closeReason: CloseReason | null;
  offers: Offer[];
  events: NegotiationEvent[];
  agreement: Agreement | null;
  createdAt: number;
  updatedAt: number;
}

export type ErrorCode = string;

export interface Fail {
  ok: false;
  code: ErrorCode;
  message: string;
  fields?: Record<string, string>;
}
export type Ok<T = object> = { ok: true } & T;
export type Result<T = object> = Ok<T> | Fail;

export const fail = (code: ErrorCode, message: string, fields?: Record<string, string>): Fail =>
  fields ? { ok: false, code, message, fields } : { ok: false, code, message };

/** A notification the API should create. Domain decides who and why; the API renders the text. */
export interface Notice {
  audience: 'buyer' | 'seller';
  code: string;
  at: number;
  params?: Record<string, string | number>;
}
