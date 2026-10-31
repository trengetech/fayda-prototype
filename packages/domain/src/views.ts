import { latest, lastBySide, sideOf } from './negotiation.js';
import type { Paise } from './money.js';
import { CLOSE_TEXT, RULES } from './rules.js';
import type { Channel, DealAccess, Negotiation } from './types.js';

/**
 * Buyer-facing negotiation view. Built field by field from an allow-list: private rules, pending automation,
 * and whether any reply (counter, accept or decline) was automatic are never copied (decision B-7).
 * Contract tests assert this.
 */
export interface BuyerNegotiationView {
  id: string;
  status: Negotiation['status'];
  statusLabel: string;
  closeReason: string | null;
  closeText: string | null;
  variantId: string;
  offers: { id: string; side: 'ME' | 'SELLER'; amount: Paise; status: string; at: number; expiresAt: number }[];
  events: { type: string; at: number; actor: 'ME' | 'SELLER'; reason: string | null }[];
  pendingExpiresAt: number | null;
  agreement: { price: Paise; deadline: number; dealAccess: DealAccess | null } | null;
  channel: Channel;
  canRespond: boolean;
  canCounter: boolean;
  canWithdraw: boolean;
  counterBounds: { minExclusive: Paise; maxExclusive: Paise } | null;
  offersLeft: number;
  updatedAt: number;
}

export function statusLabel(n: Negotiation): string {
  if (n.status === 'OPEN') return sideOf(latest(n).by) === 'BUYER' ? 'Waiting for seller' : 'Seller countered';
  const labels: Record<string, string> = {
    AGREED: 'Agreed',
    PURCHASED: 'Purchased',
    LAPSED: 'Lapsed',
    CLOSED: CLOSE_TEXT[n.closeReason ?? ''] ?? 'Closed',
  };
  return labels[n.status] ?? 'Closed';
}

export function buyerNegotiationView(n: Negotiation, channel: Channel): BuyerNegotiationView {
  const last = latest(n);
  const myTurn = n.status === 'OPEN' && last.status === 'PENDING' && sideOf(last.by) === 'SELLER';
  const myLast = lastBySide(n, 'BUYER');
  // A rule acting for the seller is shown as the seller.
  const actorLabel = (a: string): 'ME' | 'SELLER' => (a === 'BUYER' ? 'ME' : 'SELLER');
  // The buyer sees only that an offer was declined, never that a rule declined it.
  const publicReason = (r: string | null): string | null => (r === 'AUTO_DECLINED' ? 'DECLINED' : r);
  return {
    id: n.id,
    status: n.status,
    statusLabel: statusLabel(n),
    closeReason: publicReason(n.closeReason),
    closeText: n.closeReason ? (CLOSE_TEXT[n.closeReason] ?? null) : null,
    variantId: n.variantId,
    offers: n.offers.map((o) => ({
      id: o.id,
      side: sideOf(o.by) === 'BUYER' ? 'ME' : 'SELLER',
      amount: o.amount,
      status: o.status,
      at: o.at,
      expiresAt: o.expiresAt,
    })),
    events: n.events
      .filter((e) => ['CLOSED', 'LAPSED', 'PURCHASED', 'ACCEPTED'].includes(e.type))
      .map((e) => ({ type: e.type, at: e.at, actor: actorLabel(e.actor), reason: publicReason(e.reason ?? null) })),
    pendingExpiresAt: n.status === 'OPEN' ? last.expiresAt : null,
    agreement: n.agreement
      ? {
          price: n.agreement.price,
          deadline: n.agreement.deadline,
          dealAccess: n.agreement.dealAccess,
        }
      : null,
    channel,
    canRespond: myTurn,
    canCounter: myTurn && n.offers.length < RULES.MAX_OFFERS_PER_NEGOTIATION,
    canWithdraw: n.status === 'OPEN' && last.status === 'PENDING' && last.by === 'BUYER',
    counterBounds: myTurn ? { minExclusive: myLast ? myLast.amount : 0, maxExclusive: last.amount } : null,
    offersLeft: RULES.MAX_OFFERS_PER_NEGOTIATION - n.offers.length,
    updatedAt: n.updatedAt,
  };
}

/** Public listing fields only. Private rules and deal codes are not part of this type, so they cannot leak. */
export interface PublicListing {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  category: string;
  price: Paise;
  status: string;
  mode: string;
  expiryMinutes: number;
  channel: Channel;
  productUrl: string | null;
  variants: { id: string; label: string; stock: number }[];
}
export interface BuyerListingView {
  id: string;
  title: string;
  description: string;
  category: string;
  price: Paise;
  soldOut: boolean;
  variants: { id: string; label: string; available: boolean; low: boolean }[];
  bargaining: { mode: string; acceptsOffers: boolean; expiryMinutes: number };
  checkout: { channel: Channel; productUrl: string | null };
}
export function buyerListingView(l: PublicListing, availableByVariant: Record<string, number>): BuyerListingView {
  const variants = l.variants.map((v) => {
    const a = availableByVariant[v.id] ?? 0;
    return { id: v.id, label: v.label, available: a > 0, low: a > 0 && a <= 2 };
  });
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    category: l.category,
    price: l.price,
    soldOut: !variants.some((v) => v.available),
    variants,
    bargaining: { mode: l.mode, acceptsOffers: l.mode !== 'BUY_NOW', expiryMinutes: l.expiryMinutes },
    checkout: { channel: l.channel, productUrl: l.channel === 'WEBSITE' ? l.productUrl : null },
  };
}
