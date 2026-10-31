/**
 * Ported from prototype/test/engine.test.js (25 of the 26 tests; the 26th checked the prototype's seed data,
 * which does not exist in the backend). Same scenarios, same expectations, now against the pure domain rules
 * with a fake clock. Money is paise in expectations; command amounts are whole rupees.
 */
import { describe, expect, it } from 'vitest';
import {
  HOUR,
  RULES,
  isValidIndianMobile,
  normalizePhone,
  validateListingDraft,
  validatePayment,
} from '../src/index.js';
import { DAY, NOW, World, type Cmd, type Draft } from './harness.js';

interface Setup {
  stock?: number;
  mode?: string;
  checkout?: { channel?: string; productUrl?: string };
  dealCodes?: Draft['dealCodes'];
}
function setup(rules: NonNullable<Draft['rules']> = {}, opts: Setup = {}) {
  const w = new World();
  w.addSeller('seller', { upiId: 'shop@okicici', bankHolder: 'Shop', bankAccount: '123456789012', bankIfsc: 'ICIC0001234' });
  w.addBuyer('b1');
  w.addBuyer('b2');
  const run = (cmd: Cmd, at = NOW) => w.exec(cmd, at);
  const draft = (over: Partial<Draft> = {}): Draft => ({
    title: 'Kurta',
    description: '',
    category: 'Ethnic wear',
    price: 2500,
    media: [{ kind: 'photo' }],
    variants: [{ label: 'M', stock: opts.stock ?? 1 }],
    bargaining: { mode: opts.mode ?? 'BOTH', expiryMinutes: 1440 },
    rules,
    checkout: opts.checkout,
    dealCodes: opts.dealCodes,
    ...over,
  });
  const r = run({ type: 'listing.save', userId: 'seller', publish: true, draft: draft() });
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const listingId = r.listingId as string;
  return {
    w,
    run,
    draft,
    listingId,
    seller: 'seller',
    b1: 'b1',
    b2: 'b2',
    L: () => w.listings.get(listingId)!,
    v: () => w.listings.get(listingId)!.variants[0]!.id,
    addrOf: (u: string) => `ad_${u}`,
    neg: (id: string) => w.negs.get(id)!,
  };
}
type T = ReturnType<typeof setup>;
const offer = (t: T, who: string, amount: number, at = NOW) =>
  t.run({ type: 'offer.make', userId: who, listingId: t.listingId, variantId: t.v(), amount }, at);
const respond = (t: T, who: string, id: string, action: 'ACCEPT' | 'DECLINE' | 'COUNTER', amount?: number, at = NOW, extra: Partial<Cmd> = {}) =>
  t.run({ type: 'offer.respond', userId: who, negotiationId: id, action, amount, ...extra }, at);
const place = (t: T, who: string, method: string, at = NOW) =>
  t.run({ type: 'order.place', userId: who, listingId: t.listingId, variantId: t.v(), addressId: t.addrOf(who), paymentMethod: method }, at);
const sweep = (t: T, at: number) => t.run({ type: 'system.sweep' }, at);

describe('negotiation rules', () => {
  it('R2: offers must be below list price and above the 10% platform floor', () => {
    const t = setup();
    expect(offer(t, t.b1, 2500).code).toBe('AT_OR_ABOVE_LIST');
    expect(offer(t, t.b1, 200).code).toBe('BELOW_PLATFORM_FLOOR');
    expect(offer(t, t.b1, 12.5).code).toBe('INVALID_AMOUNT');
    expect(offer(t, t.b1, 2000).ok).toBe(true);
  });

  it('Fixed-price listings refuse offers; sellers cannot offer on their own listing', () => {
    expect(offer(setup({}, { mode: 'BUY_NOW' }), 'b1', 2000).code).toBe('FIXED_PRICE');
    const t = setup();
    expect(offer(t, t.seller, 2000).code).toBe('OWN_LISTING');
  });

  it('R3: one open negotiation per buyer per variant', () => {
    const t = setup();
    expect(offer(t, t.b1, 2000).ok).toBe(true);
    expect(offer(t, t.b1, 2100).code).toBe('ALREADY_OPEN');
  });

  it('R4/R5: turn-taking and converging counters', () => {
    const t = setup();
    const id = offer(t, t.b1, 1800).negotiationId as string;
    expect(respond(t, t.b1, id, 'COUNTER', 1900).code).toBe('NOT_YOUR_TURN');
    expect(respond(t, t.seller, id, 'COUNTER', 1700).code).toBe('ACCEPT_INSTEAD');
    expect(respond(t, t.seller, id, 'COUNTER', 2500).code).toBe('AT_OR_ABOVE_LIST');
    expect(respond(t, t.seller, id, 'COUNTER', 2300).ok).toBe(true);
    expect(respond(t, t.b1, id, 'COUNTER', 1700).code).toBe('MUST_INCREASE');
    expect(respond(t, t.b1, id, 'COUNTER', 2300).code).toBe('ACCEPT_INSTEAD');
    expect(respond(t, t.b1, id, 'COUNTER', 2000).ok).toBe(true);
    expect(respond(t, t.seller, id, 'COUNTER', 2350).code).toBe('MUST_DECREASE');
    expect(respond(t, t.seller, id, 'COUNTER', 2200).ok).toBe(true);
    expect(t.neg(id).offers.map((o) => o.status).join(',')).toBe('COUNTERED,COUNTERED,COUNTERED,PENDING');
  });

  it('R6: turn limit blocks further counters after 6 offers', () => {
    const t = setup();
    const id = offer(t, t.b1, 1500).negotiationId as string;
    (
      [
        ['seller', 2400],
        ['b1', 1600],
        ['seller', 2300],
        ['b1', 1700],
        ['seller', 2200],
      ] as const
    ).forEach(([who, a]) => expect(respond(t, who, id, 'COUNTER', a).ok).toBe(true));
    expect(respond(t, t.b1, id, 'COUNTER', 1800).code).toBe('TURN_LIMIT');
    expect(respond(t, t.b1, id, 'ACCEPT').ok).toBe(true);
  });

  it('R6: at most 3 new negotiations per buyer per listing in 24 h', () => {
    const t = setup({}, { stock: 5 });
    for (let i = 0; i < 3; i++) {
      const id = offer(t, t.b1, 1500 + i).negotiationId as string;
      expect(t.run({ type: 'offer.withdraw', userId: t.b1, negotiationId: id }).ok).toBe(true);
    }
    expect(offer(t, t.b1, 1600).code).toBe('DAILY_LIMIT');
    expect(offer(t, t.b1, 1600, NOW + DAY + 1).ok).toBe(true);
  });

  it('R7: pending offers expire after the listing expiry window', () => {
    const t = setup();
    const id = offer(t, t.b1, 2000).negotiationId as string;
    sweep(t, NOW + 23 * HOUR);
    expect(t.neg(id).status).toBe('OPEN');
    sweep(t, NOW + 24 * HOUR);
    expect(t.neg(id).status).toBe('CLOSED');
    expect(t.neg(id).closeReason).toBe('EXPIRED');
  });
});

describe('automation (private seller rules)', () => {
  it('B-7: buyers can never tell an automatic accept or decline from the seller’s own', () => {
    const t = setup({ autoAcceptAt: 2200, autoDeclineBelow: 1500 }, { stock: 2 });
    const accepted = offer(t, t.b1, 2200).negotiationId as string;
    const declined = offer(t, t.b2, 1000).negotiationId as string;
    sweep(t, NOW + RULES.AUTO_DECLINE_DELAY_MS);
    const blob = JSON.stringify([t.w.buyerNegotiation(t.b1, accepted), t.w.buyerNegotiation(t.b2, declined)]);
    ['SYSTEM', 'AUTO', 'automatic'].forEach((k) => expect(blob, 'leaked ' + k).not.toContain(k));
    expect(t.w.buyerNegotiation(t.b2, declined)).toMatchObject({ closeReason: 'DECLINED', closeText: 'Offer declined' });
    expect(t.w.notices.filter((x) => x.audience === 'buyer').every((x) => !/AUTO/.test(x.code))).toBe(true);
    // The seller still sees what happened.
    expect(t.neg(declined).closeReason).toBe('AUTO_DECLINED');
    expect(t.w.notices.some((x) => x.audience === 'seller' && x.code === 'AUTO_DECLINED')).toBe(true);
  });

  it('R8: auto-accept at or above threshold reserves stock', () => {
    const t = setup({ autoAcceptAt: 2200 });
    const n = t.neg(offer(t, t.b1, 2200).negotiationId as string);
    expect(n.status).toBe('AGREED');
    expect(n.agreement?.acceptedBy).toBe('SYSTEM');
    expect(n.agreement?.price).toBe(220000);
    expect([...t.w.reservations.values()].filter((r) => r.status === 'ACTIVE')).toHaveLength(1);
  });

  it('R8: auto-decline is delayed and generic; private rules never reach buyer views', () => {
    const t = setup({ autoAcceptAt: 2300, autoDeclineBelow: 1500, autoCounterAt: 2400 });
    const id = offer(t, t.b1, 1000).negotiationId as string;
    expect(t.neg(id).status).toBe('OPEN');
    const blob = JSON.stringify([t.w.buyerNegotiation(t.b1, id), t.w.buyerListing(t.listingId, NOW)]);
    ['autoAcceptAt', 'autoDeclineBelow', 'autoCounterAt', 'autoDeclineAt', 'autoCounterDueAt', 'systemCountered', '230000', '150000', '240000', 'rules'].forEach((k) =>
      expect(blob, 'leaked ' + k).not.toContain(k),
    );
    sweep(t, NOW + RULES.AUTO_DECLINE_DELAY_MS);
    expect(t.neg(id).closeReason).toBe('AUTO_DECLINED');
  });

  it('R8: auto-counter arrives after 5 s, repeats below the minimum, never goes up, and looks like the seller', () => {
    const t = setup({ autoAcceptAt: 2300, autoCounterAt: 2400 });
    const id = offer(t, t.b1, 1800).negotiationId as string;
    expect(t.neg(id).offers).toHaveLength(1);
    sweep(t, NOW + 4000);
    expect(t.neg(id).offers).toHaveLength(1);
    sweep(t, NOW + 5000);
    let n = t.neg(id);
    expect(n.offers).toHaveLength(2);
    expect(n.offers[1]!.by).toBe('SYSTEM');
    expect(n.offers[1]!.amount).toBe(240000);
    const view = t.w.buyerNegotiation(t.b1, id)!;
    expect(view.offers.every((o) => !('automatic' in o))).toBe(true);
    expect(JSON.stringify(view)).not.toContain('SYSTEM');
    expect(t.w.notices.some((x) => x.audience === 'buyer' && /AUTO/.test(x.code))).toBe(false);
    expect(respond(t, t.b1, id, 'COUNTER', 2000, NOW + 6000).ok).toBe(true);
    sweep(t, NOW + 11000);
    n = t.neg(id);
    expect(n.offers).toHaveLength(4);
    expect(n.offers[3]!.amount).toBe(240000);
    expect(respond(t, t.b1, id, 'COUNTER', 2350, NOW + 12000).ok).toBe(true);
    n = t.neg(id);
    expect(n.status).toBe('AGREED');
    expect(n.agreement?.price).toBe(235000);
  });

  it('R8: if the seller counters lower by hand, the automatic counter repeats that lower amount', () => {
    const t = setup({ autoAcceptAt: 2200, autoCounterAt: 2400 });
    const id = offer(t, t.b1, 1800).negotiationId as string;
    expect(respond(t, t.seller, id, 'COUNTER', 2300, NOW + 1000).ok).toBe(true);
    sweep(t, NOW + 6000);
    expect(t.neg(id).offers).toHaveLength(2);
    expect(respond(t, t.b1, id, 'COUNTER', 2000, NOW + 7000).ok).toBe(true);
    sweep(t, NOW + 12000);
    const n = t.neg(id);
    expect(n.offers[3]!.by).toBe('SYSTEM');
    expect(n.offers[3]!.amount).toBe(230000);
  });

  it('R8: auto-counter stops at the turn limit; the last offer goes to the seller', () => {
    const t = setup({ autoAcceptAt: 2400, autoCounterAt: 2450 });
    let at = NOW;
    const id = offer(t, t.b1, 1500, at).negotiationId as string;
    [1600, 1700].forEach((a) => {
      at += 6000;
      sweep(t, at);
      expect(respond(t, t.b1, id, 'COUNTER', a, at).ok).toBe(true);
    });
    at += 6000;
    sweep(t, at);
    const n = t.neg(id);
    expect(n.offers).toHaveLength(6);
    expect(n.offers[5]!.by).toBe('SYSTEM');
    expect(respond(t, t.b1, id, 'COUNTER', 1800, at).code).toBe('TURN_LIMIT');
  });
});

describe('agreements, checkout and stock', () => {
  it('R9/R10: agreed price is server-side, buyer-only, and lapses after the checkout window', () => {
    const t = setup({ autoAcceptAt: 2000 });
    const id = offer(t, t.b1, 2100).negotiationId as string;
    expect(t.run({ type: 'order.place', userId: t.b2, negotiationId: id, addressId: t.addrOf(t.b2), paymentMethod: 'UPI' }).code).toBe('NOT_FOUND');
    expect(place(t, t.b2, 'UPI').code).toBe('OUT_OF_STOCK');
    sweep(t, NOW + 12 * HOUR);
    expect(t.neg(id).status).toBe('LAPSED');
    expect(t.run({ type: 'order.place', userId: t.b1, negotiationId: id, addressId: t.addrOf(t.b1), paymentMethod: 'UPI' }, NOW + 12 * HOUR).code).toBe('NOT_AGREED');
    expect(place(t, t.b2, 'UPI', NOW + 12 * HOUR).ok).toBe(true);
  });

  it('Checkout at agreed price creates an order, consumes stock, and invalidates other offers (R11)', () => {
    const t = setup({});
    const a = offer(t, t.b1, 2000).negotiationId as string;
    const b = offer(t, t.b2, 1900).negotiationId as string;
    expect(respond(t, t.seller, a, 'ACCEPT').ok).toBe(true);
    expect(t.neg(b).closeReason).toBe('SOLD_OUT');
    expect(respond(t, t.seller, b, 'ACCEPT').code).toBe('NOT_OPEN');
    const bad = t.run({ type: 'order.place', userId: t.b1, negotiationId: a, addressId: t.addrOf(t.b1), paymentMethod: 'LINK' });
    expect(bad.code).toBe('NO_METHOD');
    expect(t.neg(a).status).toBe('AGREED');
    const r = t.run({ type: 'order.place', userId: t.b1, negotiationId: a, addressId: t.addrOf(t.b1), paymentMethod: 'UPI' });
    expect(r.ok).toBe(true);
    const o = t.w.orders.get(r.orderId as string)!;
    expect(o.price).toBe(200000);
    expect(o.priceSource).toBe('NEGOTIATED');
    expect(t.L().variants[0]!.stock).toBe(0);
    expect(t.neg(a).status).toBe('PURCHASED');
  });

  it('Accepting with no stock fails; two buyers cannot both win the last unit', () => {
    const t = setup({});
    const a = offer(t, t.b1, 2000).negotiationId as string;
    expect(place(t, t.b2, 'UPI').ok).toBe(true);
    expect(t.neg(a).closeReason).toBe('SOLD_OUT');
    expect(place(t, t.b1, 'UPI').code).toBe('OUT_OF_STOCK');
  });

  it('R12–R14: pause, price drop and switch to fixed price invalidate pending offers', () => {
    const t = setup({}, { stock: 3 });
    const edit = (over: Partial<Draft>) => t.draft({ ...over, variants: [{ id: t.v(), label: 'M', stock: 3 }] });
    const a = offer(t, t.b1, 2200).negotiationId as string;
    const b = offer(t, t.b2, 1800).negotiationId as string;
    expect(t.run({ type: 'listing.save', userId: t.seller, listingId: t.listingId, draft: edit({ price: 2100 }) }).ok).toBe(true);
    expect(t.neg(a).closeReason).toBe('PRICE_DROPPED');
    expect(t.neg(b).status).toBe('OPEN');
    expect(t.run({ type: 'listing.save', userId: t.seller, listingId: t.listingId, draft: edit({ price: 2100, bargaining: { mode: 'BUY_NOW', expiryMinutes: 1440 } }) }).ok).toBe(true);
    expect(t.neg(b).closeReason).toBe('FIXED_PRICE');
    expect(t.run({ type: 'listing.save', userId: t.seller, listingId: t.listingId, draft: edit({ price: 2100 }) }).ok).toBe(true);
    const c = offer(t, t.b2, 1800).negotiationId as string;
    expect(t.run({ type: 'listing.setStatus', userId: t.seller, listingId: t.listingId, status: 'PAUSED' }).ok).toBe(true);
    expect(t.neg(c).closeReason).toBe('LISTING_PAUSED');
  });
});

describe('validation', () => {
  it('Listing rule validation: decline < accept ≤ counter < list price', () => {
    const base = { title: 'Kurta', category: 'Ethnic wear', price: 250000, media: [{}], variants: [{ label: 'M', stock: 1 }], bargaining: { mode: 'BOTH', expiryMinutes: 1440 } };
    const rules = (r: Record<string, number>) => validateListingDraft({ ...base, rules: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v * 100])) }).errors;
    expect(rules({ autoDeclineBelow: 2300, autoAcceptAt: 2200 }).autoDeclineBelow).toBeTruthy();
    expect(rules({ autoAcceptAt: 2200, autoCounterAt: 2100 }).autoCounterAt).toBeTruthy();
    expect(rules({ autoAcceptAt: 2500 }).autoAcceptAt).toBeTruthy();
    expect(rules({ autoDeclineBelow: 1500, autoAcceptAt: 2200, autoCounterAt: 2300 })).toEqual({});
  });

  it('Identity: phone numbers are normalised so one number is one identity across both apps', () => {
    expect(isValidIndianMobile(normalizePhone('12345'))).toBe(false);
    expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    expect(normalizePhone('9876543210')).toBe(normalizePhone('+91 98765 43210'));
    expect(isValidIndianMobile('9876543210')).toBe(true);
  });

  it('Payment profile validation', () => {
    expect(validatePayment({}).errors.payment).toBeTruthy();
    expect(validatePayment({ upiId: 'not-an-id' }).errors.upiId).toBeTruthy();
    expect(validatePayment({ bankAccount: '123', bankIfsc: 'XXXX', bankHolder: '' }).errors.bankIfsc).toBeTruthy();
    expect(validatePayment({ paymentLink: 'http://pay' }).errors.paymentLink).toBeTruthy();
    expect(validatePayment({ upiId: 'meher.closet@okaxis' }).errors).toEqual({});
    expect(validatePayment({ website: 'https://shop.example.com' }).errors).toEqual({});
  });

  it('Payment details never appear in public listing views', () => {
    const t = setup({});
    const blob = JSON.stringify(t.w.buyerListing(t.listingId, NOW));
    ['123456789012', 'ICIC0001234', 'shop@okicici'].forEach((k) => expect(blob, 'leaked ' + k).not.toContain(k));
  });

  it('Direct-pay listing requires a direct payment method on the seller profile', () => {
    const w = new World();
    w.addSeller('web', { website: 'https://web.example.com' });
    const d: Draft = { title: 'Kurta', category: 'Ethnic wear', price: 2500, media: [{}], variants: [{ label: 'M', stock: 1 }], bargaining: { mode: 'BOTH', expiryMinutes: 1440 }, rules: {} };
    const save = (draft: Draft) => w.exec({ type: 'listing.save', userId: 'web', publish: true, draft }, NOW) as { ok: boolean; fields?: Record<string, string> };
    expect(save({ ...d, checkout: { channel: 'DIRECT' } }).fields?.channel).toBeTruthy();
    expect(save({ ...d, checkout: { channel: 'WEBSITE', productUrl: 'web.example.com/x' } }).fields?.productUrl).toBeTruthy();
    const site = { channel: 'WEBSITE', productUrl: 'https://web.example.com/x' };
    expect(save({ ...d, rules: { autoAcceptAt: 2200 }, checkout: site }).fields?.acceptCode).toBeTruthy();
    expect(save({ ...d, rules: { autoAcceptAt: 2200 }, checkout: site, dealCodes: { accept: { type: 'CODE', value: 'SAVE300' } } }).ok).toBe(true);
  });
});

describe('orders (only the seller moves an order)', () => {
  it('Direct orders: seller confirms payment, ships (optional details) and delivers; buyers only view', () => {
    const t = setup({}, { stock: 2 });
    const id = place(t, t.b1, 'BANK').orderId as string;
    const o = () => t.w.orders.get(id)!;
    expect(o().status).toBe('PLACED');
    expect(t.L().variants[0]!.stock).toBe(1);
    expect(t.w.buyerOrder(t.b1, id)?.payTo?.bank?.account).toBe('123456789012');
    ['order.confirm', 'order.ship', 'order.deliver', 'order.cancel'].forEach((type) =>
      expect(t.run({ type, userId: t.b1, orderId: id, reason: 'OTHER', shipment: { carrier: 'x' } }).code, 'buyer moved ' + type).toBe('NOT_FOUND'),
    );
    expect(t.run({ type: 'order.confirm', userId: t.seller, orderId: id, shipment: { trackingUrl: 'http://bad' } }).code).toBe('VALIDATION');
    expect(t.run({ type: 'order.confirm', userId: t.seller, orderId: id }).ok).toBe(true);
    expect(o().status).toBe('CONFIRMED');
    expect(t.w.buyerOrder(t.b1, id)?.payTo).toBeUndefined();
    expect(t.run({ type: 'order.ship', userId: t.seller, orderId: id, shipment: {} }).code).toBe('VALIDATION');
    expect(t.run({ type: 'order.ship', userId: t.seller, orderId: id, shipment: { carrier: 'Delhivery', trackingId: 'AWB123', trackingUrl: 'https://track.example.com/AWB123', expectedDate: '2026-11-04' } }).ok).toBe(true);
    expect(o().status).toBe('SHIPPED');
    expect(o().shipment?.trackingId).toBe('AWB123');
    expect(t.run({ type: 'order.deliver', userId: t.seller, orderId: id }).ok).toBe(true);
    expect(o().status).toBe('DELIVERED');
    expect(t.run({ type: 'order.cancel', userId: t.seller, orderId: id, reason: 'OTHER' }).code).toBe('INVALID_STATE');
  });

  it('Seller can confirm payment and add shipment in one step, or skip shipping (hand delivery)', () => {
    const t = setup({}, { stock: 2 });
    const a = place(t, t.b1, 'UPI').orderId as string;
    expect(t.run({ type: 'order.confirm', userId: t.seller, orderId: a, shipment: { carrier: 'DTDC', trackingId: 'D1' } }).ok).toBe(true);
    expect(t.w.orders.get(a)!.status).toBe('SHIPPED');
    const b = place(t, t.b2, 'UPI').orderId as string;
    expect(t.run({ type: 'order.confirm', userId: t.seller, orderId: b }).ok).toBe(true);
    expect(t.run({ type: 'order.deliver', userId: t.seller, orderId: b }).ok).toBe(true);
  });

  it('Unconfirmed orders expire and restock; seller cancellations restock except out-of-stock; stats are public', async () => {
    const { sellerStats } = await import('../src/index.js');
    const t = setup({}, { stock: 2 });
    const a = place(t, t.b1, 'UPI').orderId as string;
    const b = place(t, t.b2, 'UPI').orderId as string;
    expect(t.L().variants[0]!.stock).toBe(0);
    expect(t.run({ type: 'order.cancel', userId: t.seller, orderId: b, reason: 'NOPE' }).code).toBe('VALIDATION');
    expect(t.run({ type: 'order.cancel', userId: t.seller, orderId: b, reason: 'PAYMENT_NOT_RECEIVED' }).ok).toBe(true);
    expect(t.L().variants[0]!.stock).toBe(1);
    sweep(t, NOW + 48 * HOUR);
    expect(t.w.orders.get(a)!.status).toBe('EXPIRED');
    expect(t.L().variants[0]!.stock).toBe(2);
    const st = sellerStats([...t.w.orders.values()]);
    expect([st.orders, st.cancelled, st.expired]).toEqual([2, 1, 1]);
  });

  it('Out-of-stock cancellation does not restock', () => {
    const t = setup({}, { stock: 1 });
    const a = place(t, t.b1, 'UPI').orderId as string;
    expect(t.run({ type: 'order.cancel', userId: t.seller, orderId: a, reason: 'OUT_OF_STOCK' }).ok).toBe(true);
    expect(t.L().variants[0]!.stock).toBe(0);
  });
});

describe('website listings (deal codes)', () => {
  const web = (rules: NonNullable<Draft['rules']>, codes: Draft['dealCodes']) =>
    setup(rules, { stock: 2, checkout: { channel: 'WEBSITE', productUrl: 'https://shop.example.com/kurta' }, dealCodes: codes });

  it('Auto-accept agrees at the pre-set code price and reveals the code only on agreement', () => {
    const t = web({ autoAcceptAt: 2200, autoCounterAt: 2350 }, { accept: { type: 'CODE', value: 'FY2200' }, counter: { type: 'LINK', value: 'https://shop.example.com/kurta?d=2350' } });
    const low = offer(t, t.b2, 1800).negotiationId as string;
    sweep(t, NOW + 5000);
    const lowView = t.w.buyerNegotiation(t.b2, low)!;
    expect(lowView.offers[1]!.amount).toBe(235000);
    expect(JSON.stringify(lowView)).not.toContain('d=2350');
    expect(respond(t, t.b2, low, 'ACCEPT', undefined, NOW + 5000).ok).toBe(true);
    expect(t.w.buyerNegotiation(t.b2, low)!.agreement?.dealAccess?.value).toBe('https://shop.example.com/kurta?d=2350');
    const id = offer(t, t.b1, 2300).negotiationId as string;
    const view = t.w.buyerNegotiation(t.b1, id)!;
    expect(view.status).toBe('AGREED');
    expect(view.agreement?.price).toBe(220000);
    expect(view.agreement?.dealAccess?.value).toBe('FY2200');
    expect(place(t, t.b1, 'UPI').code).toBe('USE_WEBSITE');
    const r = t.run({ type: 'order.place', userId: t.b1, negotiationId: id });
    expect(r.ok).toBe(true);
    expect(r.url).toBe('https://shop.example.com/kurta');
    const o = t.w.orders.get(r.orderId as string)!;
    expect(o.channel).toBe('WEBSITE');
    expect(o.paymentMethod).toBeNull();
    expect(o.dealAccess?.value).toBe('FY2200');
    expect(t.run({ type: 'order.confirm', userId: t.seller, orderId: o.id }).ok).toBe(true);
  });

  it('Seller must supply a code or link to accept or counter manually', () => {
    const t = web({}, {});
    const id = offer(t, t.b1, 2000).negotiationId as string;
    expect(respond(t, t.seller, id, 'ACCEPT').code).toBe('DEAL_ACCESS_REQUIRED');
    expect(respond(t, t.seller, id, 'COUNTER', 2300).code).toBe('DEAL_ACCESS_REQUIRED');
    expect(respond(t, t.seller, id, 'COUNTER', 2300, NOW, { dealAccess: { type: 'CODE', value: 'a b' } }).code).toBe('DEAL_ACCESS_REQUIRED');
    expect(respond(t, t.seller, id, 'COUNTER', 2300, NOW, { dealAccess: { type: 'CODE', value: 'AARAV2300' } }).ok).toBe(true);
    expect(JSON.stringify(t.w.buyerNegotiation(t.b1, id))).not.toContain('AARAV2300');
    expect(respond(t, t.b1, id, 'COUNTER', 2100).ok).toBe(true);
    expect(respond(t, t.seller, id, 'ACCEPT', undefined, NOW, { dealAccess: { type: 'LINK', value: 'https://shop.example.com/kurta?p=2100' } }).ok).toBe(true);
    expect(t.w.buyerNegotiation(t.b1, id)!.agreement?.dealAccess?.type).toBe('LINK');
  });
});
