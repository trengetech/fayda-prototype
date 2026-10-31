import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { listings } from '../src/db/schema.js';
import { JPEG, MP4, PNG, makeCaller, makeSeller, shopInput, signIn, uploadFile, type Caller, type Json } from './api.js';
import { dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
let call: Caller;
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-listings-'));
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '1000', UPLOADS_DIR: dir });
  call = makeCaller(app);
});
afterEach(async () => {
  await dbOf(app).db.execute(sql`truncate table users cascade`);
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const rupees = (n: number) => n * 100;
/** A valid listing. Prices are in paise (₹1,500 = 150000). */
const body = (mediaIds: string[], over: Record<string, unknown> = {}) => ({
  title: 'Cotton kurta',
  description: 'Hand block printed',
  category: 'Ethnic wear',
  price: rupees(1500),
  media: mediaIds.map((mediaId) => ({ mediaId })),
  variants: [{ label: 'M', stock: 3 }, { label: 'L', stock: 2 }],
  bargaining: { mode: 'FIXED', expiryHours: 24 },
  checkout: { channel: 'DIRECT' },
  publish: false,
  ...over,
});
const photo = async (token: string) => (await uploadFile(call, token, JPEG())).id as string;

describe('saving listings', () => {
  it('saves a draft, keeps size ids when edited, and drops sizes that were removed', async () => {
    const t = await makeSeller(call, '9876500201');
    const m = await photo(t);
    const created = await call('POST', '/v1/seller/listings', { token: t, body: body([m]) });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'DRAFT', title: 'Cotton kurta', price: 150000, publishedAt: null });
    const [medium, large] = created.body.variants;
    expect(created.body.media[0]).toMatchObject({ mediaId: m, kind: 'image', url: `/v1/media/${m}` });

    const edited = await call('PUT', `/v1/seller/listings/${created.body.id}`, {
      token: t,
      body: body([m], { title: 'Cotton kurta v2', variants: [{ id: medium.id, label: 'M', stock: 9 }, { label: 'XL', stock: 1 }] }),
    });
    expect(edited.status).toBe(200);
    expect(edited.body.title).toBe('Cotton kurta v2');
    expect(edited.body.variants.map((v: Json) => v.label)).toEqual(['M', 'XL']);
    expect(edited.body.variants[0]).toMatchObject({ id: medium.id, stock: 9 });
    expect(edited.body.variants.some((v: Json) => v.id === large.id)).toBe(false);
  });

  it('checks every field with the prototype rules and reports them by name', async () => {
    const t = await makeSeller(call, '9876500202');
    const m = await photo(t);
    const bad = await call('POST', '/v1/seller/listings', {
      token: t,
      body: body([m], { title: 'x', category: 'Toys', price: 12345, variants: [], bargaining: { mode: 'HAGGLE', expiryHours: 1 } }),
    });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.fields).sort()).toEqual(['category', 'expiryHours', 'mode', 'price', 'title', 'variants']);
    const noMedia = await call('POST', '/v1/seller/listings', { token: t, body: body([]) });
    expect(noMedia.body.fields.media).toMatch(/at least one/);
  });

  it('applies the private-rule order: decline < accept <= counter < price', async () => {
    const t = await makeSeller(call, '9876500203');
    const m = await photo(t);
    const rules = { autoAcceptAt: rupees(1200), autoCounterAt: rupees(1100), autoDeclineBelow: rupees(1300) };
    const r = await call('POST', '/v1/seller/listings', { token: t, body: body([m], { bargaining: { mode: 'PRIVATE', expiryHours: 24 }, rules }) });
    expect(r.body.fields.autoDeclineBelow).toMatch(/lower than your lowest/);
    expect(r.body.fields.autoCounterAt).toMatch(/at or above your lowest/);
    const ok = await call('POST', '/v1/seller/listings', { token: t, body: body([m], { bargaining: { mode: 'PRIVATE', expiryHours: 24 }, rules: { autoAcceptAt: rupees(1100), autoCounterAt: rupees(1300), autoDeclineBelow: rupees(800) } }) });
    expect(ok.status).toBe(201);
    expect(ok.body.rules).toEqual({ autoAcceptAt: rupees(1100), autoCounterAt: rupees(1300), autoDeclineBelow: rupees(800) });
    // A fixed-price listing keeps no private rules even if the app sends some.
    const fixed = await call('POST', '/v1/seller/listings', { token: t, body: body([m], { rules: { autoAcceptAt: rupees(1100) } }) });
    expect(fixed.body.rules).toEqual({ autoAcceptAt: null, autoDeclineBelow: null, autoCounterAt: null });
  });

  it('publishes only with stock, and lists it for buyers only while live', async () => {
    const t = await makeSeller(call, '9876500204');
    const buyer = await signIn(call, '9876500299', 'buyer');
    const m = await photo(t);
    const noStock = await call('POST', '/v1/seller/listings', { token: t, body: body([m], { publish: true, variants: [{ label: 'M', stock: 0 }] }) });
    expect(noStock.body.fields.variants).toMatch(/Add stock/);
    const draft = await call('POST', '/v1/seller/listings', { token: t, body: body([m]) });
    expect((await call('GET', '/v1/buyer/feed', { token: buyer })).body.items).toHaveLength(0);
    expect((await call('GET', `/v1/buyer/listings/${draft.body.id}`, { token: buyer })).status).toBe(404);

    const live = await call('PUT', `/v1/seller/listings/${draft.body.id}`, { token: t, body: body([m], { publish: true }) });
    expect(live.body.status).toBe('ACTIVE');
    expect(live.body.publishedAt).toBeGreaterThan(0);
    expect((await call('GET', '/v1/buyer/feed', { token: buyer })).body.items).toHaveLength(1);

    const paused = await call('POST', `/v1/seller/listings/${draft.body.id}/status`, { token: t, body: { status: 'PAUSED' } });
    expect(paused.body.status).toBe('PAUSED');
    expect((await call('GET', '/v1/buyer/feed', { token: buyer })).body.items).toHaveLength(0);
    // A plain save of a paused listing keeps it paused; resuming is explicit.
    expect((await call('PUT', `/v1/seller/listings/${draft.body.id}`, { token: t, body: body([m]) })).body.status).toBe('PAUSED');
    expect((await call('POST', `/v1/seller/listings/${draft.body.id}/status`, { token: t, body: { status: 'ACTIVE' } })).body.status).toBe('ACTIVE');
  });

  it('will not resume a listing with no stock, or "resume" a draft', async () => {
    const t = await makeSeller(call, '9876500205');
    const m = await photo(t);
    const l = await call('POST', '/v1/seller/listings', { token: t, body: body([m], { publish: true }) });
    await call('PUT', `/v1/seller/listings/${l.body.id}`, { token: t, body: body([m], { variants: [{ id: l.body.variants[0].id, label: 'M', stock: 0 }] }) });
    await call('POST', `/v1/seller/listings/${l.body.id}/status`, { token: t, body: { status: 'PAUSED' } });
    expect((await call('POST', `/v1/seller/listings/${l.body.id}/status`, { token: t, body: { status: 'ACTIVE' } })).body.code).toBe('NO_STOCK');
    const draft = await call('POST', '/v1/seller/listings', { token: t, body: body([m]) });
    expect((await call('POST', `/v1/seller/listings/${draft.body.id}/status`, { token: t, body: { status: 'ACTIVE' } })).body.code).toBe('INVALID_STATE');
  });

  it('deletes drafts only', async () => {
    const t = await makeSeller(call, '9876500206');
    const m = await photo(t);
    const draft = await call('POST', '/v1/seller/listings', { token: t, body: body([m]) });
    const live = await call('POST', '/v1/seller/listings', { token: t, body: body([m], { publish: true }) });
    expect((await call('DELETE', `/v1/seller/listings/${live.body.id}`, { token: t })).body.code).toBe('NOT_DRAFT');
    expect((await call('DELETE', `/v1/seller/listings/${draft.body.id}`, { token: t })).status).toBe(204);
    expect((await call('GET', `/v1/seller/listings/${draft.body.id}`, { token: t })).status).toBe(404);
  });
});

describe('who can touch what', () => {
  it('keeps each seller to their own listings, and each app to its own routes', async () => {
    const a = await makeSeller(call, '9876500207');
    const b = await makeSeller(call, '9876500208', 'otherstudio', 'other@okaxis');
    const buyer = await signIn(call, '9876500209', 'buyer');
    const m = await photo(a);
    const mb = await photo(b);
    const l = await call('POST', '/v1/seller/listings', { token: a, body: body([m]) });
    for (const [method, url] of [['GET', `/v1/seller/listings/${l.body.id}`], ['DELETE', `/v1/seller/listings/${l.body.id}`]] as const)
      expect((await call(method, url, { token: b })).status).toBe(404);
    expect((await call('PUT', `/v1/seller/listings/${l.body.id}`, { token: b, body: body([mb]) })).status).toBe(404);
    expect((await call('POST', `/v1/seller/listings/${l.body.id}/status`, { token: b, body: { status: 'PAUSED' } })).status).toBe(404);
    expect((await call('GET', '/v1/seller/listings', { token: b })).body.items).toHaveLength(0);
    expect((await call('GET', '/v1/seller/listings', { token: buyer })).body.code).toBe('WRONG_APP');
    expect((await call('GET', '/v1/buyer/feed', { token: a })).body.code).toBe('WRONG_APP');
    expect((await call('GET', '/v1/buyer/feed')).status).toBe(401);
    const noShop = await signIn(call, '9876500210', 'seller');
    expect((await call('POST', '/v1/seller/listings', { token: noShop, body: body([m]) })).body.code).toBe('NO_SELLER');
  });
});

describe('media on a listing', () => {
  it('accepts only the seller’s own finished listing files', async () => {
    const a = await makeSeller(call, '9876500211');
    const b = await makeSeller(call, '9876500212', 'otherstudio', 'other@okaxis');
    const mine = await photo(a);
    const theirs = await photo(b);
    const qr = (await uploadFile(call, a, PNG(), { purpose: 'UPI_QR', mime: 'image/png' })).id as string;
    const pending = (await call('POST', '/v1/seller/media/intents', { token: a, body: { kind: 'image', purpose: 'LISTING', mime: 'image/jpeg', size: 100 } })).body.mediaId as string;
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const bad of [theirs, qr, pending, unknown]) {
      const r = await call('POST', '/v1/seller/listings', { token: a, body: body([mine, bad]) });
      expect(r.status, `media ${bad}`).toBeGreaterThanOrEqual(400);
      expect(r.body.fields?.media ?? r.body.code).toBeDefined();
    }
    expect((await call('POST', '/v1/seller/listings', { token: a, body: body([mine, mine]) })).body.fields.media).toMatch(/once/);
    const many = await Promise.all(Array.from({ length: 7 }, () => photo(a)));
    expect((await call('POST', '/v1/seller/listings', { token: a, body: body(many) })).body.fields.media).toMatch(/Up to 6/);
  });

  it('needs a cover photo for each video, and uses it in the feed', async () => {
    const t = await makeSeller(call, '9876500213');
    const buyer = await signIn(call, '9876500298', 'buyer');
    const video = (await uploadFile(call, t, MP4(), { kind: 'video' })).id as string;
    const poster = await photo(t);
    const noPoster = await call('POST', '/v1/seller/listings', { token: t, body: body([video]) });
    expect(noPoster.body.fields.media).toMatch(/cover photo/);
    const ok = await call('POST', '/v1/seller/listings', { token: t, body: { ...body([video], { publish: true }), media: [{ mediaId: video, posterMediaId: poster }] } });
    expect(ok.status).toBe(201);
    expect(ok.body.media[0]).toMatchObject({ kind: 'video', posterMediaId: poster, posterUrl: `/v1/media/${poster}` });
    const feed = await call('GET', '/v1/buyer/feed', { token: buyer });
    expect(feed.body.items[0]).toMatchObject({ coverUrl: `/v1/media/${poster}`, hasVideo: true });
  });

  it('keeps files attached to a listing when housekeeping runs', async () => {
    const t = await makeSeller(call, '9876500214');
    const m = await photo(t);
    await call('POST', '/v1/seller/listings', { token: t, body: body([m]) });
    const { MediaService } = await import('../src/media/media.service.js');
    const service = app.get(MediaService);
    (service as unknown as { lastPurge: number }).lastPurge = 0;
    expect(await service.run(Date.now() + 48 * 3_600_000)).toBe(0);
    expect((await call('GET', `/v1/media/${m}`)).status).toBe(200);
  });
});

describe('where buyers complete the purchase', () => {
  it('needs a payment method for direct sales and a link for website sales', async () => {
    const t = await signIn(call, '9876500215', 'seller');
    await call('PUT', '/v1/seller/profile', { token: t, body: shopInput }); // shop but no payment details yet
    const m = await photo(t);
    expect((await call('POST', '/v1/seller/listings', { token: t, body: body([m]) })).body.fields.channel).toMatch(/Add a UPI ID/);
    const web = await call('POST', '/v1/seller/listings', { token: t, body: body([m], { checkout: { channel: 'WEBSITE', productUrl: 'http://shop.example/p' } }) });
    expect(web.body.fields.productUrl).toMatch(/https/);
    const okWeb = await call('POST', '/v1/seller/listings', { token: t, body: body([m], { checkout: { channel: 'WEBSITE', productUrl: 'https://shop.example/p' } }) });
    expect(okWeb.status).toBe(201);
    expect(okWeb.body.checkout).toEqual({ channel: 'WEBSITE', productUrl: 'https://shop.example/p' });
  });

  it('asks for a code or link for each automatic price on a website listing, and stores them privately', async () => {
    const t = await makeSeller(call, '9876500216');
    const m = await photo(t);
    const site = { channel: 'WEBSITE', productUrl: 'https://shop.example/p' };
    const mode = { mode: 'PRIVATE', expiryHours: 24 };
    const rules = { autoAcceptAt: rupees(1200), autoCounterAt: rupees(1300) };
    const missing = await call('POST', '/v1/seller/listings', { token: t, body: body([m], { checkout: site, bargaining: mode, rules }) });
    expect(Object.keys(missing.body.fields).sort()).toEqual(['acceptCode', 'counterCode']);
    const ok = await call('POST', '/v1/seller/listings', {
      token: t,
      body: body([m], { checkout: site, bargaining: mode, rules, dealCodes: { accept: { type: 'CODE', value: 'FAYDA12' }, counter: { type: 'LINK', value: 'https://shop.example/p?c=1' } } }),
    });
    expect(ok.body.dealCodes).toEqual({ accept: { type: 'CODE', value: 'FAYDA12' }, counter: { type: 'LINK', value: 'https://shop.example/p?c=1' } });
  });
});

describe('what buyers can see', () => {
  it('never includes private rules, deal codes, or payment details', async () => {
    const t = await makeSeller(call, '9876500217', 'sanastudio', 'secretupi@okaxis');
    const buyer = await signIn(call, '9876500297', 'buyer');
    const m = await photo(t);
    const l = await call('POST', '/v1/seller/listings', {
      token: t,
      body: body([m], {
        publish: true,
        bargaining: { mode: 'BOTH', expiryHours: 24 },
        rules: { autoAcceptAt: rupees(1111), autoCounterAt: rupees(1333), autoDeclineBelow: rupees(777) },
        checkout: { channel: 'WEBSITE', productUrl: 'https://shop.example/p' },
        dealCodes: { accept: { type: 'CODE', value: 'SECRETCODE1' }, counter: { type: 'CODE', value: 'SECRETCODE2' } },
      }),
    });
    expect(l.status).toBe(201);
    // Sanity: the seller's own view does carry them, so the checks below are not vacuous.
    expect(JSON.stringify(l.body)).toContain('SECRETCODE1');
    expect(l.body.rules.autoAcceptAt).toBe(rupees(1111));

    const feed = await call('GET', '/v1/buyer/feed', { token: buyer });
    const detail = await call('GET', `/v1/buyer/listings/${l.body.id}`, { token: buyer });
    expect(detail.status).toBe(200);
    for (const payload of [feed.body, detail.body]) {
      const text = JSON.stringify(payload);
      for (const secret of ['SECRETCODE', 'secretupi', 'autoAccept', 'autoDecline', 'autoCounter', 'dealCodes', '"rules"', '111100', '133300', '77700', 'upi']) expect(text, secret).not.toContain(secret);
    }
    expect(detail.body.bargaining).toEqual({ mode: 'BOTH', acceptsOffers: true, expiryHours: 24 });
    expect(detail.body.checkout).toEqual({ channel: 'WEBSITE', productUrl: 'https://shop.example/p' });
    expect(detail.body.variants.map((v: Json) => Object.keys(v).sort())).toEqual([['available', 'id', 'label', 'low'], ['available', 'id', 'label', 'low']]);
    expect(detail.body.seller).toMatchObject({ name: 'Sana Studio', handle: 'sanastudio' });
  });

  it('pages through the feed newest first without repeats, and refuses a bad page marker', async () => {
    const t = await makeSeller(call, '9876500218');
    const buyer = await signIn(call, '9876500296', 'buyer');
    const m = await photo(t);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const r = await call('POST', '/v1/seller/listings', { token: t, body: body([m], { publish: true, title: `Kurta ${i}` }) });
      ids.push(r.body.id);
      // Spread the publish times so the order is well defined.
      await dbOf(app).db.update(listings).set({ publishedAt: new Date(Date.now() - (5 - i) * 60_000) }).where(eq(listings.id, r.body.id));
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: { body: Json } = await call('GET', `/v1/buyer/feed?limit=2${cursor ? `&cursor=${cursor}` : ''}`, { token: buyer });
      seen.push(...r.body.items.map((x: Json) => x.id));
      cursor = r.body.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(seen).toEqual([...ids].reverse());
    expect((await call('GET', '/v1/buyer/feed?cursor=nonsense', { token: buyer })).status).toBe(400);
    expect((await call('GET', '/v1/buyer/feed?limit=500', { token: buyer })).status).toBe(400);
  });

  it('marks a listing sold out when no unit is left', async () => {
    const t = await makeSeller(call, '9876500219');
    const buyer = await signIn(call, '9876500295', 'buyer');
    const m = await photo(t);
    const l = await call('POST', '/v1/seller/listings', { token: t, body: body([m], { publish: true }) });
    await call('PUT', `/v1/seller/listings/${l.body.id}`, { token: t, body: body([m], { variants: l.body.variants.map((v: Json) => ({ id: v.id, label: v.label, stock: 0 })) }) });
    const detail = await call('GET', `/v1/buyer/listings/${l.body.id}`, { token: buyer });
    expect(detail.body.soldOut).toBe(true);
    expect(detail.body.variants.every((v: Json) => v.available === false)).toBe(true);
    expect((await call('GET', '/v1/buyer/feed', { token: buyer })).body.items[0].soldOut).toBe(true);
  });
});

describe('retrying a write', () => {
  it('returns the first answer for the same Idempotency-Key and creates one listing', async () => {
    const t = await makeSeller(call, '9876500220');
    const m = await photo(t);
    const headers = { 'idempotency-key': 'create-kurta-0001' };
    const first = await call('POST', '/v1/seller/listings', { token: t, body: body([m]), headers });
    const again = await call('POST', '/v1/seller/listings', { token: t, body: body([m]), headers });
    expect(first.status).toBe(201);
    expect(again.status).toBe(201);
    expect(again.body.id).toBe(first.body.id);
    expect((await call('GET', '/v1/seller/listings', { token: t })).body.items).toHaveLength(1);
    const reused = await call('POST', '/v1/seller/listings', { token: t, body: body([m], { title: 'Different' }), headers });
    expect(reused.status).toBe(422);
    expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await call('POST', '/v1/seller/listings', { token: t, body: body([m]), headers: { 'idempotency-key': 'short' } })).status).toBe(400);
  });

  it('lets a failed attempt be retried with the same key', async () => {
    const t = await makeSeller(call, '9876500221');
    const m = await photo(t);
    const headers = { 'idempotency-key': 'retry-after-error-1' };
    expect((await call('POST', '/v1/seller/listings', { token: t, body: body([m], { title: 'x' }), headers })).status).toBe(400);
    // A different body would be refused, but the first attempt failed, so the key was freed for the same request.
    expect((await call('POST', '/v1/seller/listings', { token: t, body: body([m], { title: 'x' }), headers })).status).toBe(400);
    expect((await call('POST', '/v1/seller/listings', { token: t, body: body([m]), headers })).status).toBe(201);
  });
});
