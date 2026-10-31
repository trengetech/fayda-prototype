import type { SellerOrder } from '@fayda/contracts/schemas';
import { CANCEL_REASONS, validateShipment } from '@fayda/domain';

export const TABS = ['Needs confirming', 'Confirmed', 'Shipped', 'Closed'] as const;
export type Tab = (typeof TABS)[number];

export function inTab(o: Pick<SellerOrder, 'status'>, t: Tab): boolean {
  if (t === 'Needs confirming') return o.status === 'PLACED';
  if (t === 'Confirmed') return o.status === 'CONFIRMED';
  if (t === 'Shipped') return o.status === 'SHIPPED';
  return o.status === 'DELIVERED' || o.status === 'CANCELLED' || o.status === 'EXPIRED';
}

export const tabCounts = (orders: readonly Pick<SellerOrder, 'status'>[]): Record<Tab, number> =>
  Object.fromEntries(TABS.map((t) => [t, orders.filter((o) => inTab(o, t)).length])) as Record<Tab, number>;

export function statusBadge(o: Pick<SellerOrder, 'status' | 'statusLabel'>): { label: string; tone: 'success' | 'danger' | 'info' | 'accent' } {
  const tone = o.status === 'PLACED' ? 'accent' : o.status === 'CONFIRMED' || o.status === 'SHIPPED' ? 'info' : o.status === 'DELIVERED' ? 'success' : 'danger';
  return { label: o.statusLabel, tone };
}

/** Direct orders wait for the payment; website orders wait for the seller to see the order on their site. */
export const confirmLabel = (o: Pick<SellerOrder, 'channel'>): string => (o.channel === 'WEBSITE' ? 'Order received' : 'Payment received');

/** Cancel reasons that make sense for this order: payment is only checked on direct orders, the website lookup only on website ones. */
export function cancelOptions(channel: 'DIRECT' | 'WEBSITE'): { key: keyof typeof CANCEL_REASONS; label: string }[] {
  return (Object.entries(CANCEL_REASONS) as [keyof typeof CANCEL_REASONS, string][])
    .filter(([k]) => (channel === 'WEBSITE' ? k !== 'PAYMENT_NOT_RECEIVED' : k !== 'WEBSITE_ORDER_NOT_FOUND'))
    .map(([key, label]) => ({ key, label }));
}

export const PAY_LABEL = { UPI: 'UPI', BANK: 'Bank transfer', LINK: 'Payment link' } as const;

export interface ShipForm {
  courier: string;
  trackingNo: string;
  trackingUrl: string;
  expectedDate: string;
  note: string;
}
export const emptyShip = (): ShipForm => ({ courier: '', trackingNo: '', trackingUrl: '', expectedDate: '', note: '' });

/** Checks the shipment with the domain's rule (the same one the server uses) and builds the request body. */
export function shipmentBody(f: ShipForm): { errors: Record<string, string> } | { body: { courier: string | null; trackingNo: string | null; trackingUrl: string | null; expectedDate: string | null; note: string | null } } {
  const v = validateShipment({ carrier: f.courier, trackingId: f.trackingNo, trackingUrl: f.trackingUrl, expectedDate: f.expectedDate, note: f.note });
  if ('fields' in v) return { errors: v.fields };
  const c = v.clean;
  return { body: { courier: c.carrier, trackingNo: c.trackingId, trackingUrl: c.trackingUrl, expectedDate: c.expectedDate, note: c.note } };
}

export const whatsappUrl = (phone: string, orderNumber: string): string => `https://wa.me/91${phone}?text=${encodeURIComponent(`Hi, this is about order ${orderNumber}.`)}`;
export const telUrl = (phone: string): string => `tel:+91${phone}`;

/** "2 h 10 min", "1 d 3 h". */
export function formatDuration(ms: number): string {
  const mins = Math.max(1, Math.round(ms / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} h`;
  return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`;
}
