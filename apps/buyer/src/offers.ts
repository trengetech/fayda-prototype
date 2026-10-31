import type { BuyerNegotiation } from '@fayda/contracts/schemas';
import { formatRupees } from '@fayda/domain';

type Offer = BuyerNegotiation['offers'][number];

export const offerLine = (o: Offer): string => `${o.side === 'ME' ? 'You offered' : 'Seller countered'} ${formatRupees(o.amount)}`;

/** A new key for each fresh attempt; reuse it when retrying the same one, so a lost reply cannot make a second offer. */
export const newAttemptKey = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export function statusBadge(n: BuyerNegotiation): { label: string; tone: 'success' | 'danger' | 'info' | 'accent' } {
  if (n.canRespond) return { label: 'Seller replied', tone: 'accent' };
  if (n.status === 'OPEN') return { label: 'Waiting for seller', tone: 'info' };
  if (n.status === 'AGREED') return { label: 'Agreed', tone: 'success' };
  if (n.status === 'PURCHASED') return { label: 'Purchased', tone: 'success' };
  return { label: n.closeText ?? n.statusLabel, tone: 'danger' };
}
