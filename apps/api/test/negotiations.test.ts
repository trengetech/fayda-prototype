import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { negotiations, notifications, reservations } from '../src/db/schema.js';
import { NegotiationsService } from '../src/negotiations/negotiations.service.js';
import { SweepRunner } from '../src/scheduler/sweep-runner.js';
import { JPEG, makeCaller, makeSeller, signIn, uploadFile, type Caller, type Json } from './api.js';
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
  dir = mkdtempSync(join(tmpdir(), 'fayda-negotiations-'));
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

interface Shop {
  seller: string;
  sellerPhone: string;
  listingId: string;
  variantId: string;
  buyerA: string;
  buyerB: string;
}

let seq = 0;
/** A seller with one live listing (₹1,500, size M) and two buyers. Pass `over` to change the listing. */
async function shop(over: Record<string, unknown> = {}, stock = 1): Promise<Shop> {
  const n = ++seq;
  const sellerPhone = `98765${String(10000 + n).slice(-5)}`;
  const seller = await makeSeller(call, sellerPhone, `shop${n}x`);
  const m = (await uploadFile(call, seller, JPEG())).id as string;
  const l = await call('POST', '/v1/seller/listings', {
    token: seller,
    body: {
      title: 'Cotton kurta',
      category: 'Ethnic wear',
      price: rupees(1500),
      media: [{ mediaId: m }],
      variants: [{ label: 'M', stock }],
      bargaining: { mode: 'BOTH', expiryMinutes: 1440 },
      checkout: { channel: 'DIRECT' },
      publish: true,
      ...over,
    },
  });
  if (l.status !== 201) throw new Error(`listing failed: ${JSON.stringify(l.body)}`);
  return {
    seller,
    sellerPhone,
    listingId: l.body.id,
    variantId: l.body.variants[0].id,
    buyerA: await signIn(call, `97654${String(10000 + n).slice(-5)}`, 'buyer'),
    buyerB: await signIn(call, `96543${String(10000 + n).slice(-5)}`, 'buyer'),
  };
}

const offer = (s: Shop, who: string, amount: number, key?: string) =>
  call('POST', `/v1/buyer/listings/${s.listingId}/offers`, { token: who, body: { variantId: s.variantId, amount: rupees(amount) }, ...(key ? { headers: { 'idempotency-key': key } } : {}) });
const buyerGet = (who: string, id: string) => call('GET', `/v1/buyer/negotiations/${id}`, { token: who });
const sellerGet = (s: Shop, id: string) => call('GET', `/v1/seller/negotiations/${id}`, { token: s.seller });
const sellerDo = (s: Shop, id: string, action: 'accept' | 'counter' | 'decline', body: Json = {}) => call('POST', `/v1/seller/negotiations/${id}/${action}`, { token: s.seller, body });
const buyerDo = (who: string, id: string, action: 'accept' | 'counter' | 'decline' | 'withdraw', body: Json = {}) => call('POST', `/v1/buyer/negotiations/${id}/${action}`, { token: who, body });

describe('making an offer', () => {
  it('opens a negotiation the seller sees as waiting for a reply', async () => {
    const s = await shop();
    const r = await offer(s, s.buyerA, 1200);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'OPEN', statusLabel: 'Waiting for seller', canWithdraw: true, canRespond: false, offersLeft: 5 });
    expect(r.body.offers).toMatchObject([{ side: 'ME', amount: rupees(1200), status: 'PENDING' }]);
    expect(r.body.listing).toMatchObject({ title: 'Cotton kurta', variantLabel: 'M', price: rupees(1500) });

    const inbox = await call('GET', '/v1/seller/negotiations', { token: s.seller });
    expect(inbox.body.needsReply).toBe(1);
    expect(inbox.body.items[0]).toMatchObject({ needsReply: true, canCounter: true, counterBounds: { minExclusive: rupees(1200), maxExclusive: rupees(1500) }, buyerName: 'Buyer' });
  });

  it('sets the offer to expire after the listing’s own window', async () => {
    const s = await shop({ bargaining: { mode: 'BOTH', expiryMinutes: 30 } });
    const r = await offer(s, s.buyerA, 1200);
    expect(r.body.offers[0].expiresAt - r.body.offers[0].at).toBe(30 * MINUTE);
  });

  it('refuses offers that break the rules', async () => {
    const s = await shop();
    const bad = async (amount: number, code: string, status: number) => {
      const r = await offer(s, s.buyerA, amount);
      expect([r.status, r.body.code], `₹${amount}`).toEqual([status, code]);
    };
    await bad(100, 'BELOW_PLATFORM_FLOOR', 422); // under 10% of the price
    await bad(1500, 'AT_OR_ABOVE_LIST', 422);
    await bad(1800, 'AT_OR_ABOVE_LIST', 422);
    const paise = await call('POST', `/v1/buyer/listings/${s.listingId}/offers`, { token: s.buyerA, body: { variantId: s.variantId, amount: 120050 } });
    expect(paise.body.code).toBe('INVALID_AMOUNT');
    const noSize = await call('POST', `/v1/buyer/listings/${s.listingId}/offers`, { token: s.buyerA, body: { variantId: '00000000-0000-4000-8000-000000000000', amount: rupees(1000) } });
    expect(noSize.body.code).toBe('NO_VARIANT');
    expect((await call('POST', `/v1/buyer/listings/${s.listingId}/offers`, { token: s.buyerA, body: { variantId: s.variantId } })).status).toBe(400);
  });

  it('refuses offers on a Buy now only listing and on your own listing', async () => {
    const fixed = await shop({ bargaining: { mode: 'BUY_NOW', expiryMinutes: 1440 } });
    expect((await offer(fixed, fixed.buyerA, 1200)).body.code).toBe('FIXED_PRICE');
    const s = await shop();
    const me = await signIn(call, s.sellerPhone, 'buyer'); // the same phone number signs in to the buyer app too
    expect((await offer(s, me, 1200)).body.code).toBe('OWN_LISTING');
  });

  it('allows one open offer per size and three new negotiations a day on a listing', async () => {
    const s = await shop();
    const first = await offer(s, s.buyerA, 1000);
    expect((await offer(s, s.buyerA, 1100)).body.code).toBe('ALREADY_OPEN');
    await buyerDo(s.buyerA, first.body.id, 'withdraw');
    for (const amount of [1010, 1020]) {
      const r = await offer(s, s.buyerA, amount);
      expect(r.status).toBe(201);
      await buyerDo(s.buyerA, r.body.id, 'withdraw');
    }
    const fourth = await offer(s, s.buyerA, 1030);
    expect([fourth.status, fourth.body.code]).toEqual([429, 'DAILY_LIMIT']);
    // Another buyer is not affected.
    expect((await offer(s, s.buyerB, 1030)).status).toBe(201);
  });

  it('is safe to retry with the same Idempotency-Key', async () => {
    const s = await shop();
    const a = await offer(s, s.buyerA, 1200, 'retry-key-0001');
    const b = await offer(s, s.buyerA, 1200, 'retry-key-0001');
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body.id).toBe(a.body.id);
    expect((await call('GET', '/v1/buyer/negotiations', { token: s.buyerA })).body.items).toHaveLength(1);
    const other = await offer(s, s.buyerA, 1300, 'retry-key-0001');
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('bargaining by hand', () => {
  it('walks offer, counter, counter, accept, and holds one unit', async () => {
    const s = await shop();
    const o = await offer(s, s.buyerA, 1000);
    const id = o.body.id as string;

    // The seller must counter above the offer and below the list price.
    expect((await sellerDo(s, id, 'counter', { amount: rupees(900) })).body.code).toBe('ACCEPT_INSTEAD');
    expect((await sellerDo(s, id, 'counter', { amount: rupees(1500) })).body.code).toBe('AT_OR_ABOVE_LIST');
    const c1 = await sellerDo(s, id, 'counter', { amount: rupees(1400) });
    expect(c1.status).toBe(200);
    expect(c1.body).toMatchObject({ needsReply: false, status: 'OPEN' });

    let view = (await buyerGet(s.buyerA, id)).body;
    expect(view).toMatchObject({ statusLabel: 'Seller countered', canRespond: true, canCounter: true, counterBounds: { minExclusive: rupees(1000), maxExclusive: rupees(1400) } });
    // The buyer must go up, and stay below the seller's counter.
    expect((await buyerDo(s.buyerA, id, 'counter', { amount: rupees(950) })).body.code).toBe('MUST_INCREASE');
    expect((await buyerDo(s.buyerA, id, 'counter', { amount: rupees(1400) })).body.code).toBe('ACCEPT_INSTEAD');
    expect((await buyerDo(s.buyerA, id, 'counter', { amount: rupees(1200) })).status).toBe(200);
    // It is the seller's turn now, so the buyer cannot act again.
    expect((await buyerDo(s.buyerA, id, 'counter', { amount: rupees(1250) })).body.code).toBe('NOT_YOUR_TURN');

    expect((await sellerDo(s, id, 'counter', { amount: rupees(1400) })).body.code).toBe('MUST_DECREASE');
    expect((await sellerDo(s, id, 'counter', { amount: rupees(1300) })).status).toBe(200);
    const accepted = await buyerDo(s.buyerA, id, 'accept');
    expect(accepted.status).toBe(200);
    view = accepted.body;
    expect(view).toMatchObject({ status: 'AGREED', agreement: { price: rupees(1300) }, canRespond: false });
    expect(view.agreement.deadline - view.offers.at(-1).at).toBeGreaterThanOrEqual(12 * HOUR - 5000);

    const held = await dbOf(app).db.select().from(reservations);
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ variantId: s.variantId, status: 'ACTIVE' });
  });

  it('stops after six offers', async () => {
    const s = await shop();
    const id = (await offer(s, s.buyerA, 500)).body.id as string;
    const amounts: [string, number][] = [['s', 1400], ['b', 600], ['s', 1300], ['b', 700], ['s', 1200]];
    for (const [who, amount] of amounts) {
      const r = who === 's' ? await sellerDo(s, id, 'counter', { amount: rupees(amount) }) : await buyerDo(s.buyerA, id, 'counter', { amount: rupees(amount) });
      expect(r.status, `${who} ${amount}`).toBe(200);
    }
    const last = await buyerDo(s.buyerA, id, 'counter', { amount: rupees(800) });
    expect(last.body.code).toBe('TURN_LIMIT');
    expect((await buyerGet(s.buyerA, id)).body).toMatchObject({ canRespond: true, canCounter: false, offersLeft: 0 });
    expect((await buyerDo(s.buyerA, id, 'accept')).body.status).toBe('AGREED');
  });

  it('lets the seller accept or decline, and the buyer withdraw or decline a counter', async () => {
    const s = await shop({}, 5);
    const a = (await offer(s, s.buyerA, 1100)).body.id as string;
    const b = (await offer(s, s.buyerB, 1000)).body.id as string;
    expect((await sellerDo(s, a, 'accept')).body).toMatchObject({ status: 'AGREED', agreement: { price: rupees(1100), acceptedBy: 'SELLER' } });
    expect((await sellerDo(s, b, 'decline')).body).toMatchObject({ status: 'CLOSED', closeReason: 'DECLINED' });
    const closed = (await buyerGet(s.buyerB, b)).body;
    expect(closed).toMatchObject({ status: 'CLOSED', closeReason: 'DECLINED', closeText: 'Offer declined', canRespond: false });

    const c = (await offer(s, s.buyerB, 1000)).body.id as string;
    expect((await buyerDo(s.buyerB, c, 'withdraw')).body).toMatchObject({ status: 'CLOSED', closeReason: 'WITHDRAWN' });
    const d = (await offer(s, s.buyerB, 1010)).body.id as string;
    await sellerDo(s, d, 'counter', { amount: rupees(1400) });
    expect((await buyerDo(s.buyerB, d, 'decline')).body).toMatchObject({ status: 'CLOSED', closeReason: 'DECLINED' });
    expect((await buyerDo(s.buyerB, d, 'withdraw')).body.code).toBe('CANT_WITHDRAW');
  });

  it('keeps each negotiation private to its two people', async () => {
    const s = await shop();
    const id = (await offer(s, s.buyerA, 1000)).body.id as string;
    expect((await buyerGet(s.buyerB, id)).status).toBe(404);
    expect((await buyerDo(s.buyerB, id, 'withdraw')).status).toBe(404);
    const other = await makeSeller(call, '9876599001', 'otherseller');
    expect((await call('GET', `/v1/seller/negotiations/${id}`, { token: other })).status).toBe(404);
    expect((await call('POST', `/v1/seller/negotiations/${id}/accept`, { token: other, body: {} })).status).toBe(404);
    expect((await call('GET', `/v1/seller/negotiations/${id}`, { token: s.buyerA })).status).toBe(403); // a buyer token on a seller route
    expect((await call('GET', '/v1/buyer/negotiations', { token: s.seller })).status).toBe(403);
    expect((await call('GET', '/v1/buyer/negotiations', { token: s.buyerB })).body.items).toHaveLength(0);
  });
});

describe('the last unit', () => {
  it('goes to one buyer when two accept at the same moment', async () => {
    const s = await shop();
    const a = (await offer(s, s.buyerA, 1000)).body.id as string;
    const b = (await offer(s, s.buyerB, 1100)).body.id as string;
    await sellerDo(s, a, 'counter', { amount: rupees(1300) });
    await sellerDo(s, b, 'counter', { amount: rupees(1300) });
    const [ra, rb] = await Promise.all([buyerDo(s.buyerA, a, 'accept'), buyerDo(s.buyerB, b, 'accept')]);
    expect([ra.status, rb.status].sort()).toEqual([200, 409]);
    const rows = await dbOf(app).db.select().from(negotiations);
    expect(rows.map((r) => r.status).sort()).toEqual(['AGREED', 'CLOSED']);
    expect(rows.find((r) => r.status === 'CLOSED')?.closeReason).toBe('SOLD_OUT');
    expect(await dbOf(app).db.select().from(reservations)).toHaveLength(1);
  });

  it('closes the other open offers on that size once the unit is taken', async () => {
    const s = await shop();
    const a = (await offer(s, s.buyerA, 1000)).body.id as string;
    const b = (await offer(s, s.buyerB, 1100)).body.id as string;
    await sellerDo(s, a, 'accept');
    const other = (await buyerGet(s.buyerB, b)).body;
    expect(other).toMatchObject({ status: 'CLOSED', closeReason: 'SOLD_OUT', closeText: 'This size sold out' });
    expect((await sellerDo(s, b, 'accept')).status).toBe(409);
    expect((await offer(s, s.buyerB, 1200)).body.code).toBe('OUT_OF_STOCK');
  });

  it('lets two sellers’ accepts and a buyer’s counter race without breaking stock', async () => {
    const s = await shop({}, 2);
    const ids = [(await offer(s, s.buyerA, 1000)).body.id as string, (await offer(s, s.buyerB, 1000)).body.id as string];
    const third = await signIn(call, '9000011111', 'buyer');
    const c = (await offer(s, third, 1000)).body.id as string;
    const out = await Promise.all([sellerDo(s, ids[0]!, 'accept'), sellerDo(s, ids[1]!, 'accept'), sellerDo(s, c, 'accept')]);
    expect(out.filter((r) => r.status === 200)).toHaveLength(2);
    expect(await dbOf(app).db.select().from(reservations)).toHaveLength(2);
  });
});

describe('the seller’s private rules', () => {
  const rules = { autoAcceptAt: rupees(1200), autoCounterAt: rupees(1350), autoDeclineBelow: rupees(800) };

  it('accepts at once when the offer meets the lowest price, with nothing that says it was automatic', async () => {
    const s = await shop({ rules });
    const r = await offer(s, s.buyerA, 1250);
    expect(r.body).toMatchObject({ status: 'AGREED', agreement: { price: rupees(1250) } });
    expect(r.body.events.find((e: Json) => e.type === 'ACCEPTED')).toMatchObject({ actor: 'SELLER' });
    const seen = await sellerGet(s, r.body.id);
    expect(seen.body.agreement).toMatchObject({ acceptedBy: 'SYSTEM' });
    expect((await dbOf(app).db.select().from(reservations)).length).toBe(1);
  });

  it('counters 5 seconds after an offer below the lowest price, and looks like the seller’s own reply', async () => {
    const s = await shop({ rules });
    const o = await offer(s, s.buyerA, 1000);
    const id = o.body.id as string;
    await tick();
    expect((await buyerGet(s.buyerA, id)).body.offers).toHaveLength(1); // nothing yet: not due
    clock.advance(4 * SECOND);
    await tick();
    expect((await buyerGet(s.buyerA, id)).body.offers).toHaveLength(1);
    clock.advance(1100);
    expect(await tick()).toMatchObject({ negotiations: 1 });
    const view = (await buyerGet(s.buyerA, id)).body;
    expect(view.offers.map((x: Json) => [x.side, x.amount])).toEqual([['ME', rupees(1000)], ['SELLER', rupees(1350)]]);
    expect(view).toMatchObject({ statusLabel: 'Seller countered', canRespond: true });
    // The seller sees that their rule replied.
    const seen = await sellerGet(s, id);
    expect(seen.body.offers.map((x: Json) => x.by)).toEqual(['BUYER', 'SYSTEM']);
  });

  it('fires a due counter when someone looks, even if the sweep has not run', async () => {
    const s = await shop({ rules });
    const id = (await offer(s, s.buyerA, 1000)).body.id as string;
    clock.advance(6 * SECOND);
    expect((await buyerGet(s.buyerA, id)).body.offers).toHaveLength(2);
  });

  it('does the same when the buyer counters back, until six offers are used', async () => {
    const s = await shop({ rules });
    const id = (await offer(s, s.buyerA, 1000)).body.id as string;
    clock.advance(6 * SECOND);
    await tick();
    expect((await buyerDo(s.buyerA, id, 'counter', { amount: rupees(1100) })).status).toBe(200);
    clock.advance(6 * SECOND);
    await tick();
    const view = (await buyerGet(s.buyerA, id)).body;
    expect(view.offers.map((x: Json) => x.amount)).toEqual([rupees(1000), rupees(1350), rupees(1100), rupees(1350)]);
    // At or above the lowest price, the next counter is accepted automatically.
    const done = await buyerDo(s.buyerA, id, 'counter', { amount: rupees(1200) });
    expect(done.body).toMatchObject({ status: 'AGREED', agreement: { price: rupees(1200) } });
  });

  it('declines two minutes after an offer far below the floor, and the buyer sees an ordinary decline', async () => {
    const s = await shop({ rules });
    const id = (await offer(s, s.buyerA, 700)).body.id as string;
    clock.advance(119 * SECOND);
    await tick();
    expect((await buyerGet(s.buyerA, id)).body.status).toBe('OPEN');
    clock.advance(2 * SECOND);
    await tick();
    const view = (await buyerGet(s.buyerA, id)).body;
    expect(view).toMatchObject({ status: 'CLOSED', closeReason: 'DECLINED', closeText: 'Offer declined' });
    expect(JSON.stringify(view)).not.toMatch(/AUTO|SYSTEM/i);
    expect((await sellerGet(s, id)).body.closeReason).toBe('AUTO_DECLINED');
  });

  it('only fires an automatic step once when two sweeps run at the same moment', async () => {
    const s = await shop({ rules });
    const id = (await offer(s, s.buyerA, 1000)).body.id as string;
    clock.advance(6 * SECOND);
    const svc = app.get(NegotiationsService);
    const runs = await Promise.all([svc.run(clock.now()), svc.run(clock.now()), svc.run(clock.now())]);
    expect(runs.reduce((a, b) => a + b, 0)).toBe(1);
    expect((await sellerGet(s, id)).body.offers).toHaveLength(2);
  });

  it('never reaches the buyer, in any payload, even with rules, codes and payment details set', async () => {
    const s = await shop({
      rules: { autoAcceptAt: rupees(1111), autoCounterAt: rupees(1333), autoDeclineBelow: rupees(777) },
      checkout: { channel: 'WEBSITE', productUrl: 'https://shop.example/p' },
      dealCodes: { accept: { type: 'CODE', value: 'SECRETCODE1' }, counter: { type: 'CODE', value: 'SECRETCODE2' } },
    });
    const first = await offer(s, s.buyerA, 1000);
    const id = first.body.id as string;
    clock.advance(6 * SECOND);
    await tick();
    const second = await offer(s, s.buyerB, 600); // far below: waiting for an automatic decline
    const payloads = [first.body, (await buyerGet(s.buyerA, id)).body, (await call('GET', '/v1/buyer/negotiations', { token: s.buyerA })).body, second.body, (await buyerGet(s.buyerB, second.body.id)).body];
    for (const p of payloads) {
      const text = JSON.stringify(p);
      for (const secret of ['SECRETCODE', 'autoAccept', 'autoDecline', 'autoCounter', 'AUTO_', 'SYSTEM', '"rules"', '"dealCodes"', '111100', '77700', 'upi', 'sana@']) {
        expect(text, secret).not.toContain(secret);
      }
    }
    // The ₹1,333 counter is the seller's visible reply, so it may appear; the rule that produced it may not (checked above).
    // The pending automatic counter's code is not visible before an agreement.
    expect(JSON.stringify(payloads[1])).not.toContain('dealAccess":{"type"');
    const seller = JSON.stringify((await sellerGet(s, id)).body);
    expect(seller).toContain('SECRETCODE2'); // the seller does see their own code, so the checks above are not vacuous
  });
});

describe('time limits', () => {
  it('lets an offer lapse after the listing’s window (30 minutes) and tells both sides', async () => {
    const s = await shop({ bargaining: { mode: 'BOTH', expiryMinutes: 30 } });
    const id = (await offer(s, s.buyerA, 1000)).body.id as string;
    clock.advance(29 * MINUTE);
    await tick();
    expect(await dbOf(app).db.select().from(negotiations).then((r) => r[0]!.status)).toBe('OPEN');
    clock.advance(2 * MINUTE);
    await tick();
    const buyer = await signIn(call, '97654' + String(10000 + seq).slice(-5), 'buyer'); // tokens last 15 minutes
    const view = (await buyerGet(buyer, id)).body;
    expect(view).toMatchObject({ status: 'CLOSED', closeReason: 'EXPIRED', closeText: 'Offer expired' });
    const codes = (await dbOf(app).db.select().from(notifications)).map((n) => `${n.app}:${n.code}`).sort();
    expect(codes).toEqual(['buyer:OFFER_EXPIRED', 'seller:NEW_OFFER', 'seller:OFFER_EXPIRED']);
  });

  it('lapses an agreement after 12 hours and frees the unit', async () => {
    const s = await shop();
    const id = (await offer(s, s.buyerA, 1000)).body.id as string;
    await sellerDo(s, id, 'accept');
    expect((await offer(s, s.buyerB, 1100)).body.code).toBe('OUT_OF_STOCK');
    clock.advance(11 * HOUR);
    await tick();
    expect((await dbOf(app).db.select().from(negotiations))[0]!.status).toBe('AGREED');
    clock.advance(90 * MINUTE);
    await tick();
    expect((await dbOf(app).db.select().from(negotiations))[0]).toMatchObject({ status: 'LAPSED', closeReason: 'LAPSED' });
    const buyerB = await signIn(call, '96543' + String(10000 + seq).slice(-5), 'buyer');
    expect((await offer(s, buyerB, 1100)).status).toBe(201);
    expect((await dbOf(app).db.select().from(reservations)).map((r) => r.status)).toEqual(['RELEASED']);
  });
});

describe('when the listing changes', () => {
  const edit = async (s: Shop, over: Record<string, unknown>) => {
    const cur = await call('GET', `/v1/seller/listings/${s.listingId}`, { token: s.seller });
    const l = cur.body;
    const r = await call('PUT', `/v1/seller/listings/${s.listingId}`, {
      token: s.seller,
      body: {
        title: l.title,
        category: l.category,
        price: l.price,
        media: l.media.map((m: Json) => ({ mediaId: m.mediaId })),
        variants: l.variants,
        bargaining: l.bargaining,
        checkout: l.checkout,
        publish: false,
        ...over,
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return r.body;
  };

  it('closes open offers when the listing is paused', async () => {
    const s = await shop({}, 3);
    const id = (await offer(s, s.buyerA, 1000)).body.id as string;
    await call('POST', `/v1/seller/listings/${s.listingId}/status`, { token: s.seller, body: { status: 'PAUSED' } });
    expect((await buyerGet(s.buyerA, id)).body).toMatchObject({ status: 'CLOSED', closeReason: 'LISTING_PAUSED' });
    expect((await offer(s, s.buyerB, 1000)).body.code).toBe('NOT_AVAILABLE');
  });

  it('closes offers the new price makes pointless, and keeps the ones still below it', async () => {
    const s = await shop({}, 3);
    const high = (await offer(s, s.buyerA, 1200)).body.id as string;
    const low = (await offer(s, s.buyerB, 800)).body.id as string;
    await edit(s, { price: rupees(1000) });
    expect((await buyerGet(s.buyerA, high)).body).toMatchObject({ status: 'CLOSED', closeReason: 'PRICE_DROPPED' });
    expect((await buyerGet(s.buyerB, low)).body.status).toBe('OPEN');
  });

  it('closes offers when the seller switches to Buy now only', async () => {
    const s = await shop({}, 3);
    const id = (await offer(s, s.buyerA, 1000)).body.id as string;
    const saved = await edit(s, { bargaining: { mode: 'BUY_NOW', expiryMinutes: 1440 } });
    expect(saved.rules).toEqual({ autoAcceptAt: null, autoDeclineBelow: null, autoCounterAt: null });
    expect((await buyerGet(s.buyerA, id)).body).toMatchObject({ status: 'CLOSED', closeReason: 'FIXED_PRICE' });
  });

  it('closes offers on a size that is removed or whose stock goes to zero', async () => {
    const s = await shop({ variants: [{ label: 'M', stock: 3 }, { label: 'L', stock: 3 }] }, 3);
    const cur = (await call('GET', `/v1/seller/listings/${s.listingId}`, { token: s.seller })).body;
    const [m, l] = cur.variants as { id: string; label: string }[];
    const onM = (await call('POST', `/v1/buyer/listings/${s.listingId}/offers`, { token: s.buyerA, body: { variantId: m!.id, amount: rupees(1000) } })).body.id as string;
    const onL = (await call('POST', `/v1/buyer/listings/${s.listingId}/offers`, { token: s.buyerB, body: { variantId: l!.id, amount: rupees(1000) } })).body.id as string;
    await edit(s, { variants: [{ id: m!.id, label: 'M', stock: 0 }, { id: l!.id, label: 'L', stock: 3 }] });
    expect((await buyerGet(s.buyerA, onM)).body).toMatchObject({ status: 'CLOSED', closeReason: 'SOLD_OUT' });
    expect((await buyerGet(s.buyerB, onL)).body.status).toBe('OPEN');
    await edit(s, { variants: [{ id: m!.id, label: 'M', stock: 1 }] });
    expect((await buyerGet(s.buyerB, onL)).body).toMatchObject({ status: 'CLOSED', closeReason: 'SOLD_OUT' });
  });

  it('keeps open offers when only the offer window changes', async () => {
    const s = await shop({}, 3);
    const id = (await offer(s, s.buyerA, 1000)).body.id as string;
    await edit(s, { bargaining: { mode: 'BOTH', expiryMinutes: 30 } });
    const view = (await buyerGet(s.buyerA, id)).body;
    expect(view.status).toBe('OPEN');
    expect(view.offers[0].expiresAt - view.offers[0].at).toBe(1440 * MINUTE);
  });
});

describe('website listings', () => {
  const site = { checkout: { channel: 'WEBSITE', productUrl: 'https://shop.example/p' } };

  it('needs the seller’s code or link to accept or counter, and shows it to the buyer only once agreed', async () => {
    const s = await shop(site, 2);
    const id = (await offer(s, s.buyerA, 1000)).body.id as string;
    const noCode = await sellerDo(s, id, 'accept');
    expect([noCode.status, noCode.body.code]).toEqual([400, 'DEAL_ACCESS_REQUIRED']);
    expect(noCode.body.fields.dealAccess).toBeTruthy();
    expect((await sellerDo(s, id, 'counter', { amount: rupees(1300) })).body.code).toBe('DEAL_ACCESS_REQUIRED');

    await sellerDo(s, id, 'counter', { amount: rupees(1300), dealAccess: { type: 'CODE', value: 'KURTA13' } });
    const pending = (await buyerGet(s.buyerA, id)).body;
    expect(pending.agreement).toBeNull();
    expect(JSON.stringify(pending)).not.toContain('KURTA13');
    const agreed = await buyerDo(s.buyerA, id, 'accept');
    expect(agreed.body.agreement).toMatchObject({ price: rupees(1300), dealAccess: { type: 'CODE', value: 'KURTA13' } });
  });

  it('settles an automatic accept at the code’s price, not the higher offer (B-6)', async () => {
    const s = await shop({ ...site, rules: { autoAcceptAt: rupees(1200) }, dealCodes: { accept: { type: 'CODE', value: 'AUTO12' } } }, 2);
    const r = await offer(s, s.buyerA, 1400);
    expect(r.body.agreement).toMatchObject({ price: rupees(1200), dealAccess: { type: 'CODE', value: 'AUTO12' } });
  });
});
