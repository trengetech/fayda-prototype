import type { BuyerOrder } from '@fayda/contracts/schemas';
import { Linking, Share } from 'react-native';

/** The order's status as a line of steps. A closed order (cancelled or expired) ends the line early. */
export const STEPS = ['PLACED', 'CONFIRMED', 'SHIPPED', 'DELIVERED'] as const;

export function stepLabel(step: (typeof STEPS)[number], channel: BuyerOrder['channel']): string {
  if (step === 'PLACED') return channel === 'WEBSITE' ? 'Deal recorded' : 'Order placed, waiting for the seller to confirm payment';
  if (step === 'CONFIRMED') return channel === 'WEBSITE' ? 'Seller received your website order' : 'Seller confirmed your payment';
  if (step === 'SHIPPED') return 'Shipped';
  return 'Delivered';
}

/** Which of the four steps are done. A closed order shows only the steps it reached. */
export function reached(o: Pick<BuyerOrder, 'status' | 'confirmedAt' | 'shipment'>): number {
  if (o.status === 'DELIVERED') return 4;
  if (o.status === 'SHIPPED') return 3;
  if (o.status === 'CONFIRMED') return 2;
  if (o.status === 'PLACED') return 1;
  // CANCELLED or EXPIRED: it may have been confirmed (and cancelled later) or never confirmed.
  return o.confirmedAt != null ? 2 : 1;
}
export const isClosed = (o: Pick<BuyerOrder, 'status'>): boolean => o.status === 'CANCELLED' || o.status === 'EXPIRED';
export const isOpen = (o: Pick<BuyerOrder, 'status'>): boolean => o.status === 'PLACED' || o.status === 'CONFIRMED' || o.status === 'SHIPPED';

export const FILTERS = ['All', 'Open', 'Delivered', 'Closed'] as const;
export type Filter = (typeof FILTERS)[number];
export const matchesFilter = (o: Pick<BuyerOrder, 'status'>, f: Filter): boolean =>
  f === 'All' || (f === 'Open' && isOpen(o)) || (f === 'Delivered' && o.status === 'DELIVERED') || (f === 'Closed' && isClosed(o));

export const statusTone = (s: BuyerOrder['status']): 'success' | 'danger' | 'info' | 'accent' =>
  s === 'DELIVERED' ? 'success' : s === 'CANCELLED' || s === 'EXPIRED' ? 'danger' : s === 'PLACED' ? 'accent' : 'info';

export const PAY_LABELS = { UPI: 'UPI', BANK: 'Bank transfer', LINK: 'Payment link' } as const;

/** "Confirms within 2 h" for the declared time, "usually 3 h" for the actual median. */
export const hoursText = (h: number): string => (h === 1 ? '1 hour' : `${h} hours`);
export const daysText = (d: number): string => (d === 1 ? '1 day' : `${d} days`);
export function medianText(ms: number | null): string | null {
  if (ms == null) return null;
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${Math.max(min, 1)} min`;
  const h = Math.round((min / 60) * 10) / 10;
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

export const waUrl = (n: string, orderNumber: string): string => `https://wa.me/91${n}?text=${encodeURIComponent(`Hi, about my Fayda order ${orderNumber}`)}`;
export const telUrl = (n: string): string => `tel:+91${n}`;

/**
 * Opens a link in another app. Returns false when nothing could handle it (for example no UPI app), so the screen can say so
 * and show something the person can still use, instead of failing quietly.
 */
export async function openExternal(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * The phone has no clipboard module yet (a new library needs approval), so "Copy" opens the system share sheet, which has
 * a Copy action on Android. The text on screen is also selectable with a long press.
 */
export async function shareText(text: string): Promise<void> {
  try {
    await Share.share({ message: text });
  } catch {
    // the person closed the sheet, or sharing is unavailable: nothing to do
  }
}

/** A new key per fresh attempt; reuse it when retrying the same one so a lost reply cannot make a second order or message. */
export const newKey = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
