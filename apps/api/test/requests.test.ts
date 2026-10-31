import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buyerRequests, chatMessages, chatThreads, notifications, requestResponses } from '../src/db/schema.js';
import { ChatService } from '../src/chat/chat.service.js';
import { SweepRunner } from '../src/scheduler/sweep-runner.js';
import { makeCaller, signIn, type Caller, type Json } from './api.js';
import { makeBuyer, makeShop, sellerIdOf, upload } from './community-helpers.js';
import { ManualClock, dbOf, startApp } from './helpers.js';

const DAY = 24 * 3600_000;
let app: NestFastifyApplication;
let call: Caller;
let dir: string;
let clock: ManualClock;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-requests-'));
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

/** Two ethnic-wear shops, one footwear shop, the buyer, and a second buyer who also runs an ethnic-wear shop. */
async function setup() {
  const a = await makeShop(call, '9876503001', 'shopa', ['Ethnic wear']);
  const b = await makeShop(call, '9876503002', 'shopb', ['Ethnic wear', 'Western wear']);
  const c = await makeShop(call, '9876503003', 'shopc', ['Footwear']);
  const buyer = await makeBuyer(call, '9765403001', 'Asha Rao');
  const stranger = await makeBuyer(call, '9765403002', 'Ravi K');
  return { a, b, c, buyer, stranger };
}
const mkRequest = async (buyer: string, over: Json = {}) => {
  const photo = await upload(call, buyer, 'buyer', 'REQUEST');
  return call('POST', '/v1/buyer/requests', { token: buyer, body: { category: 'Ethnic wear', title: 'Green silk saree', description: 'For a wedding', size: 'Free', budget: 500000, mediaIds: [photo.id], ...over } });
};
const respond = async (seller: string, requestId: string, over: Json = {}) => {
  const photo = await upload(call, seller, 'seller', 'REQUEST');
  return call('POST', `/v1/seller/requests/${requestId}/responses`, { token: seller, body: { text: 'I have this', price: 450000, mediaIds: [photo.id], ...over } });
};
const tick = () => app.get(SweepRunner).tick();

describe('posting a request', () => {
  it('tells the sellers in that category, not other categories, and not the buyer’s own shop', async () => {
    const s = await setup();
    const own = await makeShop(call, '9765403001', 'ownshop', ['Ethnic wear']); // the buyer's own shop (same phone)
    expect(own).toBeTruthy();
    expect((await call('GET', '/v1/buyer/requests/reach?category=Ethnic%20wear', { token: s.buyer })).body.count).toBe(2); // a, b — not the buyer's own, not c
    expect((await call('GET', '/v1/buyer/requests/reach?category=Footwear', { token: s.buyer })).body.count).toBe(1);
    expect((await call('GET', '/v1/buyer/requests/reach', { token: s.buyer })).status).toBe(400);
    const r = await mkRequest(s.buyer);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'OPEN', reachedCount: 2, title: 'Green silk saree', budget: 500000, responses: [] });
    expect(r.body.media).toHaveLength(1);
    const rows = await dbOf(app).db.select().from(notifications).where(eq(notifications.code, 'NEW_REQUEST'));
    expect(rows).toHaveLength(2);
    expect((await call('GET', '/v1/seller/requests', { token: s.a })).body.newCount).toBe(1);
    expect((await call('GET', '/v1/seller/requests', { token: s.c })).body.items).toHaveLength(0);
    expect((await call('GET', '/v1/seller/requests', { token: own })).body.items).toHaveLength(0); // never their own request
    expect(r.body.expiresAt - r.body.createdAt).toBe(7 * DAY);
  });

  it('needs a photo of your own, a category and a title', async () => {
    const s = await setup();
    expect((await call('POST', '/v1/buyer/requests', { token: s.buyer, body: { category: 'Ethnic wear', title: 'Saree', mediaIds: [] } })).body.fields.media).toBeTruthy();
    expect((await mkRequest(s.buyer, { category: 'Nope' })).body.fields.category).toBeTruthy();
    expect((await mkRequest(s.buyer, { title: 'ab' })).body.fields.title).toBeTruthy();
    expect((await mkRequest(s.buyer, { budget: 12345 })).body.fields.budget).toBeTruthy(); // whole rupees only
    const theirs = await upload(call, s.stranger, 'buyer', 'REQUEST');
    expect((await mkRequest(s.buyer, { mediaIds: [theirs.id] })).status).toBe(400);
    const wrongPurpose = await upload(call, s.buyer, 'buyer', 'CHAT');
    expect((await mkRequest(s.buyer, { mediaIds: [wrongPurpose.id] })).status).toBe(400);
    expect((await call('POST', '/v1/buyer/requests', { token: s.a, body: {} })).body.code).toBe('WRONG_APP');
  });

  it('only the buyer sees the request with its responses', async () => {
    const s = await setup();
    const r = await mkRequest(s.buyer);
    expect((await call('GET', `/v1/buyer/requests/${r.body.id}`, { token: s.stranger })).status).toBe(404);
    expect((await call('GET', '/v1/buyer/requests', { token: s.stranger })).body.items).toHaveLength(0);
    expect((await call('POST', `/v1/buyer/requests/${r.body.id}/close`, { token: s.stranger })).status).toBe(404);
  });
});

describe('responses', () => {
  it('one response per seller, only in their categories, with a photo', async () => {
    const s = await setup();
    const r = await mkRequest(s.buyer);
    const id = r.body.id;
    expect((await respond(s.c, id)).body.code).toBe('NOT_IN_CATEGORY');
    expect((await call('POST', `/v1/seller/requests/${id}/responses`, { token: s.a, body: { text: 'x', mediaIds: [] } })).body.fields.media).toBeTruthy();
    const ok = await respond(s.a, id);
    expect(ok.status).toBe(201);
    expect(ok.body.response).toMatchObject({ status: 'SENT', price: 450000, text: 'I have this' });
    expect(ok.body.buyerFirstName).toBe('Asha');
    expect((await respond(s.a, id)).body.code).toBe('ALREADY_RESPONDED');
    // two sellers answering together are both kept; the same seller twice at once is kept once
    const both = await Promise.all([respond(s.b, id), respond(s.b, id)]);
    expect(both.map((x) => x.status).sort()).toEqual([201, 422]);
    expect((await call('GET', `/v1/buyer/requests/${id}`, { token: s.buyer })).body.responses).toHaveLength(2);
    expect(await dbOf(app).db.select().from(notifications).where(eq(notifications.code, 'NEW_RESPONSE'))).toHaveLength(2);
    const mine = await call('GET', '/v1/seller/requests', { token: s.a });
    expect(mine.body.newCount).toBe(0);
    expect(mine.body.items[0].response.status).toBe('SENT');
  });

  it('a seller cannot answer their own request', async () => {
    const s = await setup();
    const own = await makeShop(call, '9765403001', 'ownshop', ['Ethnic wear']);
    const r = await mkRequest(s.buyer);
    expect((await respond(own, r.body.id)).body.code).toBe('OWN_REQUEST');
  });

  it('"I want this" opens a chat once; "Not for me" is final; nobody else can answer', async () => {
    const s = await setup();
    const r = await mkRequest(s.buyer);
    const ra = (await respond(s.a, r.body.id)).body.response.id;
    const rb = (await respond(s.b, r.body.id)).body.response.id;
    expect((await call('POST', `/v1/buyer/responses/${ra}/want`, { token: s.stranger })).status).toBe(404);
    const want = await call('POST', `/v1/buyer/responses/${ra}/want`, { token: s.buyer });
    expect(want.status).toBe(200);
    const respA = want.body.responses.find((x: Json) => x.id === ra);
    expect(respA.status).toBe('WANTED');
    expect(respA.threadId).toBeTruthy();
    expect((await call('POST', `/v1/buyer/responses/${ra}/want`, { token: s.buyer })).status).toBe(409);
    expect((await call('POST', `/v1/buyer/responses/${ra}/decline`, { token: s.buyer })).status).toBe(409);
    const dec = await call('POST', `/v1/buyer/responses/${rb}/decline`, { token: s.buyer });
    expect(dec.body.responses.find((x: Json) => x.id === rb)).toMatchObject({ status: 'DECLINED', threadId: null });
    expect((await call('POST', `/v1/buyer/responses/${rb}/want`, { token: s.buyer })).status).toBe(409);
    // the chat: both people, a system line first, and nobody else
    const t = await call('GET', `/v1/buyer/threads/${respA.threadId}`, { token: s.buyer });
    expect(t.body).toMatchObject({ kind: 'REQUEST', requestId: r.body.id, title: 'Green silk saree', otherName: 'Shop shopa' });
    expect(t.body.messages[0].from).toBe('SYSTEM');
    expect((await call('GET', `/v1/seller/threads/${respA.threadId}`, { token: s.a })).status).toBe(200);
    expect((await call('GET', `/v1/seller/threads/${respA.threadId}`, { token: s.b })).status).toBe(404);
    const codes = (await dbOf(app).db.select().from(notifications).where(eq(notifications.app, 'seller'))).map((n) => n.code);
    expect(codes.filter((c) => c === 'RESPONSE_WANTED')).toHaveLength(1);
    expect(codes.filter((c) => c === 'RESPONSE_DECLINED')).toHaveLength(1);
  });

  it('two taps on "I want this" make one chat', async () => {
    const s = await setup();
    const r = await mkRequest(s.buyer);
    const ra = (await respond(s.a, r.body.id)).body.response.id;
    const rs = await Promise.all([1, 2, 3].map(() => call('POST', `/v1/buyer/responses/${ra}/want`, { token: s.buyer })));
    expect(rs.map((x) => x.status).sort()).toEqual([200, 409, 409]);
    expect(await dbOf(app).db.select().from(chatThreads).where(eq(chatThreads.kind, 'REQUEST'))).toHaveLength(1);
  });

  it('closing a request stops new answers and "I want this", and can happen once', async () => {
    const s = await setup();
    const r = await mkRequest(s.buyer);
    const ra = (await respond(s.a, r.body.id)).body.response.id;
    const closed = await call('POST', `/v1/buyer/requests/${r.body.id}/close`, { token: s.buyer });
    expect(closed.body.status).toBe('CLOSED');
    expect((await call('POST', `/v1/buyer/requests/${r.body.id}/close`, { token: s.buyer })).body.code).toBe('CLOSED');
    expect((await respond(s.b, r.body.id)).body.code).toBe('CLOSED');
    expect((await call('POST', `/v1/buyer/responses/${ra}/want`, { token: s.buyer })).body.code).toBe('CLOSED');
    // a seller who answered still sees it, marked closed
    expect((await call('GET', '/v1/seller/requests', { token: s.a })).body.items[0].status).toBe('CLOSED');
    // one who did not answer no longer sees a closed request
    expect((await call('GET', '/v1/seller/requests', { token: s.b })).body.items).toHaveLength(0);
  });
});

describe('expiry after 7 days', () => {
  it('expires an open request once, even with a sweep and several readers at the same moment', async () => {
    const s = await setup();
    const r = await mkRequest(s.buyer);
    clock.advance(7 * DAY - 1000);
    await tick();
    const early = await signIn(call, '9765403001', 'buyer');
    expect((await call('GET', `/v1/buyer/requests/${r.body.id}`, { token: early })).body.status).toBe('OPEN');
    clock.advance(2000);
    const buyer = await signIn(call, '9765403001', 'buyer'); // sessions and tokens run on the app clock, so sign in again after a week
    const sellerA = await signIn(call, '9876503001', 'seller');
    await Promise.all([tick(), tick(), call('GET', `/v1/buyer/requests/${r.body.id}`, { token: buyer }), call('GET', '/v1/buyer/requests', { token: buyer }), call('GET', '/v1/seller/requests', { token: sellerA })]);
    const [row] = await dbOf(app).db.select().from(buyerRequests).where(eq(buyerRequests.id, r.body.id));
    expect(row!.status).toBe('EXPIRED');
    expect(await dbOf(app).db.select().from(notifications).where(eq(notifications.code, 'REQUEST_EXPIRED'))).toHaveLength(1);
    const sellerB = await signIn(call, '9876503002', 'seller');
    expect((await respond(sellerB, r.body.id)).body.code).toBe('CLOSED'); // too late to answer
    expect((await call('POST', `/v1/buyer/requests/${r.body.id}/close`, { token: buyer })).body.code).toBe('CLOSED');
  });

  it('shows EXPIRED on read even when no sweep has run', async () => {
    const s = await setup();
    const r = await mkRequest(s.buyer);
    clock.advance(8 * DAY);
    const buyer = await signIn(call, '9765403001', 'buyer');
    expect((await call('GET', `/v1/buyer/requests/${r.body.id}`, { token: buyer })).body.status).toBe('EXPIRED');
  });

  it('does not touch a closed request', async () => {
    const s = await setup();
    const r = await mkRequest(s.buyer);
    await call('POST', `/v1/buyer/requests/${r.body.id}/close`, { token: s.buyer });
    clock.advance(8 * DAY);
    await tick();
    expect((await dbOf(app).db.select().from(buyerRequests).where(eq(buyerRequests.id, r.body.id)))[0]!.status).toBe('CLOSED');
  });
});

describe('create a listing from a request', () => {
  async function wanted() {
    const s = await setup();
    const r = await mkRequest(s.buyer);
    const ra = (await respond(s.a, r.body.id)).body.response.id as string;
    const rb = (await respond(s.b, r.body.id)).body.response.id as string;
    const want = await call('POST', `/v1/buyer/responses/${ra}/want`, { token: s.buyer });
    return { ...s, requestId: r.body.id as string, ra, rb, threadId: want.body.responses.find((x: Json) => x.id === ra).threadId as string };
  }
  const publish = async (seller: string, fromResponseId: string | null) => {
    const m = await upload(call, seller, 'seller', 'LISTING');
    return call('POST', '/v1/seller/listings', {
      token: seller,
      body: { title: 'Green silk saree', category: 'Ethnic wear', price: 450000, media: [{ mediaId: m.id }], variants: [{ label: 'Free', stock: 1 }], bargaining: { mode: 'BUY_NOW', expiryMinutes: 1440 }, checkout: { channel: 'DIRECT' }, publish: true, ...(fromResponseId ? { fromResponseId } : {}) },
    });
  };
  const cards = (threadId: string) => dbOf(app).db.select().from(chatMessages).where(and(eq(chatMessages.threadId, threadId), eq(chatMessages.type, 'LISTING')));

  it('posts the live listing in the chat and remembers it on the response', async () => {
    const s = await wanted();
    clock.advance(1000);
    const l = await publish(s.a, s.ra);
    expect(l.status).toBe(201);
    const c = await cards(s.threadId);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ from: 'SELLER', listingId: l.body.id });
    expect((await dbOf(app).db.select().from(requestResponses).where(eq(requestResponses.id, s.ra)))[0]!.listingId).toBe(l.body.id);
    const view = await call('GET', `/v1/buyer/threads/${s.threadId}`, { token: s.buyer });
    expect(view.body.messages.at(-1)).toMatchObject({ from: 'OTHER', type: 'LISTING', listing: { id: l.body.id, price: 450000 } });
    expect(view.body.unread).toBe(1);
    // sharing the same listing again (a re-save) does not post it twice
    expect(await app.get(ChatService).shareListingFromResponse(await sellerIdOf(app, '9876503001'), s.ra, l.body.id)).toBe(false);
    expect(await cards(s.threadId)).toHaveLength(1);
  });

  it('posts nothing for a response that is not WANTED, or that belongs to another seller; the listing is still saved', async () => {
    const s = await wanted();
    const notWanted = await publish(s.b, s.rb); // b's response is still SENT
    expect(notWanted.status).toBe(201);
    const stolen = await publish(s.b, s.ra); // a's WANTED response, sent by b
    expect(stolen.status).toBe(201);
    expect(await cards(s.threadId)).toHaveLength(0);
    expect((await dbOf(app).db.select().from(requestResponses).where(eq(requestResponses.id, s.ra)))[0]!.listingId).toBeNull();
    const draft = await publish(s.a, null);
    expect(draft.status).toBe(201);
    expect(await cards(s.threadId)).toHaveLength(0);
  });

  it('posts nothing for a draft', async () => {
    const s = await wanted();
    const m = await upload(call, s.a, 'seller', 'LISTING');
    const d = await call('POST', '/v1/seller/listings', { token: s.a, body: { title: 'Green silk saree', category: 'Ethnic wear', price: 450000, media: [{ mediaId: m.id }], variants: [{ label: 'Free', stock: 1 }], bargaining: { mode: 'BUY_NOW', expiryMinutes: 1440 }, checkout: { channel: 'DIRECT' }, publish: false, fromResponseId: s.ra } });
    expect(d.status).toBe(201);
    expect(await cards(s.threadId)).toHaveLength(0);
  });
});
