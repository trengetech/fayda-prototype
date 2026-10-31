import type { SellerNegotiation } from '@fayda/contracts/schemas';
import { CLOSE_TEXT, formatRupees } from '@fayda/domain';

type Offer = SellerNegotiation['offers'][number];

/** One line of the timeline. The seller sees which replies their own rules sent. */
export function offerLine(o: Offer, buyerName: string): string {
  const amount = formatRupees(o.amount);
  if (o.by === 'BUYER') return `${buyerName} offered ${amount}`;
  return o.by === 'SYSTEM' ? `Your rule countered ${amount}` : `You countered ${amount}`;
}

export const OFFER_STATUS_LABEL: Record<string, string> = {
  PENDING: 'Waiting',
  COUNTERED: 'Countered',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  WITHDRAWN: 'Withdrawn',
  INVALIDATED: 'Closed',
};

/** The short status shown on an inbox row. */
export function statusText(n: SellerNegotiation): { label: string; tone: 'success' | 'danger' | 'info' | 'accent' } {
  if (n.needsReply) return { label: 'Needs your reply', tone: 'accent' };
  if (n.status === 'OPEN') return { label: 'Waiting for buyer', tone: 'info' };
  if (n.status === 'AGREED') return { label: 'Agreed', tone: 'success' };
  if (n.status === 'PURCHASED') return { label: 'Purchased', tone: 'success' };
  return { label: CLOSE_TEXT[n.closeReason ?? ''] ?? 'Closed', tone: 'danger' };
}

export const latestOffer = (n: SellerNegotiation): Offer | undefined => n.offers[n.offers.length - 1];

export const FILTERS = ['Needs reply', 'Waiting', 'Agreed', 'Closed'] as const;
export type Filter = (typeof FILTERS)[number];
export function inFilter(n: SellerNegotiation, f: Filter): boolean {
  if (f === 'Needs reply') return n.needsReply;
  if (f === 'Waiting') return n.status === 'OPEN' && !n.needsReply;
  if (f === 'Agreed') return n.status === 'AGREED' || n.status === 'PURCHASED';
  return n.status === 'CLOSED' || n.status === 'LAPSED';
}
