import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { notifications, orders } from '../src/db/schema.js';
import { makeCaller, type Caller } from './api.js';
import { insertOrder, makeBuyer, makeListing, makeShop, sellerIdOf, upload } from './community-helpers.js';
import { ManualClock, dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
let call: Caller;
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-reviews-'));
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir }, new ManualClock());
  call = makeCaller(app);
});
afterEach(async () => {
  await dbOf(app).db.execute(sql`truncate table users cascade`);
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const SELLER_PHONE = '9876502001';
const BUYER_PHONE = '9765402001';
async function setup(status: 'PLACED' | 'CONFIRMED' | 'CANCELLED' = 'CONFIRMED', confirmed?: boolean) {
  const seller = await makeShop(call, SELLER_PHONE, 'reviewshop', ['Ethnic wear'], { phone: '9000011111', whatsapp: '9000022222' });
  const buyer = await makeBuyer(call, BUYER_PHONE, 'Asha Rao', { phone: '9700033333', whatsapp: '9700044444' });
  const other = await makeBuyer(call, '9765402002', 'Ravi K');
  const l = await makeListing(call, seller);
  const order = await insertOrder(app, { buyerPhone: BUYER_PHONE, sellerPhone: SELLER_PHONE, listingId: l.id, variantId: l.variantId, status, ...(confirmed === undefined ? {} : { confirmed }) });
  return { seller, buyer, other, listing: l, order };
}
const put = (token: string, orderId: string, body: object) => call('PUT', `/v1/buyer/orders/${orderId}/review`, { token, body });

describe('who can review', () => {
  it('needs an order the seller has confirmed', async () => {
    const s = await setup('PLACED');
    const r = await put(s.buyer, s.order.id, { rating: 5, text: 'Great' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('NOT_CONFIRMED');
    await dbOf(app).db.update(orders).set({ status: 'CONFIRMED', confirmedAt: new Date() }).where(eq(orders.id, s.order.id));
    expect((await put(s.buyer, s.order.id, { rating: 5, text: 'Great' })).status).toBe(200);
  });

  it('only the buyer of the order; anyone else gets "not found"', async () => {
    const s = await setup();
    expect((await put(s.other, s.order.id, { rating: 5 })).status).toBe(404);
    expect((await call('PUT', `/v1/buyer/orders/${s.order.id}/review`, { token: s.seller, body: { rating: 5 } })).body.code).toBe('WRONG_APP');
    expect((await put(s.buyer, '33333333-3333-4333-8333-333333333333', { rating: 5 })).status).toBe(404);
  });

  it('a later cancellation does not take the right away', async () => {
    const s = await setup('CONFIRMED');
    await dbOf(app).db.update(orders).set({ status: 'CANCELLED' }).where(eq(orders.id, s.order.id));
    expect((await put(s.buyer, s.order.id, { rating: 4, text: 'Fine until cancelled' })).status).toBe(200);
  });

  it('a cancelled order that was never confirmed cannot be reviewed', async () => {
    const s = await setup('CANCELLED', false);
    expect((await put(s.buyer, s.order.id, { rating: 1, text: 'Never confirmed at all' })).body.code).toBe('NOT_CONFIRMED');
  });
});

describe('review rules', () => {
  it('stars are 1 to 5; 2 or fewer need a reason of 10 characters', async () => {
    const s = await setup();
    expect((await put(s.buyer, s.order.id, { rating: 0 })).status).toBe(400);
    expect((await put(s.buyer, s.order.id, { rating: 6 })).status).toBe(400);
    const low = await put(s.buyer, s.order.id, { rating: 2, text: 'too short' });
    expect(low.status).toBe(400);
    expect(low.body.fields.text).toBeTruthy();
    expect((await put(s.buyer, s.order.id, { rating: 2 })).status).toBe(400);
    expect((await put(s.buyer, s.order.id, { rating: 3 })).status).toBe(200); // 3 needs no reason
    expect((await put(s.buyer, s.order.id, { rating: 1, text: 'Colour was wrong' })).status).toBe(200);
  });

  it('one review per order: saving again edits it and keeps the files unless new ones are sent', async () => {
    const s = await setup();
    const a = await upload(call, s.buyer, 'buyer', 'REVIEW');
    const v = await upload(call, s.buyer, 'buyer', 'REVIEW', { kind: 'video' });
    const first = await put(s.buyer, s.order.id, { rating: 5, text: 'Lovely', mediaIds: [a.id, v.id] });
    expect(first.status).toBe(200);
    expect(first.body.editedAt).toBeNull();
    expect(first.body.media.map((m: { kind: string }) => m.kind)).toEqual(['image', 'video']);
    const edit = await put(s.buyer, s.order.id, { rating: 4, text: 'Lovely, a bit loose' }); // no mediaIds: keep
    expect(edit.body.id).toBe(first.body.id);
    expect(edit.body.rating).toBe(4);
    expect(edit.body.editedAt).toBeGreaterThan(0);
    expect(edit.body.media).toHaveLength(2);
    expect((await put(s.buyer, s.order.id, { rating: 4, text: 'x', mediaIds: [] })).body.media).toHaveLength(0); // empty list clears
    const list = await call('GET', '/v1/seller/reviews', { token: s.seller });
    expect(list.body.items).toHaveLength(1);
  });

  it('two first reviews at the same moment make one', async () => {
    const s = await setup();
    const rs = await Promise.all([1, 2, 3].map((n) => put(s.buyer, s.order.id, { rating: 5, text: `Great ${n}` })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect((await call('GET', '/v1/seller/reviews', { token: s.seller })).body.items).toHaveLength(1);
  });

  it('files must be the buyer’s own finished review uploads, at most 4', async () => {
    const s = await setup();
    const own = await Promise.all([1, 2, 3, 4, 5].map(() => upload(call, s.buyer, 'buyer', 'REVIEW')));
    expect((await put(s.buyer, s.order.id, { rating: 5, mediaIds: own.map((m) => m.id) })).status).toBe(400); // 5 files
    const theirs = await upload(call, s.other, 'buyer', 'REVIEW');
    expect((await put(s.buyer, s.order.id, { rating: 5, mediaIds: [theirs.id] })).status).toBe(400);
    const chat = await upload(call, s.buyer, 'buyer', 'CHAT');
    expect((await put(s.buyer, s.order.id, { rating: 5, mediaIds: [chat.id] })).status).toBe(400); // wrong purpose
    expect((await put(s.buyer, s.order.id, { rating: 5, mediaIds: [own[0]!.id, own[0]!.id] })).status).toBe(400); // twice
    expect((await put(s.buyer, s.order.id, { rating: 5, mediaIds: own.slice(0, 4).map((m) => m.id) })).status).toBe(200);
  });

  it('tells the seller about a new review and about an edit', async () => {
    const s = await setup();
    await put(s.buyer, s.order.id, { rating: 5, text: 'Great' });
    await put(s.buyer, s.order.id, { rating: 4, text: 'Great, mostly' });
    const rows = await dbOf(app).db.select().from(notifications).where(eq(notifications.app, 'seller'));
    expect(rows.map((r) => r.code).sort()).toEqual(['REVIEW_POSTED', 'REVIEW_UPDATED']);
  });
});

describe('public reviews and ratings', () => {
  it('shows stars, first names and "Verified order" to anyone, with no contact numbers', async () => {
    const s = await setup();
    await put(s.buyer, s.order.id, { rating: 5, text: 'Great fit' });
    const sellerId = await sellerIdOf(app, SELLER_PHONE);
    const r = await call('GET', `/v1/shops/${sellerId}/reviews`); // no token
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ rating: 5, reviewCount: 1 });
    expect(r.body.items[0]).toMatchObject({ buyerName: 'Asha', rating: 5, text: 'Great fit', listingTitle: 'Cotton kurta', verified: true });
    const text = JSON.stringify(r.body) + JSON.stringify((await call('GET', '/v1/seller/reviews', { token: s.seller })).body);
    for (const n of ['9700033333', '9700044444', '9000011111', '9000022222', BUYER_PHONE, SELLER_PHONE, 'Rao']) expect(text).not.toContain(n);
    expect((await call('GET', '/v1/shops/44444444-4444-4444-8444-444444444444/reviews')).status).toBe(404);
  });

  it('puts the average rating on every listing, with the seller’s declared times and record, and never a phone number', async () => {
    const s = await setup();
    const second = await insertOrder(app, { buyerPhone: '9765402002', sellerPhone: SELLER_PHONE, listingId: s.listing.id, variantId: s.listing.variantId });
    await put(s.buyer, s.order.id, { rating: 5, text: 'Great' });
    await put(s.other, second.id, { rating: 4, text: 'Good' });
    const feed = await call('GET', '/v1/buyer/feed', { token: s.buyer });
    expect(feed.body.items[0].seller).toMatchObject({ rating: 4.5, reviewCount: 2 });
    const one = await call('GET', `/v1/buyer/listings/${s.listing.id}`, { token: s.buyer });
    expect(one.body.seller).toMatchObject({ rating: 4.5, reviewCount: 2, slaConfirmHours: 6, slaShipDays: 2, categories: ['Ethnic wear'] });
    expect(one.body.seller.record).toMatchObject({ orders: 2, rating: 4.5, reviewCount: 2 });
    const text = JSON.stringify(feed.body) + JSON.stringify(one.body);
    for (const n of ['9000011111', '9000022222', '9700033333', '9700044444', BUYER_PHONE, SELLER_PHONE]) expect(text).not.toContain(n);
  });

  it('a listing from a shop with no reviews says so with null, not zero stars', async () => {
    const s = await setup();
    const one = await call('GET', `/v1/buyer/listings/${s.listing.id}`, { token: s.buyer });
    expect(one.body.seller).toMatchObject({ rating: null, reviewCount: 0 });
  });
});
