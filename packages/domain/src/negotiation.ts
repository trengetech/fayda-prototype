import { HOUR } from './clock.js';
import { formatRupees, isWholeRupees, type Paise } from './money.js';
import { RULES } from './rules.js';
import {
  fail,
  type Agreement,
  type Author,
  type BargainMode,
  type Channel,
  type CloseReason,
  type DealAccess,
  type DealCodes,
  type Negotiation,
  type Notice,
  type Offer,
  type OfferStatus,
  type PrivateRules,
  type Result,
  type Side,
} from './types.js';

// ---------- small helpers ----------
export const latest = (n: Negotiation): Offer => n.offers[n.offers.length - 1] as Offer;
export const sideOf = (by: Author): Side => (by === 'BUYER' ? 'BUYER' : 'SELLER');
export const lastBySide = (n: Negotiation, side: Side): Offer | null => {
  for (let i = n.offers.length - 1; i >= 0; i--) {
    const o = n.offers[i] as Offer;
    if (sideOf(o.by) === side) return o;
  }
  return null;
};

export interface Reservation {
  variantId: string;
  status: 'ACTIVE' | 'CONSUMED' | 'RELEASED';
  expiresAt: number;
}
/** Units of a variant still available to buy: stock minus reservations that are active and unexpired. */
export function availableUnits(stock: number, reservations: readonly Reservation[], variantId: string, now: number): number {
  const held = reservations.filter((r) => r.variantId === variantId && r.status === 'ACTIVE' && r.expiresAt > now).length;
  return Math.max(0, stock - held);
}

export function platformFloor(listPrice: Paise): Paise {
  return Math.ceil((listPrice * RULES.OFFER_MIN_RATIO) / 100) * 100;
}

// ---------- starting an offer (R1–R3, R6) ----------
export interface NewOfferCheck {
  listingActive: boolean;
  isOwnListing: boolean;
  mode: BargainMode;
  variantExists: boolean;
  availableUnits: number;
  listPrice: Paise;
  amount: Paise;
  /** This buyer already has an OPEN or AGREED negotiation for this variant. */
  hasOpenForVariant: boolean;
  /** Negotiations this buyer started on this listing in the last 24 h. */
  startedLast24h: number;
}
export function validateNewOffer(c: NewOfferCheck): Result {
  if (!c.listingActive) return fail('NOT_AVAILABLE', 'This listing isn’t available.');
  if (c.isOwnListing) return fail('OWN_LISTING', 'You can’t make an offer on your own listing.');
  if (c.mode === 'FIXED') return fail('FIXED_PRICE', 'This listing is fixed price.');
  if (!c.variantExists) return fail('NO_VARIANT', 'Choose a size.');
  if (c.availableUnits < 1) return fail('OUT_OF_STOCK', 'This size is out of stock.');
  if (!isWholeRupees(c.amount) || c.amount <= 0) return fail('INVALID_AMOUNT', 'Enter an amount in whole rupees.');
  if (c.amount >= c.listPrice) return fail('AT_OR_ABOVE_LIST', 'That’s at or above the listed price — use Buy now instead.');
  const floor = platformFloor(c.listPrice);
  if (c.amount < floor)
    return fail('BELOW_PLATFORM_FLOOR', `Offers must be at least ${formatRupees(floor)} (10% of the listed price).`);
  if (c.hasOpenForVariant) return fail('ALREADY_OPEN', 'You already have an open offer for this size.');
  if (c.startedLast24h >= RULES.MAX_NEW_NEGOTIATIONS_PER_LISTING_24H)
    return fail('DAILY_LIMIT', 'You’ve reached today’s offer limit for this listing. Try again tomorrow.');
  return { ok: true };
}

export function startNegotiation(
  init: { id: string; listingId: string; variantId: string; buyerId: string; visibility: 'PUBLIC' | 'PRIVATE' },
  now: number,
): Negotiation {
  return {
    ...init,
    status: 'OPEN',
    closeReason: null,
    offers: [],
    events: [],
    agreement: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Visibility a new negotiation gets: BOTH lets the buyer choose, otherwise the listing's mode decides. */
export function visibilityFor(mode: BargainMode, requested: 'PUBLIC' | 'PRIVATE' | undefined): 'PUBLIC' | 'PRIVATE' {
  if (mode === 'BOTH') return requested === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE';
  return mode === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE';
}

// ---------- offers and counters (R4–R6) ----------
export function appendOffer(
  n: Negotiation,
  offer: { id: string; by: Author; amount: Paise; dealAccess?: DealAccess | null },
  now: number,
  expiryHours: number,
): Negotiation {
  const prev = n.offers.length ? latest(n) : null;
  const offers: Offer[] = n.offers.map((o) =>
    o === prev && o.status === 'PENDING' ? { ...o, status: 'COUNTERED' as OfferStatus, resolvedAt: now } : o,
  );
  offers.push({
    id: offer.id,
    by: offer.by,
    amount: offer.amount,
    status: 'PENDING',
    at: now,
    expiresAt: now + expiryHours * HOUR,
    ...(offer.dealAccess ? { dealAccess: offer.dealAccess } : {}),
  });
  return {
    ...n,
    offers,
    updatedAt: now,
    events: [...n.events, { type: prev ? 'COUNTERED' : 'OFFERED', actor: offer.by, at: now, amount: offer.amount }],
  };
}

export function validateCounter(
  n: Negotiation,
  side: Side,
  amount: Paise,
  listPrice: Paise,
  opts: { allowHold?: boolean } = {},
): Result {
  const last = n.offers.length ? latest(n) : null;
  if (n.status !== 'OPEN' || !last || last.status !== 'PENDING')
    return fail('NOT_OPEN', 'This negotiation is no longer open.');
  if (sideOf(last.by) === side) return fail('NOT_YOUR_TURN', 'Wait for the other side to respond.');
  if (n.offers.length >= RULES.MAX_OFFERS_PER_NEGOTIATION)
    return fail('TURN_LIMIT', 'This negotiation has reached its limit. Accept or decline the last offer.');
  if (!isWholeRupees(amount) || amount <= 0) return fail('INVALID_AMOUNT', 'Enter an amount in whole rupees.');
  if (amount >= listPrice) return fail('AT_OR_ABOVE_LIST', 'Counters must be below the listed price.');
  const mine = lastBySide(n, side);
  if (side === 'BUYER') {
    if (mine && amount <= mine.amount)
      return fail('MUST_INCREASE', `Your counter must be higher than your last offer (${formatRupees(mine.amount)}).`);
    if (amount >= last.amount)
      return fail('ACCEPT_INSTEAD', `That’s at or above the seller’s ${formatRupees(last.amount)} — accept it instead.`);
  } else {
    if (mine && (opts.allowHold ? amount > mine.amount : amount >= mine.amount))
      return fail('MUST_DECREASE', `Your counter must be lower than your last counter (${formatRupees(mine.amount)}).`);
    if (amount <= last.amount)
      return fail('ACCEPT_INSTEAD', `That’s at or below the buyer’s ${formatRupees(last.amount)} — accept it instead.`);
  }
  return { ok: true };
}

function pushEvent(n: Negotiation, e: Negotiation['events'][number]): Negotiation {
  return { ...n, events: [...n.events, e] };
}

// ---------- closing ----------
export function closeNegotiation(
  n: Negotiation,
  offerStatus: OfferStatus,
  reason: CloseReason,
  now: number,
  actor: Author = 'SYSTEM',
): Negotiation {
  const last = n.offers.length ? latest(n) : null;
  const offers = n.offers.map((o) => (o === last && o.status === 'PENDING' ? { ...o, status: offerStatus, resolvedAt: now } : o));
  return pushEvent(
    { ...n, offers, status: 'CLOSED', closeReason: reason, updatedAt: now },
    { type: 'CLOSED', actor, at: now, reason },
  );
}

export function declineLatest(n: Negotiation, side: Side, now: number): Result<{ negotiation: Negotiation; notice: Notice }> {
  const last = latest(n);
  if (n.status !== 'OPEN' || last.status !== 'PENDING') return fail('NOT_OPEN', 'This negotiation is no longer open.');
  if (sideOf(last.by) === side) return fail('NOT_YOUR_TURN', 'Wait for the other side to respond.');
  return {
    ok: true,
    negotiation: closeNegotiation(n, 'DECLINED', 'DECLINED', now, side),
    notice: { audience: side === 'SELLER' ? 'buyer' : 'seller', code: side === 'SELLER' ? 'SELLER_DECLINED' : 'BUYER_DECLINED', at: now, params: { amount: last.amount } },
  };
}

export function withdraw(n: Negotiation, now: number): Result<{ negotiation: Negotiation; notice: Notice }> {
  const last = latest(n);
  if (n.status !== 'OPEN' || last.status !== 'PENDING' || last.by !== 'BUYER')
    return fail('CANT_WITHDRAW', 'You can withdraw only your own pending offer.');
  return {
    ok: true,
    negotiation: closeNegotiation(n, 'WITHDRAWN', 'WITHDRAWN', now, 'BUYER'),
    notice: { audience: 'seller', code: 'BUYER_WITHDREW', at: now, params: { amount: last.amount } },
  };
}

// ---------- accepting (R9, R10) ----------
export interface AcceptContext {
  channel: Channel;
  availableUnits: number;
  /** Website listings: the code or link that gives the agreed price. */
  dealAccess?: DealAccess | null;
  /** Overrides the agreed price (website auto-accept settles at the code's price). */
  price?: Paise;
}
export interface Accepted {
  negotiation: Negotiation;
  /** The API must reserve one unit of the variant until this time. */
  reserveUntil: number;
  notices: Notice[];
}
export function acceptLatest(n: Negotiation, actor: Author, now: number, ctx: AcceptContext): Result<Accepted> {
  const last = n.offers.length ? latest(n) : null;
  if (!last || last.status !== 'PENDING') return fail('NOTHING_TO_ACCEPT', 'There is no open offer to accept.');
  let dealAccess: DealAccess | null = null;
  if (ctx.channel === 'WEBSITE') {
    dealAccess = ctx.dealAccess ?? (sideOf(last.by) === 'SELLER' ? (last.dealAccess ?? null) : null);
    if (!dealAccess)
      return fail('DEAL_ACCESS_REQUIRED', 'Add the coupon code or discount link that gives this price on your website.');
  }
  if (ctx.availableUnits < 1) return fail('OUT_OF_STOCK', 'This size is out of stock, so the offer can’t be accepted.');
  const price = ctx.price ?? last.amount;
  const reserveUntil = now + RULES.CHECKOUT_WINDOW_MS;
  const agreement: Agreement = { price, deadline: reserveUntil, acceptedBy: actor, at: now, dealAccess };
  const offers = n.offers.map((o) => (o === last ? { ...o, status: 'ACCEPTED' as OfferStatus, resolvedAt: now } : o));
  const negotiation = pushEvent(
    { ...n, offers, status: 'AGREED', agreement, updatedAt: now },
    { type: 'ACCEPTED', actor, at: now, amount: price },
  );
  // Buyers get the same notice whether the seller or a rule accepted: they must not be able to tell.
  const buyerCode = sideOf(actor) === 'SELLER' ? 'OFFER_ACCEPTED' : 'YOU_ACCEPTED';
  const sellerCode = actor === 'SYSTEM' ? 'AUTO_ACCEPTED' : actor === 'BUYER' ? 'BUYER_ACCEPTED' : 'YOU_ACCEPTED';
  return {
    ok: true,
    negotiation,
    reserveUntil,
    notices: [
      { audience: 'buyer', code: buyerCode, at: now, params: { amount: price } },
      { audience: 'seller', code: sellerCode, at: now, params: { amount: price } },
    ],
  };
}

// ---------- automation: seller-controlled private rules (R8) ----------
export type AutomationDecision =
  | { kind: 'ACCEPT'; price: Paise; dealAccess: DealAccess | null }
  | { kind: 'DECLINE_AT'; at: number }
  | { kind: 'COUNTER_AT'; at: number; amount: Paise }
  | { kind: 'NOTIFY_SELLER' };

export interface AutomationContext {
  channel: Channel;
  listPrice: Paise;
  now: number;
  codes: DealCodes;
  /** Set when an automatic accept was tried and failed (for example, no stock): fall through to decline/counter. */
  skipAccept?: boolean;
}

/** Decides what the seller's private rules do with the buyer's pending offer. Pure; never read by buyer-facing code. */
export function decideAutomation(n: Negotiation, rules: PrivateRules, ctx: AutomationContext): AutomationDecision | null {
  const last = latest(n);
  if (n.status !== 'OPEN' || last.by !== 'BUYER' || last.status !== 'PENDING') return null;
  const website = ctx.channel === 'WEBSITE';
  if (!ctx.skipAccept && rules.autoAcceptAt != null && last.amount >= rules.autoAcceptAt && (!website || ctx.codes.accept)) {
    // Website listings agree at the price the seller's pre-set code gives.
    return website
      ? { kind: 'ACCEPT', price: rules.autoAcceptAt, dealAccess: ctx.codes.accept ?? null }
      : { kind: 'ACCEPT', price: last.amount, dealAccess: null };
  }
  if (rules.autoDeclineBelow != null && last.amount < rules.autoDeclineBelow)
    return { kind: 'DECLINE_AT', at: ctx.now + RULES.AUTO_DECLINE_DELAY_MS };
  if (rules.autoCounterAt != null && (!website || ctx.codes.counter)) {
    // The seller never goes up; if they already countered lower by hand, that lower amount repeats.
    const prev = lastBySide(n, 'SELLER');
    const amount = prev ? Math.min(rules.autoCounterAt, prev.amount) : rules.autoCounterAt;
    if (amount > last.amount && validateCounter(n, 'SELLER', amount, ctx.listPrice, { allowHold: true }).ok)
      return { kind: 'COUNTER_AT', at: ctx.now + RULES.AUTO_COUNTER_DELAY_MS, amount };
  }
  return { kind: 'NOTIFY_SELLER' };
}

/** Records a delayed decision (decline or counter) on the pending offer. Other decisions need no marking. */
export function scheduleAutomation(n: Negotiation, d: AutomationDecision): Negotiation {
  const last = latest(n);
  const patch: Partial<Offer> | null =
    d.kind === 'DECLINE_AT'
      ? { autoDeclineAt: d.at }
      : d.kind === 'COUNTER_AT'
        ? { autoCounterDueAt: d.at, autoCounterAmount: d.amount }
        : null;
  if (!patch) return n;
  return { ...n, offers: n.offers.map((o) => (o === last ? { ...o, ...patch } : o)) };
}

// ---------- sweep: delayed automation, expiry, lapsed agreements ----------
export interface SweepContext {
  listPrice: Paise;
  expiryHours: number;
  channel: Channel;
  rules: PrivateRules;
  codes: DealCodes;
  /** Id for an automatic counter offer, if one is created. */
  newOfferId: () => string;
}
export interface SweepOutcome {
  negotiation: Negotiation;
  notices: Notice[];
  changed: boolean;
  /** An AGREED negotiation lapsed: the API must release its reservation. */
  releaseReservation: boolean;
}

export function sweepNegotiation(n: Negotiation, now: number, ctx: SweepContext): SweepOutcome {
  const same: SweepOutcome = { negotiation: n, notices: [], changed: false, releaseReservation: false };
  if (n.status === 'OPEN') {
    const last = latest(n);
    if (last.status !== 'PENDING') return same;
    if (last.autoCounterDueAt && now >= last.autoCounterDueAt) {
      const due = last.autoCounterDueAt;
      const amount = last.autoCounterAmount as Paise;
      const cleared = { ...n, offers: n.offers.map((o) => (o === last ? { ...o, autoCounterDueAt: null, autoCounterAmount: null } : o)) };
      if (validateCounter(cleared, 'SELLER', amount, ctx.listPrice, { allowHold: true }).ok) {
        const prev = lastBySide(cleared, 'SELLER');
        const dealAccess =
          ctx.channel === 'WEBSITE'
            ? amount === ctx.rules.autoCounterAt
              ? (ctx.codes.counter ?? null)
              : (prev?.dealAccess ?? ctx.codes.counter ?? null)
            : null;
        // The counter is stamped with the time it was due, so a late sweep does not shift its expiry.
        const next = appendOffer(cleared, { id: ctx.newOfferId(), by: 'SYSTEM', amount, dealAccess }, due, ctx.expiryHours);
        return {
          negotiation: next,
          changed: true,
          releaseReservation: false,
          notices: [
            { audience: 'buyer', code: 'SELLER_COUNTERED', at: due, params: { amount } },
            { audience: 'seller', code: 'AUTO_COUNTERED', at: due, params: { amount, offer: last.amount } },
          ],
        };
      }
      return {
        negotiation: cleared,
        changed: true,
        releaseReservation: false,
        notices: [{ audience: 'seller', code: 'NEW_OFFER', at: due, params: { amount: last.amount } }],
      };
    }
    if (last.autoDeclineAt && now >= last.autoDeclineAt) {
      return {
        negotiation: closeNegotiation(n, 'DECLINED', 'AUTO_DECLINED', now, 'SYSTEM'),
        changed: true,
        releaseReservation: false,
        notices: [
          { audience: 'buyer', code: 'SELLER_DECLINED', at: now, params: { amount: last.amount } },
          { audience: 'seller', code: 'AUTO_DECLINED', at: now, params: { amount: last.amount } },
        ],
      };
    }
    if (now >= last.expiresAt) {
      return {
        negotiation: closeNegotiation(n, 'EXPIRED', 'EXPIRED', now),
        changed: true,
        releaseReservation: false,
        notices: [
          { audience: 'buyer', code: 'OFFER_EXPIRED', at: now, params: { amount: last.amount } },
          { audience: 'seller', code: 'OFFER_EXPIRED', at: now, params: { amount: last.amount } },
        ],
      };
    }
    return same;
  }
  if (n.status === 'AGREED' && n.agreement && now >= n.agreement.deadline) {
    const lapsed = pushEvent({ ...n, status: 'LAPSED', closeReason: 'LAPSED', updatedAt: now }, { type: 'LAPSED', actor: 'SYSTEM', at: now });
    return {
      negotiation: lapsed,
      changed: true,
      releaseReservation: true,
      notices: [
        { audience: 'buyer', code: 'AGREEMENT_LAPSED', at: now },
        { audience: 'seller', code: 'AGREEMENT_LAPSED', at: now },
      ],
    };
  }
  return same;
}

// ---------- invalidation when the listing changes (R11–R14) ----------
export interface ListingChange {
  oldPrice: Paise | null;
  newPrice: Paise;
  oldMode: BargainMode | null;
  newMode: BargainMode;
  removedVariantIds: string[];
  paused?: boolean;
}
export interface OpenNegotiationRef {
  id: string;
  variantId: string;
  latestAmount: Paise;
}
/** Which open negotiations must close because the seller changed the listing, and why. */
export function invalidationsForListingChange(
  c: ListingChange,
  open: readonly OpenNegotiationRef[],
): { id: string; reason: CloseReason }[] {
  const out = new Map<string, CloseReason>();
  const add = (id: string, reason: CloseReason) => {
    if (!out.has(id)) out.set(id, reason);
  };
  if (c.paused) open.forEach((o) => add(o.id, 'LISTING_PAUSED'));
  open.forEach((o) => c.removedVariantIds.includes(o.variantId) && add(o.id, 'SOLD_OUT'));
  if (c.oldMode && c.oldMode !== 'FIXED' && c.newMode === 'FIXED') open.forEach((o) => add(o.id, 'FIXED_PRICE'));
  if (c.oldPrice && c.newPrice < c.oldPrice) open.forEach((o) => o.latestAmount >= c.newPrice && add(o.id, 'PRICE_DROPPED'));
  return [...out].map(([id, reason]) => ({ id, reason }));
}

/** Closes a negotiation because of a listing change or sold-out variant. */
export function invalidate(n: Negotiation, reason: CloseReason, now: number): { negotiation: Negotiation; notices: Notice[] } {
  return {
    negotiation: closeNegotiation(n, 'INVALIDATED', reason, now),
    notices: [
      { audience: 'buyer', code: 'NEGOTIATION_CLOSED', at: now, params: { reason } },
      { audience: 'seller', code: 'NEGOTIATION_CLOSED', at: now, params: { reason } },
    ],
  };
}

