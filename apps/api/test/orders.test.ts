import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { listingVariants, negotiations, notifications, orders, reservations } from '../src/db/schema.js';
import { NegotiationEvents, type RealtimeEvent } from '../src/negotiations/negotiation-events.js';
import { SweepRunner } from '../src/scheduler/sweep-runner.js';
import { JPEG, PNG, makeCaller, makeSeller, signIn, uploadFile, type Caller, type Json } from './api.js';
import { ManualClock, dbOf, startApp } from './helpers.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const rupees = (n: number) => n * 100;

let app: NestFastifyApplication;
let call: Caller;
let dir: string;
let clock: ManualClock;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-orders-'));
  clock = new ManualClock();
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir }, clock);
  call = makeCaller(app);
});
afterEach(async () => {
  await dbOf(app).db.execute(sql`truncate table users cascade`);
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const tick = () => app.get(SweepRunner).tick();
const db = () => dbOf(app).db;

const address = { name: 'Asha', line1: '12 Road No 3', line2: 'Banjara Hills', pin: '500034', city: 'Hyderabad', state: 'Telangana' };
const qr = (pa: string) => `upi://pay?pa=${pa}&pn=Sana%20Studio&cu=INR`;

interface Shop {
  seller: string;
  sellerPhone: string;
  listingId: string;
  variantId: string;
  photoId: string;
  buyerA: string;
  buyerB: string;
  buyerAPhone: string;
  buyerBPhone: string;
}

let seq = 0;
/** A seller with one live listing (₹1,500, size M) and two buyers who have finished their profile. */
async function shop(over: Record<string, unknown> = {}, stock = 1, opts: { qr?: boolean } = {}): Promise<Shop> {
  const n = ++seq;
  const sellerPhone = `98765${String(20000 + n).slice(-5)}`;
  const seller = await makeSeller(call, sellerPhone, `ordshop${n}x`);
  if (opts.qr) {
    const m = await uploadFile(call, seller, PNG(), { purpose: 'UPI_QR', mime: 'image/png' });
    const r = await call('PUT', '/v1/seller/payment', { token: seller, body: { upiId: 'sana@okaxis', upiQrMediaId: m.id, upiQrPayload: qr('sana@okaxis'), conductAccepted: true } });
    if (r.status !== 200) throw new Error(`qr failed: ${JSON.stringify(r.body)}`);
  }
  const photo = (await uploadFile(call, seller, JPEG())).id as string;
  const l = await call('POST', '/v1/seller/listings', {
    token: seller,
    body: {
      title: 'Cotton kurta',
      category: 'Ethnic wear',
      price: rupees(1500),
      media: [{ mediaId: photo }],
      variants: [{ label: 'M', stock }],
      bargaining: { mode: 'BOTH', expiryMinutes: 1440 },
      checkout: { channel: 'DIRECT' },
      publish: true,
      ...over,
    },
  });
  if (l.status !== 201) throw new Error(`listing failed: ${JSON.stringify(l.body)}`);
  const buyer = async (phone: string, contact: string) => {
    const t = await signIn(call, phone, 'buyer');
    const p = await call('PUT', '/v1/buyer/profile', { token: t, body: { name: 'Asha Buyer', address, contact: { phone: contact }, agreementAccepted: true } });
    if (p.status !== 200) throw new Error(`profile failed: ${JSON.stringify(p.body)}`);
    return t;
  };
  return {
    seller,
    sellerPhone,
    listingId: l.body.id,
    variantId: l.body.variants[0].id,
    photoId: photo,
    buyerA: await buyer(`97654${String(20000 + n).slice(-5)}`, '9700012345'),
    buyerB: await buyer(`96543${String(20000 + n).slice(-5)}`, '9700054321'),
    buyerAPhone: `97654${String(20000 + n).slice(-5)}`,
    buyerBPhone: `96543${String(20000 + n).slice(-5)}`,
  };
}

/** Moves the clock on. Access tokens last 15 minutes, so everyone signs in again afterwards. */
async function later(s: Shop, ms: number): Promise<void> {
  clock.advance(ms);
  s.seller = await signIn(call, s.sellerPhone, 'seller');
  s.buyerA = await signIn(call, s.buyerAPhone, 'buyer');
  s.buyerB = await signIn(call, s.buyerBPhone, 'buyer');
}

const stockOf = async (s: Shop): Promise<number> => (await db().select({ s: listingVariants.stock }).from(listingVariants).where(eq(listingVariants.id, s.variantId)))[0]!.s;
const orderCount = async (): Promise<number> => (await db().select({ id: orders.id }).from(orders)).length;

const buy = (s: Shop, who: string, over: Json = {}, key?: string) =>
  call('POST', '/v1/buyer/orders', { token: who, body: { listingId: s.listingId, variantId: s.variantId, paymentMethod: 'UPI', ...over }, ...(key ? { headers: { 'idempotency-key': key } } : {}) });
const offer = (s: Shop, who: string, amount: number) => call('POST', `/v1/buyer/listings/${s.listingId}/offers`, { token: who, body: { variantId: s.variantId, amount: rupees(amount) } });
const sellerDo = (s: Shop, id: string, action: string, body: Json = {}) => call('POST', `/v1/seller/negotiations/${id}/${action}`, { token: s.seller, body });
const orderDo = (s: Shop, id: string, action: 'confirm' | 'ship' | 'deliver' | 'cancel', body: Json = {}) => call('POST', `/v1/seller/orders/${id}/${action}`, { token: s.seller, body });
const buyerOrder = (who: string, id: string) => call('GET', `/v1/buyer/orders/${id}`, { token: who });
const sellerOrder = (s: Shop, id: string) => call('GET', `/v1/seller/orders/${id}`, { token: s.seller });

/** Buyer offers `amount`; the seller accepts it. Returns the negotiation id. */
async function agree(s: Shop, who: string, amount: number, accept: Json = {}): Promise<string> {
  const o = await offer(s, who, amount);
  expect(o.status).toBe(201);
  const id = o.body.id as string;
  const a = await sellerDo(s, id, 'accept', accept);
  expect(a.status, JSON.stringify(a.body)).toBe(200);
  return id;
}

describe('placing an order', () => {
  it('places a direct order at the listed price and gives UPI instructions with the order number as the note', async () => {
    const s = await shop();
    const r = await buy(s, s.buyerA);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const o = r.body;
    expect(o.number).toMatch(/^FD-\d{6,}$/);
    expect(o).toMatchObject({ status: 'PLACED', price: rupees(1500), listPrice: rupees(1500), priceSource: 'LIST', channel: 'DIRECT', paymentMethod: 'UPI', address });
    expect(o.listing).toMatchObject({ title: 'Cotton kurta', variantLabel: 'M', channel: 'DIRECT' });
    expect(o.listing.coverUrl).toMatch(/^\/v1\/media\//);
    expect(o.payment).toMatchObject({ method: 'UPI', note: o.number, amount: rupees(1500), payeeName: 'Sana Studio', upiId: 'sana@okaxis', bank: null, paymentLink: null });
    const uri = new URL(o.payment.upiUri);
    expect(uri.protocol).toBe('upi:');
    expect(Object.fromEntries(uri.searchParams)).toEqual({ pa: 'sana@okaxis', pn: 'Sana Studio', am: '1500.00', cu: 'INR', tn: o.number });
    expect(o.confirmBy - o.createdAt).toBe(48 * HOUR);
    expect(o.seller).toMatchObject({ name: 'Sana Studio', slaConfirmHours: 6, slaShipDays: 2, contact: { phone: null, whatsapp: '9000099998' } });
    expect(o.seller.record).toMatchObject({ orders: 1, completed: 0, rating: null, reviewCount: 0 });
    expect(o.threadId).toBeTruthy();
    expect(o.unread).toBe(0);
    expect(await stockOf(s)).toBe(0);
    expect(await orderCount()).toBe(1);
  });

  it('shows the seller the order with the buyer’s name, address and contact while it is open', async () => {
    const s = await shop();
    const id = (await buy(s, s.buyerA)).body.id as string;
    const list = await call('GET', '/v1/seller/orders', { token: s.seller });
    expect(list.body).toMatchObject({ needsConfirm: 1, unread: 0 });
    const o = list.body.items[0];
    expect(o).toMatchObject({ id, status: 'PLACED', buyerName: 'Asha Buyer', address, buyerContact: { phone: '9700012345', whatsapp: null }, canConfirm: true, canShip: false, canDeliver: false, canCancel: true, price: rupees(1500) });
    expect(JSON.stringify(o)).not.toContain('sana@okaxis');
    const note = await db().select().from(notifications).where(eq(notifications.orderId, id));
    expect(note).toMatchObject([{ code: 'ORDER_PLACED', app: 'seller' }]);
  });

  it('takes the price from the listing, never from the client', async () => {
    const s = await shop();
    const r = await buy(s, s.buyerA, { price: 100, pricePaise: 100, amount: 100 });
    expect(r.status).toBe(201);
    expect(r.body.price).toBe(rupees(1500));
  });

  it('refuses what the rules refuse', async () => {
    const s = await shop();
    const bad = async (over: Json, status: number, code: string) => {
      const r = await buy(s, s.buyerA, over);
      expect([r.status, r.body.code], JSON.stringify(over)).toEqual([status, code]);
    };
    await bad({ paymentMethod: null }, 422, 'NO_METHOD');
    await bad({ paymentMethod: 'BANK' }, 422, 'NO_METHOD'); // this seller takes UPI only
    await bad({ variantId: '00000000-0000-4000-8000-000000000000' }, 422, 'NO_VARIANT');
    await bad({ listingId: undefined, variantId: undefined }, 400, 'VALIDATION');
    await bad({ addressId: '00000000-0000-4000-8000-000000000000' }, 422, 'NO_ADDRESS');
    expect(await orderCount()).toBe(0);
    expect(await stockOf(s)).toBe(1);

    const noProfile = await signIn(call, '9111100001', 'buyer');
    const r = await buy(s, noProfile);
    expect([r.status, r.body.code]).toEqual([403, 'NO_PROFILE']);

    const me = await signIn(call, s.sellerPhone, 'buyer');
    await call('PUT', '/v1/buyer/profile', { token: me, body: { name: 'Sana', address, contact: { phone: '9700099999' }, agreementAccepted: true } });
    const own = await buy(s, me);
    expect([own.status, own.body.code]).toEqual([403, 'OWN_LISTING']);
  });

  it('refuses a paused listing, even with an agreed price', async () => {
    const s = await shop({}, 2);
    const neg = await agree(s, s.buyerB, 1200);
    expect((await call('POST', `/v1/seller/listings/${s.listingId}/status`, { token: s.seller, body: { status: 'PAUSED' } })).status).toBe(200);
    const plain = await buy(s, s.buyerA);
    expect([plain.status, plain.body.code, plain.body.detail ?? plain.body.message]).toEqual([404, 'NOT_AVAILABLE', expect.stringMatching(/paused|isn’t available/)]);
    const agreed = await buy(s, s.buyerB, { listingId: undefined, variantId: undefined, negotiationId: neg });
    expect([agreed.status, agreed.body.code]).toEqual([404, 'NOT_AVAILABLE']);
    expect(await orderCount()).toBe(0);
    expect(await stockOf(s)).toBe(2);
  });

  it('sends a website listing to the website: Buy now creates no order (O-5)', async () => {
    const s = await shop({ checkout: { channel: 'WEBSITE', productUrl: 'https://shop.example/p' } });
    const r = await buy(s, s.buyerA, { paymentMethod: undefined });
    expect([r.status, r.body.code]).toEqual([422, 'USE_WEBSITE']);
    expect(await orderCount()).toBe(0);
    expect(await stockOf(s)).toBe(1);
  });
});

describe('the last unit', () => {
  it('goes to exactly one of two buyers who order at the same moment', async () => {
    const s = await shop();
    const [a, b] = await Promise.all([buy(s, s.buyerA), buy(s, s.buyerB)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe('OUT_OF_STOCK');
    expect(await orderCount()).toBe(1);
    expect(await stockOf(s)).toBe(0);
  });

  it('is held for an agreement: a plain buy cannot take the unit, and the agreed buyer always can', async () => {
    const s = await shop();
    const neg = await agree(s, s.buyerA, 1200);
    const [plain, agreed] = await Promise.all([buy(s, s.buyerB), buy(s, s.buyerA, { listingId: undefined, variantId: undefined, negotiationId: neg })]);
    expect(agreed.status, JSON.stringify(agreed.body)).toBe(201);
    expect(plain.status).toBe(409);
    expect(plain.body.code).toBe('OUT_OF_STOCK');
    expect(await orderCount()).toBe(1);
    expect(await stockOf(s)).toBe(0);
  });

  it('closes other open offers on the size once it sells out', async () => {
    const s = await shop();
    const open = await offer(s, s.buyerB, 1000); // waiting for the seller
    expect(open.status).toBe(201);
    expect((await buy(s, s.buyerA)).status).toBe(201);
    const after = await call('GET', `/v1/buyer/negotiations/${open.body.id}`, { token: s.buyerB });
    expect(after.body).toMatchObject({ status: 'CLOSED', closeReason: 'SOLD_OUT' });
  });
});

describe('ordering at an agreed price', () => {
  it('uses the agreed price, uses up the agreement and its held unit, and makes only one order', async () => {
    const s = await shop({}, 2);
    const neg = await agree(s, s.buyerA, 1200);
    const r = await buy(s, s.buyerA, { listingId: undefined, variantId: undefined, negotiationId: neg });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ price: rupees(1200), listPrice: rupees(1500), priceSource: 'NEGOTIATED', status: 'PLACED' });
    expect(r.body.payment.amount).toBe(rupees(1200));
    expect(new URL(r.body.payment.upiUri).searchParams.get('am')).toBe('1200.00');
    expect(await stockOf(s)).toBe(1);

    const n = (await db().select().from(negotiations).where(eq(negotiations.id, neg)))[0]!;
    expect(n.status).toBe('PURCHASED');
    const held = await db().select().from(reservations).where(eq(reservations.negotiationId, neg));
    expect(held.map((h) => h.status)).toEqual(['CONSUMED']);
    const seen = await call('GET', `/v1/buyer/negotiations/${neg}`, { token: s.buyerA });
    expect(seen.body.status).toBe('PURCHASED');

    const again = await buy(s, s.buyerA, { listingId: undefined, variantId: undefined, negotiationId: neg });
    expect([again.status, again.body.code]).toEqual([409, 'NOT_AGREED']);
    expect(await orderCount()).toBe(1);
    expect(await stockOf(s)).toBe(1);
  });

  it('is only for the buyer of the agreement', async () => {
    const s = await shop({}, 2);
    const neg = await agree(s, s.buyerA, 1200);
    const r = await buy(s, s.buyerB, { listingId: undefined, variantId: undefined, negotiationId: neg });
    expect(r.status).toBe(404);
    expect(await orderCount()).toBe(0);
  });

  it('refuses an agreement whose checkout window has passed, and frees the unit', async () => {
    const s = await shop();
    const neg = await agree(s, s.buyerA, 1200);
    await later(s, 12 * HOUR + SECOND);
    const r = await buy(s, s.buyerA, { listingId: undefined, variantId: undefined, negotiationId: neg });
    expect([r.status, r.body.code]).toEqual([409, 'NOT_AGREED']);
    expect(r.body.detail ?? r.body.message).toMatch(/closed/);
    expect(await orderCount()).toBe(0);
    expect(await stockOf(s)).toBe(1);
    expect((await buy(s, s.buyerB)).status).toBe(201); // the unit is free again
  });

  it('turns a website deal into an order record with no address or payment method (O-4)', async () => {
    const s = await shop({
      checkout: { channel: 'WEBSITE', productUrl: 'https://shop.example/p' },
      dealCodes: { accept: { type: 'CODE', value: 'KURTA12' }, counter: { type: 'CODE', value: 'SECRETCODE2' } },
    });
    const neg = await agree(s, s.buyerA, 1200, { dealAccess: { type: 'CODE', value: 'KURTA12' } });
    const r = await call('POST', '/v1/buyer/orders', { token: s.buyerA, body: { negotiationId: neg } });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'PLACED', channel: 'WEBSITE', price: rupees(1200), priceSource: 'NEGOTIATED', paymentMethod: null, address: null, payment: null, dealAccess: { type: 'CODE', value: 'KURTA12' } });
    expect(r.body.statusLabel).toBe('Waiting for the seller to confirm');
    expect(JSON.stringify(r.body)).not.toContain('SECRETCODE2');
    expect(await stockOf(s)).toBe(0);
    const c = await orderDo(s, r.body.id, 'confirm');
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ status: 'CONFIRMED', statusLabel: 'Order received', channel: 'WEBSITE', dealAccess: { type: 'CODE', value: 'KURTA12' } });
    expect((await buyerOrder(s.buyerA, r.body.id)).body.statusLabel).toBe('Order received');
  });
});

describe('retries', () => {
  it('gives the same order for the same Idempotency-Key and takes only one unit', async () => {
    const s = await shop({}, 3);
    const first = await buy(s, s.buyerA, {}, 'order-key-0001');
    const second = await buy(s, s.buyerA, {}, 'order-key-0001');
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(second.body).toEqual(first.body);
    expect(await orderCount()).toBe(1);
    expect(await stockOf(s)).toBe(2);
    const other = await buy(s, s.buyerA, { paymentMethod: 'LINK' }, 'order-key-0001');
    expect([other.status, other.body.code]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED']);
    expect(await orderCount()).toBe(1);
  });

  it('cannot make two orders from one agreement, even with different keys', async () => {
    const s = await shop({}, 3);
    const neg = await agree(s, s.buyerA, 1200);
    const body = { negotiationId: neg, paymentMethod: 'UPI' };
    const [a, b] = await Promise.all([call('POST', '/v1/buyer/orders', { token: s.buyerA, body, headers: { 'idempotency-key': 'neg-key-00001' } }), call('POST', '/v1/buyer/orders', { token: s.buyerA, body, headers: { 'idempotency-key': 'neg-key-00002' } })]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await orderCount()).toBe(1);
    expect(await stockOf(s)).toBe(2);
  });
});

describe('the seller moves the order forward', () => {
  it('goes PLACED, CONFIRMED, SHIPPED, DELIVERED, and only the seller can do it', async () => {
    const s = await shop();
    const id = (await buy(s, s.buyerA)).body.id as string;

    // A buyer has no such routes, and another seller cannot see the order.
    expect((await call('POST', `/v1/seller/orders/${id}/confirm`, { token: s.buyerA, body: {} })).status).toBe(403);
    const other = await makeSeller(call, '9876599001', 'otherordshop', 'other@okaxis');
    expect((await call('POST', `/v1/seller/orders/${id}/confirm`, { token: other, body: {} })).status).toBe(404);
    expect((await call('GET', `/v1/seller/orders/${id}`, { token: other })).status).toBe(404);
    expect((await orderDo(s, id, 'ship', { courier: 'DTDC' })).body.code).toBe('INVALID_STATE'); // not confirmed yet
    expect((await orderDo(s, id, 'deliver')).body.code).toBe('INVALID_STATE');

    await later(s, 3 * HOUR);
    const c = await orderDo(s, id, 'confirm');
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ status: 'CONFIRMED', statusLabel: 'Payment received', canConfirm: false, canShip: true, canDeliver: true, canCancel: true });
    expect(c.body.confirmedAt - c.body.createdAt).toBe(3 * HOUR);
    expect((await orderDo(s, id, 'confirm')).body.code).toBe('INVALID_STATE');

    const sh = await orderDo(s, id, 'ship', { courier: 'DTDC', trackingNo: 'D123456', trackingUrl: 'https://track.example/D123456', expectedDate: '2026-11-05', note: 'Fragile' });
    expect(sh.status, JSON.stringify(sh.body)).toBe(200);
    expect(sh.body).toMatchObject({ status: 'SHIPPED', shipment: { courier: 'DTDC', trackingNo: 'D123456', trackingUrl: 'https://track.example/D123456', expectedDate: '2026-11-05', note: 'Fragile' }, canCancel: false });
    expect((await buyerOrder(s.buyerA, id)).body).toMatchObject({ status: 'SHIPPED', shipment: { courier: 'DTDC', trackingNo: 'D123456' } });
    expect((await orderDo(s, id, 'cancel', { reason: 'OTHER' })).body.code).toBe('INVALID_STATE');

    const d = await orderDo(s, id, 'deliver');
    expect(d.body).toMatchObject({ status: 'DELIVERED', statusLabel: 'Delivered' });
    expect((await orderDo(s, id, 'ship', { courier: 'X' })).body.code).toBe('INVALID_STATE');
    expect(await stockOf(s)).toBe(0); // delivered orders never restock
  });

  it('can confirm with shipment details in one step, and refuses a bad tracking link', async () => {
    const s = await shop({}, 2);
    const a = (await buy(s, s.buyerA)).body.id as string;
    const bad = await orderDo(s, a, 'confirm', { shipment: { courier: 'DTDC', trackingUrl: 'not a link' } });
    expect([bad.status, bad.body.code]).toEqual([400, 'VALIDATION']);
    expect((await sellerOrder(s, a)).body.status).toBe('PLACED');
    const ok = await orderDo(s, a, 'confirm', { shipment: { courier: 'DTDC', trackingNo: 'D1' } });
    expect(ok.body).toMatchObject({ status: 'SHIPPED', shipment: { courier: 'DTDC', trackingNo: 'D1' } });
    expect(ok.body.confirmedAt).not.toBeNull();
  });

  it('notifies the buyer of each step and publishes ids-only events after the commit', async () => {
    const s = await shop();
    const seen: RealtimeEvent[] = [];
    const off = app.get(NegotiationEvents).subscribeEvents((e) => seen.push(...e));
    try {
      const id = (await buy(s, s.buyerA)).body.id as string;
      await orderDo(s, id, 'confirm');
      expect(seen.map((e) => e.name)).toEqual(['order.updated', 'order.updated']);
      expect(seen[0]).toMatchObject({ payload: { orderId: id } });
      expect(Object.keys(seen[0]!.payload)).toEqual(['orderId']);
      expect(seen[0]!.buyerUserId).toBeTruthy();
      expect(seen[0]!.sellerUserId).toBeTruthy();
    } finally {
      off();
    }
    const note = await db().select().from(notifications).where(and(eq(notifications.app, 'buyer')));
    expect(note.map((n) => n.code)).toEqual(['PAYMENT_RECEIVED']);
  });
});

describe('cancelling and restocking', () => {
  it('restocks once when the seller cancels, unless the reason is out of stock', async () => {
    const s = await shop({}, 2);
    const a = (await buy(s, s.buyerA)).body.id as string;
    const b = (await buy(s, s.buyerB)).body.id as string;
    expect(await stockOf(s)).toBe(0);

    expect((await orderDo(s, a, 'cancel', {})).status).toBe(400); // a reason is required
    const c = await orderDo(s, a, 'cancel', { reason: 'PAYMENT_NOT_RECEIVED', note: 'No payment seen' });
    expect(c.body).toMatchObject({ status: 'CANCELLED', cancelText: 'Payment not received: No payment seen', canCancel: false });
    expect(await stockOf(s)).toBe(1);
    expect((await orderDo(s, a, 'cancel', { reason: 'OTHER' })).body.code).toBe('INVALID_STATE');
    expect(await stockOf(s)).toBe(1); // a second cancel never restocks again

    await orderDo(s, b, 'cancel', { reason: 'OUT_OF_STOCK' });
    expect(await stockOf(s)).toBe(1); // out of stock: the unit does not come back
    expect((await buyerOrder(s.buyerB, b)).body).toMatchObject({ status: 'CANCELLED', cancelText: 'Out of stock' });
  });

  it('can cancel after confirming, and the buyer can buy the freed unit', async () => {
    const s = await shop();
    const a = (await buy(s, s.buyerA)).body.id as string;
    await orderDo(s, a, 'confirm');
    await orderDo(s, a, 'cancel', { reason: 'BUYER_REQUEST' });
    expect(await stockOf(s)).toBe(1);
    expect((await buy(s, s.buyerB)).status).toBe(201);
  });
});

describe('unconfirmed orders expire after 48 hours', () => {
  it('expires, restocks and notifies, and does it once even when sweeps and readers arrive together', async () => {
    const s = await shop();
    const id = (await buy(s, s.buyerA)).body.id as string;
    await later(s, 47 * HOUR);
    await tick();
    expect((await sellerOrder(s, id)).body.status).toBe('PLACED');

    await later(s, HOUR + SECOND);
    const sweeps = await Promise.all([tick(), tick(), buyerOrder(s.buyerA, id), sellerOrder(s, id), call('GET', '/v1/buyer/orders', { token: s.buyerA }), call('GET', '/v1/seller/orders', { token: s.seller })]);
    expect(sweeps[2]!.body.status).toBe('EXPIRED');
    expect(await stockOf(s)).toBe(1); // restocked exactly once
    expect((await buyerOrder(s.buyerA, id)).body).toMatchObject({ status: 'EXPIRED', payment: null, seller: { contact: null } });
    const expired = await db().select().from(notifications).where(eq(notifications.code, 'ORDER_EXPIRED'));
    expect(expired.map((n) => n.app).sort()).toEqual(['buyer', 'seller']);
    expect((await orderDo(s, id, 'confirm')).body.code).toBe('INVALID_STATE');
    await tick();
    expect(await stockOf(s)).toBe(1);
  });

  it('is seen as expired on read even when no sweep has run', async () => {
    const s = await shop();
    const id = (await buy(s, s.buyerA)).body.id as string;
    await later(s, 48 * HOUR + SECOND);
    const r = await buyerOrder(s.buyerA, id);
    expect(r.body.status).toBe('EXPIRED');
    expect(r.body.cancelText).toMatch(/did not confirm/);
    expect(await stockOf(s)).toBe(1);
  });

  it('cannot be confirmed once the time has passed, even before any sweep', async () => {
    const s = await shop();
    const id = (await buy(s, s.buyerA)).body.id as string;
    await later(s, 48 * HOUR + SECOND);
    const r = await orderDo(s, id, 'confirm');
    expect([r.status, r.body.code]).toEqual([409, 'INVALID_STATE']);
    expect(await stockOf(s)).toBe(1);
  });

  it('a cancel and the sweep arriving together restock once', async () => {
    const s = await shop();
    const id = (await buy(s, s.buyerA)).body.id as string;
    await later(s, 48 * HOUR + SECOND);
    await Promise.all([orderDo(s, id, 'cancel', { reason: 'OTHER' }), tick(), tick()]);
    expect(await stockOf(s)).toBe(1);
    const row = (await db().select().from(orders).where(eq(orders.id, id)))[0]!;
    expect(row.restocked).toBe(true);
  });
});

describe('payment details stay private (O-3)', () => {
  it('reach only the buyer of a PLACED direct order, and disappear once it is confirmed', async () => {
    const s = await shop();
    const id = (await buy(s, s.buyerA)).body.id as string;
    const mine = await buyerOrder(s.buyerA, id);
    expect(mine.body.payment.upiId).toBe('sana@okaxis');
    expect((await buyerOrder(s.buyerB, id)).status).toBe(404);
    expect((await call('GET', '/v1/buyer/orders', { token: s.buyerB })).body.items).toEqual([]);
    expect(JSON.stringify((await sellerOrder(s, id)).body)).not.toMatch(/sana@okaxis|upi:\/\//);

    await orderDo(s, id, 'confirm');
    const after = await buyerOrder(s.buyerA, id);
    expect(after.body.payment).toBeNull();
    expect(JSON.stringify(after.body)).not.toMatch(/sana@okaxis|upi:\/\//);
    expect(JSON.stringify((await call('GET', '/v1/buyer/orders', { token: s.buyerA })).body)).not.toMatch(/sana@okaxis|upi:\/\//);
  });

  it('serves the seller’s QR image only to the buyer of the PLACED UPI order', async () => {
    const s = await shop({}, 3, { qr: true });
    const id = (await buy(s, s.buyerA)).body.id as string;
    const o = await buyerOrder(s.buyerA, id);
    expect(o.body.payment.upiQrUrl).toBe(`/v1/buyer/orders/${id}/payment-qr`);
    const img = await call('GET', o.body.payment.upiQrUrl, { token: s.buyerA });
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['cache-control']).toContain('no-store');
    expect(img.raw.subarray(0, 4)).toEqual(PNG().subarray(0, 4));
    expect((await call('GET', o.body.payment.upiQrUrl, { token: s.buyerB })).status).toBe(404);
    expect((await call('GET', o.body.payment.upiQrUrl)).status).toBe(401);
    expect((await call('GET', o.body.payment.upiQrUrl, { token: s.seller })).status).toBe(403);
    // a second order that the seller has already confirmed: no QR any more
    const confirmed = await buy(s, s.buyerA);
    await orderDo(s, confirmed.body.id, 'confirm');
    expect((await call('GET', `/v1/buyer/orders/${confirmed.body.id}/payment-qr`, { token: s.buyerA })).status).toBe(404);
    // and once the first order is confirmed the QR is gone
    await orderDo(s, id, 'confirm');
    expect((await call('GET', `/v1/buyer/orders/${id}/payment-qr`, { token: s.buyerA })).status).toBe(404);
  });

  it('keeps private rules and the other deal code out of every buyer order payload', async () => {
    const s = await shop({
      rules: { autoAcceptAt: rupees(1111), autoCounterAt: rupees(1333), autoDeclineBelow: rupees(777) },
      checkout: { channel: 'WEBSITE', productUrl: 'https://shop.example/p' },
      dealCodes: { accept: { type: 'CODE', value: 'SECRETCODE1' }, counter: { type: 'CODE', value: 'SECRETCODE2' } },
    });
    const first = await offer(s, s.buyerA, 1111); // auto-accepted at the code's price
    expect(first.status).toBe(201);
    const placed = await call('POST', '/v1/buyer/orders', { token: s.buyerA, body: { negotiationId: first.body.id } });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const payloads = [placed.body, (await buyerOrder(s.buyerA, placed.body.id)).body, (await call('GET', '/v1/buyer/orders', { token: s.buyerA })).body];
    for (const p of payloads) {
      const text = JSON.stringify(p);
      for (const secret of ['SECRETCODE2', 'autoAccept', 'autoDecline', 'autoCounter', 'AUTO_', 'SYSTEM', '"rules"', '"dealCodes"', '77700', '133300', 'upi', 'sana@']) expect(text, secret).not.toContain(secret);
    }
    expect(placed.body.dealAccess).toEqual({ type: 'CODE', value: 'SECRETCODE1' }); // the buyer's own deal, which is theirs to use
  });
});

describe('contact numbers (D12)', () => {
  it('are shown to each side only while the order is open', async () => {
    const s = await shop();
    const id = (await buy(s, s.buyerA)).body.id as string;
    expect((await buyerOrder(s.buyerA, id)).body.seller.contact).toEqual({ phone: null, whatsapp: '9000099998' });
    expect((await sellerOrder(s, id)).body.buyerContact).toEqual({ phone: '9700012345', whatsapp: null });
    await orderDo(s, id, 'confirm');
    expect((await buyerOrder(s.buyerA, id)).body.seller.contact).not.toBeNull();
    await orderDo(s, id, 'ship', { courier: 'DTDC' });
    expect((await sellerOrder(s, id)).body.buyerContact).not.toBeNull();
    await orderDo(s, id, 'deliver');
    expect((await buyerOrder(s.buyerA, id)).body.seller.contact).toBeNull();
    const closed = await sellerOrder(s, id);
    expect(closed.body.buyerContact).toBeNull();
    expect(JSON.stringify(closed.body)).not.toContain('9700012345');
    expect(JSON.stringify((await call('GET', '/v1/seller/orders', { token: s.seller })).body)).not.toContain('9700012345');
  });

  it('are gone from a cancelled order too', async () => {
    const s = await shop();
    const id = (await buy(s, s.buyerA)).body.id as string;
    await orderDo(s, id, 'cancel', { reason: 'OTHER' });
    expect((await buyerOrder(s.buyerA, id)).body.seller.contact).toBeNull();
    expect((await sellerOrder(s, id)).body.buyerContact).toBeNull();
  });
});

describe('the seller’s public record (O-7)', () => {
  it('counts delivered, cancelled and expired orders, and the median time to confirm', async () => {
    const s = await shop({}, 6);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await buy(s, s.buyerA)).body.id as string);
    await later(s, 2 * HOUR);
    await orderDo(s, ids[0]!, 'confirm');
    await orderDo(s, ids[0]!, 'deliver');
    await later(s, 2 * HOUR);
    await orderDo(s, ids[1]!, 'confirm');
    await orderDo(s, ids[1]!, 'cancel', { reason: 'OTHER' });
    await orderDo(s, ids[2]!, 'cancel', { reason: 'BUYER_REQUEST' });
    await later(s, 48 * HOUR);
    await tick(); // the fourth expires

    const mine = await call('GET', '/v1/seller/record', { token: s.seller });
    expect(mine.body).toEqual({ orders: 4, completed: 1, confirmed: 2, cancelled: 2, expired: 1, medianConfirmMs: 2 * HOUR, rating: null, reviewCount: 0 });
    const shopId = (await call('GET', '/v1/seller/profile', { token: s.seller })).body.id as string;
    const pub = await call('GET', `/v1/shops/${shopId}/record`); // no sign-in
    expect(pub.status).toBe(200);
    expect(pub.body).toEqual(mine.body);
    expect(Object.keys(pub.body).sort()).toEqual(['cancelled', 'completed', 'confirmed', 'expired', 'medianConfirmMs', 'orders', 'rating', 'reviewCount']);
    expect((await buyerOrder(s.buyerA, ids[0]!)).body.seller.record).toEqual(mine.body);
    expect((await call('GET', '/v1/shops/00000000-0000-4000-8000-000000000000/record')).status).toBe(404);
  });
});

describe('lists and buy again', () => {
  it('lists the buyer’s orders newest first and offers Buy again while the listing is live', async () => {
    const s = await shop({}, 3);
    const first = (await buy(s, s.buyerA)).body.id as string;
    clock.advance(SECOND);
    const second = (await buy(s, s.buyerA)).body.id as string;
    const list = await call('GET', '/v1/buyer/orders', { token: s.buyerA });
    expect(list.body.items.map((i: Json) => i.id)).toEqual([second, first]);
    expect(list.body.items[0].buyAgain).toEqual({ listingId: s.listingId, channel: 'DIRECT', variantId: s.variantId, anyAvailable: true });
    await buy(s, s.buyerB);
    expect((await call('GET', '/v1/buyer/orders', { token: s.buyerA })).body.items[0].buyAgain).toEqual({ listingId: s.listingId, channel: 'DIRECT', variantId: null, anyAvailable: false });
    await call('POST', `/v1/seller/listings/${s.listingId}/status`, { token: s.seller, body: { status: 'PAUSED' } });
    expect((await call('GET', '/v1/buyer/orders', { token: s.buyerA })).body.items[0].buyAgain).toBeNull();
  });

  it('keeps an order’s title, size and price when the listing changes later', async () => {
    const s = await shop();
    const id = (await buy(s, s.buyerA)).body.id as string;
    await call('PUT', `/v1/seller/listings/${s.listingId}`, { token: s.seller, body: { title: 'Renamed kurta', category: 'Ethnic wear', price: rupees(900), media: [{ mediaId: s.photoId }], variants: [{ id: s.variantId, label: 'M', stock: 5 }], bargaining: { mode: 'BOTH', expiryMinutes: 1440 }, checkout: { channel: 'DIRECT' }, publish: true } });
    expect((await buyerOrder(s.buyerA, id)).body).toMatchObject({ listing: { title: 'Cotton kurta', variantLabel: 'M' }, price: rupees(1500) });
  });
});
