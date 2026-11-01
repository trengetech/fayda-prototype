import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { follows } from '../src/db/schema.js';
import { makeCaller, type Caller, type Json } from './api.js';
import { makeBuyer, makeListing, makeShop, rupees, sellerIdOf, upload, userId } from './community-helpers.js';
import { dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
let call: Caller;
let dir: string;

// Two shops, five listings, three buyers: enough to search, filter, sort, page and follow.
let anita: string; // seller token, shop "anitaethnic"
let ravi: string; // seller token, shop "raviwear"
let asha: string; // buyers
let kiran: string;
let meena: string;
let anitaId: string;
let raviId: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-discovery-'));
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir });
  call = makeCaller(app);
  anita = await makeShop(call, '9876502001', 'anitaethnic', ['Ethnic wear']);
  ravi = await makeShop(call, '9876502002', 'raviwear', ['Menswear', 'Western wear']);
  asha = await makeBuyer(call, '9765402001');
  kiran = await makeBuyer(call, '9765402002', 'Kiran P');
  meena = await makeBuyer(call, '9765402003', 'Meena S');
  anitaId = await sellerIdOf(app, '9876502001');
  raviId = await sellerIdOf(app, '9876502002');

  // anita: a kurta with a video, a saree (fixed price), a dupatta
  const video = await upload(call, anita, 'seller', 'LISTING', { kind: 'video' });
  const poster = await upload(call, anita, 'seller', 'LISTING');
  const photo = await upload(call, anita, 'seller', 'LISTING');
  await call('POST', '/v1/seller/listings', {
    token: anita,
    body: {
      title: 'Cotton kurta', description: 'Soft summer fabric', category: 'Ethnic wear', tags: ['Cotton', '#Summer wear', 'cotton'], price: rupees(1500),
      media: [{ mediaId: video.id, posterMediaId: poster.id }, { mediaId: photo.id }], variants: [{ label: 'M', stock: 3 }, { label: 'L', stock: 0 }],
      bargaining: { mode: 'BOTH', expiryMinutes: 1440 }, checkout: { channel: 'DIRECT' }, publish: true,
    },
  }).then((r) => { if (r.status !== 201) throw new Error(JSON.stringify(r.body)); });
  await makeListing(call, anita, { title: 'Banarasi saree', description: 'Wedding silk, 100% pure', category: 'Ethnic wear', tags: ['silk', 'wedding'], price: rupees(5000), variants: [{ label: 'Free size', stock: 2 }], bargaining: { mode: 'BUY_NOW', expiryMinutes: 1440 } });
  await makeListing(call, anita, { title: 'Dupatta', category: 'Ethnic wear', tags: [], price: rupees(400), variants: [{ label: 'M', stock: 1 }] });
  // ravi: a shirt and sneakers
  await makeListing(call, ravi, { title: 'Linen shirt', category: 'Menswear', tags: ['linen', 'summer wear'], price: rupees(900), variants: [{ label: 'L', stock: 4 }, { label: 'XL', stock: 2 }] });
  await makeListing(call, ravi, { title: 'Canvas sneakers', category: 'Footwear', tags: ['casual'], price: rupees(2200), variants: [{ label: '9', stock: 2 }], bargaining: { mode: 'BUY_NOW', expiryMinutes: 1440 } });
});
afterAll(async () => {
  await dbOf(app).db.execute(sql`truncate table users cascade`);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

// These tests are about filters, paging and newest-first order, so they ask for NEWEST. The default order (BEST, I-39) is tested in search-ranking.test.ts.
const feed = async (token: string, qs = ''): Promise<Json> => (await call('GET', `/v1/buyer/feed${qs.includes('sort=') ? qs : `${qs}${qs ? '&' : '?'}sort=NEWEST`}`, { token })).body;
const titles = (b: Json): string[] => b.items.map((i: Json) => i.title);

describe('feed: search, filters and sort', () => {
  it('lists every live listing newest first, with the first video for a reel', async () => {
    const b = await feed(asha);
    expect(titles(b)).toEqual(['Canvas sneakers', 'Linen shirt', 'Dupatta', 'Banarasi saree', 'Cotton kurta']);
    const kurta = b.items.find((i: Json) => i.title === 'Cotton kurta');
    expect(kurta.hasVideo).toBe(true);
    expect(kurta.video.url).toMatch(/^\/v1\/media\//);
    expect(kurta.video.posterUrl).toMatch(/^\/v1\/media\//);
    expect(kurta.ownShop).toBe(false);
    expect(b.items.find((i: Json) => i.title === 'Dupatta').video).toBeNull();
    expect(b.items.every((i: Json) => i.following === false)).toBe(true);
    // buyer payloads carry no private rules, tags-as-rules or codes
    expect(JSON.stringify(b)).not.toMatch(/autoAccept|autoDecline|autoCounter|dealCodes|dealAccept|upiId/i);
  });

  it('search matches title, category, tags, description and shop name, and every word must match', async () => {
    expect(titles(await feed(asha, '?q=kurta'))).toEqual(['Cotton kurta']);
    expect(titles(await feed(asha, '?q=footwear'))).toEqual(['Canvas sneakers']); // category
    expect(titles(await feed(asha, '?q=wedding'))).toEqual(['Banarasi saree']); // tag and description
    expect(titles(await feed(asha, '?q=summer'))).toEqual(['Linen shirt', 'Cotton kurta']); // tags, two shops
    expect(titles(await feed(asha, '?q=%23Summer'))).toEqual(['Linen shirt', 'Cotton kurta']); // "#Summer"
    expect(titles(await feed(asha, '?q=raviwear'))).toEqual(['Canvas sneakers', 'Linen shirt']); // shop handle
    expect(titles(await feed(asha, '?q=anita'))).toHaveLength(3); // shop name
    expect(titles(await feed(asha, '?q=summer+cotton'))).toEqual(['Cotton kurta']); // AND
    expect(titles(await feed(asha, '?q=summer+sneakers'))).toEqual([]);
    expect(titles(await feed(asha, '?q=KURTA'))).toEqual(['Cotton kurta']); // case
  });

  it('a wildcard in the search is plain text, and one letter or blanks mean no search', async () => {
    expect(titles(await feed(asha, '?q=%25%25'))).toEqual([]); // "%%" would match everything if unescaped
    expect(titles(await feed(asha, '?q=_____'))).toEqual([]);
    expect(titles(await feed(asha, '?q=100%25'))).toEqual(['Banarasi saree']); // "100%" is in its description
    expect(await feed(asha, '?q=k').then((b) => b.items.length)).toBe(5); // one letter is ignored
    expect(await feed(asha, '?q=%20%20').then((b) => b.items.length)).toBe(5);
  });

  it('filters by category, price range, size in stock, and offers', async () => {
    expect(titles(await feed(asha, '?category=Menswear'))).toEqual(['Linen shirt']);
    expect(titles(await feed(asha, `?minPrice=${rupees(1000)}&maxPrice=${rupees(2200)}`))).toEqual(['Canvas sneakers', 'Cotton kurta']);
    expect(titles(await feed(asha, '?size=m'))).toEqual(['Dupatta', 'Cotton kurta']); // case-insensitive; the dupatta's last unit counts
    expect(titles(await feed(asha, '?size=L'))).toEqual(['Linen shirt']); // the kurta's L has no stock
    expect(titles(await feed(asha, '?acceptsOffers=true'))).toEqual(['Linen shirt', 'Dupatta', 'Cotton kurta']);
    expect(titles(await feed(asha, '?category=Ethnic+wear&acceptsOffers=true&q=cotton'))).toEqual(['Cotton kurta']); // combined
  });

  it('refuses bad filters with a message per field', async () => {
    for (const [qs, field] of [['?category=Toys', 'category'], [`?minPrice=9000&maxPrice=100`, 'maxPrice']] as const) {
      const r = await call('GET', `/v1/buyer/feed${qs}`, { token: asha });
      expect(r.status).toBe(400);
      expect(r.body.fields[field]).toBeTruthy();
    }
    expect((await call('GET', '/v1/buyer/feed?scope=EVERYONE', { token: asha })).status).toBe(400);
    expect((await call('GET', '/v1/buyer/feed?sort=RANDOM', { token: asha })).status).toBe(400);
  });

  it('sorts by price and pages with a cursor that only fits its own sort', async () => {
    const seen: string[] = [];
    let cursor = '';
    for (let i = 0; i < 5; i++) {
      const b = await feed(asha, `?sort=PRICE_LOW&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...titles(b));
      if (!b.nextCursor) break;
      cursor = b.nextCursor;
    }
    expect(seen).toEqual(['Dupatta', 'Linen shirt', 'Cotton kurta', 'Canvas sneakers', 'Banarasi saree']);
    expect(titles(await feed(asha, '?sort=PRICE_HIGH&limit=2'))).toEqual(['Banarasi saree', 'Canvas sneakers']);
    const first = await feed(asha, '?sort=PRICE_LOW&limit=1');
    expect((await call('GET', `/v1/buyer/feed?sort=NEWEST&cursor=${first.nextCursor}`, { token: asha })).status).toBe(400);
    // two listings with the same price still page without a repeat or a gap
    await makeListing(call, ravi, { title: 'Twin A', price: rupees(900), variants: [{ label: 'S', stock: 1 }] });
    await makeListing(call, ravi, { title: 'Twin B', price: rupees(900), variants: [{ label: 'S', stock: 1 }] });
    const all: string[] = [];
    cursor = '';
    for (let i = 0; i < 8; i++) {
      const b = await feed(asha, `?sort=PRICE_LOW&limit=1${cursor ? `&cursor=${cursor}` : ''}`);
      all.push(...titles(b));
      if (!b.nextCursor) break;
      cursor = b.nextCursor;
    }
    expect(all).toHaveLength(7);
    expect(new Set(all).size).toBe(7);
  });

  it('facets list the categories, in-stock sizes and price span', async () => {
    const r = await call('GET', '/v1/buyer/feed/facets', { token: asha });
    expect(r.status).toBe(200);
    expect(r.body.categories).toContain('Ethnic wear');
    expect(r.body.sizes).toEqual(expect.arrayContaining(['m', 'l', 'xl', '9']));
    expect(r.body.sizes).toContain('free size');
    expect(r.body.minPrice).toBeLessThanOrEqual(rupees(400));
    expect(r.body.maxPrice).toBeGreaterThanOrEqual(rupees(5000));
  });
});

describe('tags on a listing', () => {
  it('are cleaned and shown to buyers; omitting them keeps them; bad tags are refused', async () => {
    const list = await call('GET', '/v1/seller/listings', { token: anita });
    const kurta = list.body.items.find((i: Json) => i.title === 'Cotton kurta');
    expect(kurta.tags).toEqual(['cotton', 'summer wear']); // lower case, "#" dropped, duplicate dropped
    const buyerView = await call('GET', `/v1/buyer/listings/${kurta.id}`, { token: asha });
    expect(buyerView.body.tags).toEqual(['cotton', 'summer wear']);

    const body = (extra: Json) => ({ title: kurta.title, category: kurta.category, price: kurta.price, media: kurta.media.map((m: Json) => ({ mediaId: m.mediaId, posterMediaId: m.posterMediaId })), variants: kurta.variants.map((v: Json) => ({ id: v.id, label: v.label, stock: v.stock })), bargaining: kurta.bargaining, checkout: { channel: 'DIRECT' }, publish: true, ...extra });
    const keep = await call('PUT', `/v1/seller/listings/${kurta.id}`, { token: anita, body: body({}) });
    expect(keep.status).toBe(200);
    expect(keep.body.tags).toEqual(['cotton', 'summer wear']);
    const cleared = await call('PUT', `/v1/seller/listings/${kurta.id}`, { token: anita, body: body({ tags: [] }) });
    expect(cleared.body.tags).toEqual([]);
    expect((await call('PUT', `/v1/seller/listings/${kurta.id}`, { token: anita, body: body({ tags: ['cotton', 'summer wear'] }) })).body.tags).toEqual(['cotton', 'summer wear']);
    const bad = await call('PUT', `/v1/seller/listings/${kurta.id}`, { token: anita, body: body({ tags: ['ok', 'no!'] }) });
    expect(bad.status).toBe(400);
    expect(bad.body.fields.tags).toBeTruthy();
    const many = await call('PUT', `/v1/seller/listings/${kurta.id}`, { token: anita, body: body({ tags: Array.from({ length: 9 }, (_, i) => `tag${i}`) }) });
    expect(many.body.fields.tags).toMatch(/Up to 8/);
  });
});

describe('follows', () => {
  it('follow and unfollow are repeatable, and count followers', async () => {
    const f1 = await call('PUT', `/v1/buyer/follows/sellers/${anitaId}`, { token: kiran });
    expect(f1.body).toEqual({ following: true, followerCount: 1 });
    expect((await call('PUT', `/v1/buyer/follows/sellers/${anitaId}`, { token: kiran })).body).toEqual({ following: true, followerCount: 1 });
    expect((await call('PUT', `/v1/buyer/follows/sellers/${anitaId}`, { token: meena })).body.followerCount).toBe(2);
    expect((await call('DELETE', `/v1/buyer/follows/sellers/${anitaId}`, { token: meena })).body).toEqual({ following: false, followerCount: 1 });
    expect((await call('DELETE', `/v1/buyer/follows/sellers/${anitaId}`, { token: meena })).body).toEqual({ following: false, followerCount: 1 });
  });

  it('eight taps at once make one follow', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => call('PUT', `/v1/buyer/follows/sellers/${raviId}`, { token: asha })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect((await call('GET', `/v1/buyer/shops/raviwear`, { token: asha })).body.followerCount).toBe(1);
  });

  it('refuses your own shop, an unknown shop, the wrong app and no sign-in', async () => {
    // the same phone number is one user in both apps (M3.1): the seller opens the buyer app and tries their own shop
    const ownBuyer = await makeBuyer(call, '9876502001', 'Anita D');
    const own = await call('PUT', `/v1/buyer/follows/sellers/${anitaId}`, { token: ownBuyer });
    expect(own.status).toBe(422);
    expect(own.body.code).toBe('OWN_SHOP');
    // and the feed says which cards are the person's own shop, so the app can hide Follow
    expect((await feed(ownBuyer)).items.filter((i: Json) => i.ownShop).map((i: Json) => i.seller.handle)).toEqual(['anitaethnic', 'anitaethnic', 'anitaethnic']);
    expect((await call('PUT', '/v1/buyer/follows/sellers/11111111-1111-4111-8111-111111111111', { token: asha })).status).toBe(404);
    expect((await call('PUT', `/v1/buyer/follows/sellers/${anitaId}`, { token: anita })).body.code).toBe('WRONG_APP');
    expect((await call('PUT', `/v1/buyer/follows/sellers/${anitaId}`)).status).toBe(401);
    expect((await call('PUT', '/v1/buyer/follows/sellers/not-a-uuid', { token: asha })).status).toBe(400);
  });

  it('stops at the cap, and unfollowing makes room', async () => {
    const who = await makeBuyer(call, '9765402099', 'Cap Buyer');
    const uid = await userId(app, '9765402099');
    await dbOf(app).db.execute(sql`insert into follows (follower_user_id, target_type, target_id, created_at) select ${uid}::uuid, 'SELLER', gen_random_uuid(), now() from generate_series(1, 1000)`);
    const over = await call('PUT', `/v1/buyer/follows/sellers/${anitaId}`, { token: who });
    expect(over.status).toBe(409);
    expect(over.body.code).toBe('FOLLOW_LIMIT');
    // following a shop you already follow is not blocked by the cap
    await dbOf(app).db.execute(sql`update follows set target_id = ${anitaId}::uuid where id = (select id from follows where follower_user_id = ${uid}::uuid limit 1)`);
    expect((await call('PUT', `/v1/buyer/follows/sellers/${anitaId}`, { token: who })).status).toBe(200);
  });

  it('two follows racing for the last place at the cap: exactly one gets it', async () => {
    const who = await makeBuyer(call, '9765402098', 'Race Buyer');
    const uid = await userId(app, '9765402098');
    await dbOf(app).db.execute(sql`insert into follows (follower_user_id, target_type, target_id, created_at) select ${uid}::uuid, 'SELLER', gen_random_uuid(), now() from generate_series(1, 999)`);
    const [a, b] = await Promise.all([call('PUT', `/v1/buyer/follows/sellers/${anitaId}`, { token: who }), call('PUT', `/v1/buyer/follows/sellers/${raviId}`, { token: who })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [total] = await dbOf(app).db.select({ n: sql<number>`count(*)::int` }).from(follows).where(sql`${follows.followerUserId} = ${uid}::uuid`);
    expect(total?.n).toBe(1000);
  });

  it('Following shows only followed shops, and the card says so; the list pages newest first', async () => {
    // kiran follows anita (above); asha follows ravi (above)
    expect(titles(await feed(kiran, '?scope=FOLLOWING'))).toEqual(['Dupatta', 'Banarasi saree', 'Cotton kurta']);
    expect(titles(await feed(asha, '?scope=FOLLOWING'))).toEqual(['Twin B', 'Twin A', 'Canvas sneakers', 'Linen shirt']);
    expect(await feed(meena, '?scope=FOLLOWING').then((b) => b.items)).toEqual([]);
    const forYou = await feed(kiran);
    expect(forYou.items.filter((i: Json) => i.following).map((i: Json) => i.seller.handle)).toEqual(['anitaethnic', 'anitaethnic', 'anitaethnic']);
    expect(titles(await feed(kiran, '?scope=FOLLOWING&q=saree'))).toEqual(['Banarasi saree']); // search inside Following
    // list of followed shops
    await call('PUT', `/v1/buyer/follows/sellers/${raviId}`, { token: kiran });
    const page1 = await call('GET', '/v1/buyer/follows?limit=1', { token: kiran });
    expect(page1.body.items.map((i: Json) => i.handle)).toEqual(['raviwear']);
    const page2 = await call('GET', `/v1/buyer/follows?limit=1&cursor=${page1.body.nextCursor}`, { token: kiran });
    expect(page2.body.items.map((i: Json) => i.handle)).toEqual(['anitaethnic']);
    expect(page2.body.nextCursor).toBeNull();
    // one buyer's follows are not another's
    expect((await call('GET', '/v1/buyer/follows', { token: meena })).body.items).toEqual([]);
  });
});

describe('shop pages', () => {
  it('show the public profile and record, never contact numbers or payment details', async () => {
    const r = await call('GET', '/v1/buyer/shops/AnitaEthnic', { token: kiran }); // handle, any case
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: anitaId, handle: 'anitaethnic', name: 'Shop anitaethnic', listingCount: 3, following: true, isOwn: false, categories: ['Ethnic wear'] });
    expect(r.body.record).toMatchObject({ orders: 0, rating: null });
    const text = JSON.stringify(r.body);
    expect(text).not.toMatch(/9000099998|9876502001|upi|okaxis|contact/i);
    expect((await call('GET', '/v1/buyer/shops/raviwear', { token: kiran })).body.following).toBe(true);
    expect((await call('GET', '/v1/buyer/shops/anitaethnic', { token: meena })).body.following).toBe(false);
    expect((await call('GET', '/v1/buyer/shops/nosuchshop', { token: kiran })).status).toBe(404);
    expect((await call('GET', '/v1/buyer/shops/anitaethnic')).status).toBe(401);
  });

  it('list only that shop’s live listings, with search and sort, and ignore the Following scope', async () => {
    const ravis = titles((await call('GET', '/v1/buyer/shops/raviwear/listings?sort=PRICE_LOW', { token: meena })).body);
    expect(ravis).toHaveLength(4);
    expect(ravis.at(-1)).toBe('Canvas sneakers'); // dearest last
    expect(ravis).not.toContain('Dupatta');
    const mine = await call('GET', '/v1/buyer/shops/anitaethnic/listings?scope=FOLLOWING', { token: meena }); // meena follows nobody
    expect(titles(mine.body)).toEqual(['Dupatta', 'Banarasi saree', 'Cotton kurta']);
    expect(titles((await call('GET', '/v1/buyer/shops/anitaethnic/listings?q=saree', { token: meena })).body)).toEqual(['Banarasi saree']);
    expect((await call('GET', '/v1/buyer/shops/nosuchshop/listings', { token: meena })).status).toBe(404);
  });

  it('do not show a paused listing, in the feed or on the shop', async () => {
    const list = await call('GET', '/v1/seller/listings', { token: anita });
    const dupatta = list.body.items.find((i: Json) => i.title === 'Dupatta');
    await call('POST', `/v1/seller/listings/${dupatta.id}/status`, { token: anita, body: { status: 'PAUSED' } });
    expect(titles(await feed(meena, '?q=dupatta'))).toEqual([]);
    expect((await call('GET', '/v1/buyer/shops/anitaethnic', { token: meena })).body.listingCount).toBe(2);
  });
});
