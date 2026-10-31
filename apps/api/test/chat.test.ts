import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { chatMessages, notifications } from '../src/db/schema.js';
import { makeCaller, type Caller } from './api.js';
import { insertOrder, makeBuyer, makeListing, makeShop, upload } from './community-helpers.js';
import { ManualClock, dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
let call: Caller;
let dir: string;
let clock: ManualClock;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-chat-'));
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

/** One order with a chat, a second buyer and a second seller who are not part of it. */
async function setup() {
  const seller = await makeShop(call, '9876501001', 'chatshop');
  const otherSeller = await makeShop(call, '9876501002', 'othershop');
  const buyer = await makeBuyer(call, '9765401001', 'Asha Rao', { phone: '9700012345', whatsapp: '9700054321' });
  const stranger = await makeBuyer(call, '9765401002', 'Ravi K');
  const l = await makeListing(call, seller);
  const other = await makeListing(call, otherSeller);
  const order = await insertOrder(app, { buyerPhone: '9765401001', sellerPhone: '9876501001', listingId: l.id, variantId: l.variantId });
  return { seller, otherSeller, buyer, stranger, listing: l, otherListing: other, order };
}
const send = (token: string, app_: 'buyer' | 'seller', id: string, body: object) => call('POST', `/v1/${app_}/threads/${id}/messages`, { token, body });

describe('chat: who can see and write', () => {
  it('an order chat starts with a system message that is not unread', async () => {
    const s = await setup();
    const b = await call('GET', `/v1/buyer/threads/${s.order.threadId}`, { token: s.buyer });
    expect(b.status).toBe(200);
    expect(b.body.messages).toHaveLength(1);
    expect(b.body.messages[0].from).toBe('SYSTEM');
    expect(b.body.unread).toBe(0);
    expect(b.body.title).toMatch(/^FD-\d+ · Cotton kurta$/);
    expect(b.body.otherName).toBe('Shop chatshop');
    const sv = await call('GET', `/v1/seller/threads/${s.order.threadId}`, { token: s.seller });
    expect(sv.body.otherName).toBe('Asha'); // sellers see a buyer's first name only
  });

  it('only the two people in the chat can read or write; everyone else gets "not found"', async () => {
    const s = await setup();
    const id = s.order.threadId;
    expect((await call('GET', `/v1/buyer/threads/${id}`, { token: s.stranger })).status).toBe(404);
    expect((await call('GET', `/v1/seller/threads/${id}`, { token: s.otherSeller })).status).toBe(404);
    expect((await send(s.stranger, 'buyer', id, { text: 'hi' })).status).toBe(404);
    expect((await send(s.otherSeller, 'seller', id, { text: 'hi' })).status).toBe(404);
    expect((await call('POST', `/v1/buyer/threads/${id}/read`, { token: s.stranger })).status).toBe(404);
    // a buyer token cannot use the seller routes, even for its own chat
    expect((await call('GET', `/v1/seller/threads/${id}`, { token: s.buyer })).body.code).toBe('WRONG_APP');
    expect((await call('GET', '/v1/buyer/threads', { token: s.stranger })).body.items).toHaveLength(0);
    expect((await dbOf(app).db.select().from(chatMessages)).length).toBe(1);
  });

  it('never carries contact numbers in a chat payload', async () => {
    const s = await setup();
    await send(s.buyer, 'buyer', s.order.threadId, { text: 'hello' });
    for (const r of [await call('GET', `/v1/buyer/threads/${s.order.threadId}`, { token: s.buyer }), await call('GET', `/v1/seller/threads/${s.order.threadId}`, { token: s.seller }), await call('GET', '/v1/seller/threads', { token: s.seller })]) {
      const text = JSON.stringify(r.body);
      for (const n of ['9700012345', '9700054321', '9000099998', '9765401001', '9876501001']) expect(text).not.toContain(n);
    }
  });
});

describe('chat: unread and read', () => {
  it('counts the other side’s messages, reading does not move without being asked, and read only moves forward', async () => {
    const s = await setup();
    const id = s.order.threadId;
    clock.advance(1000);
    await send(s.buyer, 'buyer', id, { text: 'Is it available in L?' });
    clock.advance(1000);
    await send(s.buyer, 'buyer', id, { text: 'Hello?' });
    expect((await call('GET', `/v1/seller/threads/${id}`, { token: s.seller })).body.unread).toBe(2);
    expect((await call('GET', `/v1/seller/threads/${id}`, { token: s.seller })).body.unread).toBe(2); // GET marks nothing
    const list = await call('GET', '/v1/seller/threads', { token: s.seller });
    expect(list.body.unread).toBe(2);
    expect(list.body.items[0]).toMatchObject({ unread: 2, lastMessage: 'Hello?' });
    expect((await call('GET', `/v1/buyer/threads/${id}`, { token: s.buyer })).body.unread).toBe(0); // my own messages are never unread
    clock.advance(1000);
    expect((await call('POST', `/v1/seller/threads/${id}/read`, { token: s.seller })).body.unread).toBe(0);
    clock.advance(1000);
    await send(s.seller, 'seller', id, { text: 'Yes, in L too.' });
    expect((await call('GET', `/v1/buyer/threads/${id}`, { token: s.buyer })).body.unread).toBe(1);
    expect((await call('GET', `/v1/seller/threads/${id}`, { token: s.seller })).body.unread).toBe(0);
    // an old clock reading never moves "read" backwards
    clock.advance(-5000);
    expect((await call('POST', `/v1/seller/threads/${id}/read`, { token: s.seller })).body.unread).toBe(0);
    clock.advance(5000);
  });

  it('notifies the other person once per message, and marks who is "me"', async () => {
    const s = await setup();
    const t = await send(s.buyer, 'buyer', s.order.threadId, { text: 'Hi' });
    expect(t.status).toBe(201);
    const msg = t.body.messages.at(-1);
    expect(msg).toMatchObject({ from: 'ME', type: 'TEXT', text: 'Hi' });
    expect((await call('GET', `/v1/seller/threads/${s.order.threadId}`, { token: s.seller })).body.messages.at(-1).from).toBe('OTHER');
    const rows = await dbOf(app).db.select().from(notifications).where(eq(notifications.code, 'NEW_MESSAGE'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ app: 'seller', threadId: s.order.threadId, orderId: s.order.id });
  });
});

describe('chat: sending', () => {
  it('a retry with the same clientKey posts once and notifies once', async () => {
    const s = await setup();
    const body = { text: 'Is the colour true to the photo?', clientKey: 'key-abcdef-1' };
    const a = await send(s.buyer, 'buyer', s.order.threadId, body);
    const b = await send(s.buyer, 'buyer', s.order.threadId, body);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(b.body.messages.filter((m: { text: string }) => m.text === body.text)).toHaveLength(1);
    expect(await dbOf(app).db.select().from(notifications).where(eq(notifications.code, 'NEW_MESSAGE'))).toHaveLength(1);
    // simultaneous sends with one key still make one message
    await Promise.all([1, 2, 3].map(() => send(s.buyer, 'buyer', s.order.threadId, { text: 'Parallel', clientKey: 'key-abcdef-2' })));
    const msgs = (await call('GET', `/v1/buyer/threads/${s.order.threadId}`, { token: s.buyer })).body.messages;
    expect(msgs.filter((m: { text: string }) => m.text === 'Parallel')).toHaveLength(1);
  });

  it('refuses empty and over-long messages', async () => {
    const s = await setup();
    expect((await send(s.buyer, 'buyer', s.order.threadId, { text: '   ' })).body.code).toBe('EMPTY');
    expect((await send(s.buyer, 'buyer', s.order.threadId, { text: 'x'.repeat(1001) })).status).toBe(400); // contract limit
    expect((await send(s.buyer, 'buyer', s.order.threadId, { text: 'x'.repeat(1000) })).status).toBe(201);
  });

  it('a photo must be the sender’s own finished chat image', async () => {
    const s = await setup();
    const id = s.order.threadId;
    const photo = await upload(call, s.buyer, 'buyer', 'CHAT');
    const ok = await send(s.buyer, 'buyer', id, { mediaId: photo.id, text: 'See this' });
    expect(ok.status).toBe(201);
    expect(ok.body.messages.at(-1)).toMatchObject({ type: 'MEDIA', text: 'See this' });
    expect(ok.body.messages.at(-1).media.url).toBe(`/v1/media/${photo.id}`);
    const review = await upload(call, s.buyer, 'buyer', 'REVIEW');
    expect((await send(s.buyer, 'buyer', id, { mediaId: review.id })).body.fields?.media).toBeTruthy(); // wrong purpose
    const theirs = await upload(call, s.stranger, 'buyer', 'CHAT');
    expect((await send(s.buyer, 'buyer', id, { mediaId: theirs.id })).status).toBe(400); // someone else's file
    expect((await send(s.buyer, 'buyer', id, { mediaId: '11111111-1111-4111-8111-111111111111' })).status).toBe(400);
    // chat photos are photos only
    const intent = await call('POST', '/v1/buyer/media/intents', { token: s.buyer, body: { kind: 'video', purpose: 'CHAT', mime: 'video/mp4', size: 1000, durationSec: 5 } });
    expect(intent.status).toBe(400);
  });

  it('only the seller can share a listing, and only their own live one', async () => {
    const s = await setup();
    const id = s.order.threadId;
    const bad = await send(s.buyer, 'buyer', id, { listingId: s.listing.id });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('INVALID_LISTING');
    expect((await send(s.seller, 'seller', id, { listingId: s.otherListing.id })).body.code).toBe('INVALID_LISTING'); // another shop's
    expect((await send(s.seller, 'seller', id, { listingId: '22222222-2222-4222-8222-222222222222' })).body.code).toBe('INVALID_LISTING');
    await call('POST', `/v1/seller/listings/${s.listing.id}/status`, { token: s.seller, body: { status: 'PAUSED' } });
    expect((await send(s.seller, 'seller', id, { listingId: s.listing.id })).body.code).toBe('INVALID_LISTING'); // paused
    await call('POST', `/v1/seller/listings/${s.listing.id}/status`, { token: s.seller, body: { status: 'ACTIVE' } });
    const ok = await send(s.seller, 'seller', id, { listingId: s.listing.id });
    expect(ok.status).toBe(201);
    expect(ok.body.messages.at(-1)).toMatchObject({ type: 'LISTING', listing: { id: s.listing.id, title: 'Cotton kurta', price: 150000 } });
    expect(ok.body.messages.at(-1).listing.coverUrl).toMatch(/^\/v1\/media\//);
    expect(ok.body.lastMessage).toBe('Shared a listing');
  });
});
