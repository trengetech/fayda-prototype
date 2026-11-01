import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeCaller, signIn, type Caller, type Json } from './api.js';
import { insertOrder, makeBuyer, makeListing, makeShop } from './community-helpers.js';
import { ManualClock, dbOf, startApp } from './helpers.js';

// Per-listing numbers: the seller sees views, likes, saves, comments, offers, orders and conversion; buyers see only the public ones.
let app: NestFastifyApplication;
let call: Caller;
let dir: string;
let clock: ManualClock;
let anita: string;
let asha: string;
let kiran: string;
let kurta: { id: string; variantId: string };
let shirt: { id: string; variantId: string };
const DAY = 86_400_000;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-lnum-'));
  clock = new ManualClock();
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir }, clock);
  call = makeCaller(app);
  anita = await makeShop(call, '9876508001', 'anitanum', ['Ethnic wear']);
  asha = await makeBuyer(call, '9765408001', 'Asha Rao');
  kiran = await makeBuyer(call, '9765408002', 'Kiran Patel');
  kurta = await makeListing(call, anita, { title: 'Numbers kurta' });
  shirt = await makeListing(call, anita, { title: 'Quiet shirt' });
  await makeListing(call, anita, { title: 'Draft one', publish: false });
  // activity on the kurta
  for (const t of [asha, kiran]) await call('POST', `/v1/buyer/listings/${kurta.id}/view`, { token: t });
  await call('PUT', `/v1/buyer/listings/${kurta.id}/like`, { token: asha, body: {} });
  await call('PUT', `/v1/buyer/listings/${kurta.id}/save`, { token: asha, body: {} });
  await call('PUT', `/v1/buyer/listings/${kurta.id}/save`, { token: kiran, body: {} });
  await call('POST', `/v1/buyer/listings/${kurta.id}/comments`, { token: asha, body: { text: 'Is it cotton?' } });
  await call('POST', `/v1/seller/listings/${kurta.id}/comments`, { token: anita, body: { text: 'Yes, pure cotton.' } }); // the shop's own reply: not counted
  expect((await call('POST', `/v1/buyer/listings/${kurta.id}/offers`, { token: asha, body: { variantId: kurta.variantId, amount: 120000 } })).status).toBe(201);
  await insertOrder(app, { buyerPhone: '9765408002', sellerPhone: '9876508001', listingId: kurta.id, variantId: kurta.variantId });
});
afterAll(async () => {
  await dbOf(app).db.execute(sql`truncate table users cascade`);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const rows = async (): Promise<Record<string, Json>> => {
  const r = await call('GET', '/v1/seller/dashboard', { token: anita });
  expect(r.status).toBe(200);
  return Object.fromEntries((r.body.listings as Json[]).map((l) => [l.title, l]));
};

describe('seller: numbers per listing', () => {
  it('shows each live or paused listing with its own counts and a conversion rate; drafts are left out', async () => {
    const r = await rows();
    expect(Object.keys(r).sort()).toEqual(['Numbers kurta', 'Quiet shirt']);
    expect(r['Numbers kurta']!.last30).toEqual({ views: 2, likes: 1, saves: 2, comments: 1, offers: 1, orders: 1, conversionPct: 50 });
    expect(r['Numbers kurta']!.last7).toEqual(r['Numbers kurta']!.last30);
    expect(r['Quiet shirt']!.last30).toEqual({ views: 0, likes: 0, saves: 0, comments: 0, offers: 0, orders: 0, conversionPct: null });
    expect(r['Numbers kurta']!.status).toBe('ACTIVE');
  });

  it('puts the busiest first, and keeps a paused listing', async () => {
    await call('POST', `/v1/seller/listings/${shirt.id}/status`, { token: anita, body: { status: 'PAUSED' } });
    const r = await call('GET', '/v1/seller/dashboard', { token: anita });
    expect(r.body.listings.map((l: Json) => l.title)).toEqual(['Numbers kurta', 'Quiet shirt']);
    expect(r.body.listings[1].status).toBe('PAUSED');
  });

  it('is only the seller’s own shop: another seller sees none of it', async () => {
    const other = await makeShop(call, '9876508002', 'othernum', ['Menswear']);
    const r = await call('GET', '/v1/seller/dashboard', { token: other });
    expect(r.body.listings).toEqual([]);
    expect(JSON.stringify(r.body)).not.toMatch(/Numbers kurta/);
  });

  it('the 7 day column forgets what is older than 7 days while the 30 day column keeps it', async () => {
    clock.advance(10 * DAY);
    anita = await signIn(call, '9876508001', 'seller');
    const k = (await rows())['Numbers kurta']!;
    expect(k.last7).toEqual({ views: 0, likes: 0, saves: 0, comments: 0, offers: 0, orders: 0, conversionPct: null });
    expect(k.last30.views).toBe(2);
    expect(k.last30.conversionPct).toBe(50);
  });
});

describe('buyer: only the public numbers', () => {
  it('the product page shows likes, comments and views, and never saves, offers, orders or conversion', async () => {
    clock.advance(-10 * DAY); // back to when the activity happened
    kiran = await signIn(call, '9765408002', 'buyer');
    const r = await call('GET', `/v1/buyer/listings/${kurta.id}`, { token: kiran });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ likeCount: 1, commentCount: 2, viewCount: 2 });
    expect(JSON.stringify(r.body)).not.toMatch(/saveCount/); // a save is private (I-28)
    expect(Object.keys(r.body)).not.toContain('offers');
    // The shop's public order record (seller.record.orders) is meant for buyers; everything else must carry no offer, order or conversion number.
    const { seller, ...rest } = r.body as Json;
    expect(seller.record.orders).toBe(1);
    expect(JSON.stringify(rest)).not.toMatch(/"(offers|offerCount|orders|orderCount|conversion\w*)"/);
    const feed = await call('GET', '/v1/buyer/feed?q=Numbers', { token: kiran });
    const items = (feed.body.items as Json[]).map(({ seller: _s, ...i }) => i);
    expect(items).toHaveLength(1);
    expect(JSON.stringify(items)).not.toMatch(/"(offers|offerCount|orders|orderCount|conversion\w*)"/);
  });

  it('views on the product page are the last 30 days only', async () => {
    clock.advance(35 * DAY);
    kiran = await signIn(call, '9765408002', 'buyer');
    expect((await call('GET', `/v1/buyer/listings/${kurta.id}`, { token: kiran })).body.viewCount).toBe(0);
  });
});
