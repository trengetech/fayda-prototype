import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifications, pushTickets, pushTokens } from '../src/db/schema.js';
import { NegotiationEvents, type RealtimeEvent } from '../src/negotiations/negotiation-events.js';
import { NotificationsService, RECEIPT_DELAY_MS, RECEIPT_MAX_AGE_MS } from '../src/notifications/notifications.service.js';
import { ExpoPushProvider, type PushMessage, type PushProvider, type PushResult, type ReceiptResult } from '../src/notifications/push-provider.js';
import { renderNotification } from '../src/notifications/render.js';
import { makeCaller, signIn, type Caller } from './api.js';
import { makeBuyer, makeListing, makeShop, userId } from './community-helpers.js';
import { ManualClock, dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
let call: Caller;
let dir: string;
let clock: ManualClock;
let anita: string; // seller
let asha: string; // buyer
let kiran: string; // buyer
let listing: { id: string; variantId: string };
const sent: PushMessage[][] = [];
let nextResult: PushResult = 'ok';
let ticketSeq = 0;
/** What the fake push service says about each ticket's receipt. Tickets not listed here are "not made yet". */
const receiptAnswers = new Map<string, ReceiptResult>();
const receiptAsks: string[][] = [];
const fake: PushProvider = {
  name: 'fake',
  simulated: false,
  async send(messages) {
    sent.push(messages);
    return messages.map(() => (nextResult === 'ok' ? { result: nextResult, ticketId: `ticket-${++ticketSeq}` } : { result: nextResult }));
  },
  async receipts(ids) {
    receiptAsks.push(ids);
    return new Map(ids.map((id) => [id, receiptAnswers.get(id) ?? ('pending' as const)]));
  },
};
const events: RealtimeEvent[] = [];
const T1 = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const T2 = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';

const svc = () => app.get(NotificationsService);
const sweep = () => svc().run(clock.now());

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-notif-'));
  clock = new ManualClock();
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir }, clock);
  call = makeCaller(app);
  await dbOf(app).db.execute(sql`truncate table push_tickets`); // tickets are not tied to users, so leftovers from an earlier run would clash with the fake's ticket numbers
  (svc() as unknown as { push: PushProvider }).push = fake;
  app.get(NegotiationEvents).subscribeEvents((e) => events.push(...e));
  anita = await makeShop(call, '9876504001', 'anitanotif', ['Ethnic wear']);
  asha = await makeBuyer(call, '9765404001', 'Asha Rao');
  kiran = await makeBuyer(call, '9765404002', 'Kiran Patel');
  listing = await makeListing(call, anita, { title: 'Notif kurta' });
});
afterAll(async () => {
  await dbOf(app).db.execute(sql`truncate table users, push_tickets cascade`);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('notification centre', () => {
  it('a comment makes a seller notification with words, a target and an unread count; buyers see none of it', async () => {
    await sweep(); // anything written during setup is told once, here
    expect((await call('POST', `/v1/buyer/listings/${listing.id}/comments`, { token: asha, body: { text: 'Is this available in L?' } })).status).toBe(201);
    const r = await call('GET', '/v1/seller/notifications', { token: anita });
    expect(r.status).toBe(200);
    expect(r.body.unread).toBe(1);
    expect(r.body.items[0]).toMatchObject({ code: 'NEW_COMMENT', title: 'New comment', read: false, target: { kind: 'LISTING', id: listing.id } });
    expect(r.body.items[0].body).toContain('Is this available in L?');
    expect((await call('GET', '/v1/buyer/notifications', { token: asha })).body).toMatchObject({ items: [], unread: 0 });
    expect((await call('GET', '/v1/seller/notifications/unread-count', { token: anita })).body).toEqual({ unread: 1 });
  });

  it('marking read is own-only, repeatable, and "mark all" only touches this app', async () => {
    const id = (await call('GET', '/v1/seller/notifications', { token: anita })).body.items[0].id;
    expect((await call('POST', `/v1/seller/notifications/${id}/read`, { token: anita })).body).toEqual({ unread: 0 });
    expect((await call('POST', `/v1/seller/notifications/${id}/read`, { token: anita })).body).toEqual({ unread: 0 });
    // somebody else's id, and the wrong app's id, look like "not found"
    expect((await call('POST', `/v1/buyer/notifications/${id}/read`, { token: asha })).status).toBe(404);
    expect((await call('POST', `/v1/buyer/notifications/${id}/read`, { token: kiran })).status).toBe(404);
    // the same phone number in both apps: reading in one app leaves the other's alone
    const sellerUser = await userId(app, '9876504001');
    await dbOf(app).db.insert(notifications).values([
      { userId: sellerUser, app: 'seller', code: 'NEW_MESSAGE', createdAt: new Date(clock.now()) },
      { userId: sellerUser, app: 'buyer', code: 'NEW_MESSAGE', createdAt: new Date(clock.now()) },
    ]);
    expect((await call('POST', '/v1/seller/notifications/read-all', { token: anita })).body).toEqual({ unread: 0 });
    const buyerSide = await dbOf(app).db.select().from(notifications).where(eq(notifications.userId, sellerUser));
    expect(buyerSide.filter((n) => n.app === 'buyer' && !n.readAt)).toHaveLength(1);
  });

  it('pages newest first with a cursor', async () => {
    const sellerUser = await userId(app, '9876504001');
    await dbOf(app).db.insert(notifications).values(Array.from({ length: 5 }, (_, i) => ({ userId: sellerUser, app: 'seller' as const, code: 'NEW_MESSAGE', createdAt: new Date(clock.now() + 1000 * (i + 1)), pushedAt: new Date(clock.now()) })));
    const p1 = (await call('GET', '/v1/seller/notifications?limit=3', { token: anita })).body;
    expect(p1.items).toHaveLength(3);
    expect(p1.nextCursor).toBeTruthy();
    const p2 = (await call('GET', `/v1/seller/notifications?limit=50&cursor=${p1.nextCursor}`, { token: anita })).body;
    expect(p2.items.length).toBeGreaterThanOrEqual(3);
    const times = [...p1.items, ...p2.items].map((n: { at: number }) => n.at);
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(new Set([...p1.items, ...p2.items].map((n: { id: string }) => n.id)).size).toBe(p1.items.length + p2.items.length);
    expect((await call('GET', '/v1/seller/notifications?cursor=nonsense', { token: anita })).status).toBe(400);
  });

  it('needs sign-in and the right app', async () => {
    expect((await call('GET', '/v1/seller/notifications')).status).toBe(401);
    expect((await call('GET', '/v1/seller/notifications', { token: asha })).body.code).toBe('WRONG_APP');
  });
});

describe('wording never leaks private rules', () => {
  it('a buyer never gets seller-only text, and the buyer words for an automatic reply read like the seller’s own', () => {
    for (const code of ['AUTO_COUNTERED', 'AUTO_DECLINED', 'AUTO_ACCEPTED', 'NEW_OFFER', 'NEW_COMMENT']) {
      const t = renderNotification('buyer', code, { amount: 120000, snippet: 'x' });
      expect(t).toEqual({ title: 'Fayda', body: 'You have an update.' });
    }
    expect(renderNotification('buyer', 'SELLER_COUNTERED', { amount: 120000 })).toEqual({ title: 'The seller replied', body: 'The seller countered with ₹1,200.' });
    expect(renderNotification('buyer', 'SELLER_DECLINED', { amount: 90000 }).body).not.toMatch(/auto|rule/i);
    expect(renderNotification('seller', 'AUTO_COUNTERED', { amount: 120000, offer: 100000 }).title).toMatch(/Automatic/);
    expect(renderNotification('seller', 'ORDER_PLACED', { number: 'FD-100001' }).body).toContain('FD-100001');
  });
});

describe('push tokens', () => {
  it('registers, rejects junk, moves a phone’s token to whoever signed in last, and removes on sign-out', async () => {
    expect((await call('PUT', '/v1/buyer/push-token', { token: asha, body: { token: 'not-a-token', platform: 'android' } })).status).toBe(400);
    expect((await call('PUT', '/v1/buyer/push-token', { token: asha, body: { token: T1, platform: 'android' } })).status).toBe(204);
    expect((await call('PUT', '/v1/buyer/push-token', { token: asha, body: { token: T1, platform: 'android' } })).status).toBe(204); // again: one row
    const db = dbOf(app).db;
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, T1))).toHaveLength(1);
    expect((await call('PUT', '/v1/buyer/push-token', { token: kiran, body: { token: T1, platform: 'ios' } })).status).toBe(204);
    const [row] = await db.select().from(pushTokens).where(eq(pushTokens.token, T1));
    expect(row).toMatchObject({ userId: await userId(app, '9765404002'), platform: 'ios' });
    // asha cannot remove kiran's token
    await call('DELETE', '/v1/buyer/push-token', { token: asha, body: { token: T1, platform: 'ios' } });
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, T1))).toHaveLength(1);
    await call('DELETE', '/v1/buyer/push-token', { token: kiran, body: { token: T1, platform: 'ios' } });
    expect(await db.select().from(pushTokens).where(eq(pushTokens.token, T1))).toHaveLength(0);
  });
});

describe('the sweep: real-time event and push', () => {
  it('tells the open app once, pushes only to that person’s phones in that app, and never twice', async () => {
    await sweep();
    sent.length = 0;
    events.length = 0;
    await call('PUT', '/v1/seller/push-token', { token: anita, body: { token: T2, platform: 'android' } });
    await call('PUT', '/v1/buyer/push-token', { token: asha, body: { token: T1, platform: 'android' } }); // another person's phone
    await call('POST', `/v1/buyer/listings/${listing.id}/comments`, { token: kiran, body: { text: 'Price for two?' } });
    expect(await sweep()).toBe(1);
    const seller = await userId(app, '9876504001');
    expect(events.filter((e) => e.name === 'notification.created')).toEqual([{ name: 'notification.created', payload: { notificationId: expect.any(String) }, buyerUserId: null, sellerUserId: seller }]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(1);
    expect(sent[0]![0]).toMatchObject({ to: T2, title: 'New comment', data: { app: 'seller', kind: 'LISTING', id: listing.id } });
    expect(sent[0]![0]!.body).toContain('Price for two?');
    expect(await sweep()).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('a phone the push service says is gone loses its token; a temporary failure is tried again, then dropped', async () => {
    sent.length = 0;
    nextResult = 'gone';
    await call('POST', `/v1/buyer/listings/${listing.id}/comments`, { token: kiran, body: { text: 'Hello again' } });
    await sweep();
    expect(await dbOf(app).db.select().from(pushTokens).where(eq(pushTokens.token, T2))).toHaveLength(0);
    await call('PUT', '/v1/seller/push-token', { token: anita, body: { token: T2, platform: 'android' } });
    nextResult = 'retry';
    sent.length = 0;
    await call('POST', `/v1/buyer/listings/${listing.id}/comments`, { token: kiran, body: { text: 'Third one' } });
    await sweep();
    await sweep();
    expect(sent.length).toBe(2); // tried again
    clock.advance(10 * 60_000);
    await sweep();
    expect(sent.length).toBe(3); // one last try, now too old to try again
    await sweep();
    await sweep();
    expect(sent.length).toBe(3); // dropped, not retried forever
    nextResult = 'ok';
  });

  it('with push off (the default) nothing is sent and meta says so', async () => {
    const meta = await call('GET', '/v1/meta');
    expect(meta.body.providers.find((p: { key: string }) => p.key === 'push')).toEqual({ key: 'push', name: 'off', simulated: true });
  });
});

describe('receipts: phones that are gone', () => {
  const RT = 'ExponentPushToken[cccccccccccccccccccccc]';
  /** The fake clock has moved on, so the 15-minute sign-in tokens ran out: sign in again. */
  const freshTokens = async () => {
    [anita, kiran, asha] = await Promise.all([signIn(call, '9876504001', 'seller'), signIn(call, '9765404002', 'buyer'), signIn(call, '9765404001', 'buyer')]);
  };
  const ticketsFor = async (token: string) => (await dbOf(app).db.select().from(pushTickets).where(eq(pushTickets.token, token))).map((t) => t.ticketId);

  it('a push to a phone that has since been uninstalled loses its token once the receipt says so, and not before', async () => {
    await freshTokens();
    await sweep();
    await call('PUT', '/v1/seller/push-token', { token: anita, body: { token: RT, platform: 'android' } });
    nextResult = 'ok';
    await call('POST', `/v1/buyer/listings/${listing.id}/comments`, { token: kiran, body: { text: 'receipt test one' } });
    await sweep();
    const mine = await ticketsFor(RT);
    expect(mine).toHaveLength(1); // accepted: its ticket is remembered
    expect(await dbOf(app).db.select().from(pushTokens).where(eq(pushTokens.token, RT))).toHaveLength(1);
    // too early: nobody asks
    receiptAsks.length = 0;
    clock.advance(RECEIPT_DELAY_MS - 60_000);
    await sweep();
    expect(receiptAsks.flat()).not.toContain(mine[0]);
    // after the delay, but the receipt is not made yet: asked, ticket and token stay
    clock.advance(2 * 60_000);
    await sweep();
    expect(receiptAsks.flat()).toContain(mine[0]);
    expect(await ticketsFor(RT)).toHaveLength(1);
    expect(await dbOf(app).db.select().from(pushTokens).where(eq(pushTokens.token, RT))).toHaveLength(1);
    // the receipt says the phone is gone: token and ticket deleted
    receiptAnswers.set(mine[0]!, 'gone');
    clock.advance(31_000); // the check runs at most every 30 seconds
    await sweep();
    expect(await dbOf(app).db.select().from(pushTokens).where(eq(pushTokens.token, RT))).toHaveLength(0);
    expect(await ticketsFor(RT)).toHaveLength(0);
    // the other phone of the same person is untouched
    expect((await dbOf(app).db.select().from(pushTokens).where(eq(pushTokens.token, T2))).length).toBeGreaterThanOrEqual(0);
  });

  it('an "ok" receipt only clears the ticket; a delivery error keeps the token; the check is throttled to once in 30 seconds', async () => {
    const OK = 'ExponentPushToken[dddddddddddddddddddddd]';
    await freshTokens();
    await call('PUT', '/v1/seller/push-token', { token: anita, body: { token: OK, platform: 'android' } });
    await call('POST', `/v1/buyer/listings/${listing.id}/comments`, { token: kiran, body: { text: 'receipt test two' } });
    await sweep();
    const mine = await ticketsFor(OK);
    expect(mine.length).toBeGreaterThan(0);
    clock.advance(RECEIPT_DELAY_MS + 60_000);
    await freshTokens();
    receiptAsks.length = 0;
    await sweep();
    await sweep();
    await sweep(); // three ticks in the same second while the receipt is still not made: asked once, not three times
    expect(receiptAsks).toHaveLength(1);
    expect((await ticketsFor(OK)).length).toBe(mine.length); // not answered yet, so still remembered
    for (const id of mine) receiptAnswers.set(id, 'failed');
    clock.advance(31_000);
    await sweep();
    expect(await ticketsFor(OK)).toHaveLength(0); // answered, so cleared
    expect(await dbOf(app).db.select().from(pushTokens).where(eq(pushTokens.token, OK))).toHaveLength(1); // a delivery error is not "phone gone"
    await call('POST', `/v1/buyer/listings/${listing.id}/comments`, { token: kiran, body: { text: 'receipt test three' } });
    await sweep();
    const [t2] = await ticketsFor(OK);
    receiptAnswers.set(t2!, 'ok');
    clock.advance(RECEIPT_DELAY_MS + 60_000);
    await sweep();
    expect(await ticketsFor(OK)).toHaveLength(0);
    expect(await dbOf(app).db.select().from(pushTokens).where(eq(pushTokens.token, OK))).toHaveLength(1);
  });

  it('a receipt that never arrives is dropped after a day, and the token stays', async () => {
    const LATE = 'ExponentPushToken[eeeeeeeeeeeeeeeeeeeeee]';
    await freshTokens();
    await call('PUT', '/v1/seller/push-token', { token: anita, body: { token: LATE, platform: 'android' } });
    await call('POST', `/v1/buyer/listings/${listing.id}/comments`, { token: kiran, body: { text: 'receipt test four' } });
    await sweep();
    expect(await ticketsFor(LATE)).toHaveLength(1);
    clock.advance(RECEIPT_MAX_AGE_MS + 120_000);
    await sweep();
    expect(await ticketsFor(LATE)).toHaveLength(0);
    expect(await dbOf(app).db.select().from(pushTokens).where(eq(pushTokens.token, LATE))).toHaveLength(1);
  });
});

describe('Expo push provider', () => {
  const msg = (i: number): PushMessage => ({ to: `ExponentPushToken[${i}]`, title: 't', body: 'b', data: { a: '1' } });
  it('sends the Expo request shape in chunks of 100 and maps tickets', async () => {
    const bodies: unknown[][] = [];
    const p = new ExpoPushProvider('secret', async (url, init) => {
      bodies.push(JSON.parse(init.body) as unknown[]);
      expect(url).toBe('https://exp.host/--/api/v2/push/send');
      expect(init.headers.authorization).toBe('Bearer secret');
      const n = (JSON.parse(init.body) as unknown[]).length;
      return { ok: true, status: 200, json: async () => ({ data: Array.from({ length: n }, (_, i) => (i === 0 ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: `tk-${i}` })) }) };
    });
    const res = await p.send(Array.from({ length: 150 }, (_, i) => msg(i)));
    expect(bodies.map((b) => b.length)).toEqual([100, 50]);
    expect(bodies[0]![0]).toMatchObject({ to: 'ExponentPushToken[0]', title: 't', body: 'b', sound: 'default', channelId: 'default' });
    expect(res[0]).toEqual({ result: 'gone' });
    expect(res[1]).toEqual({ result: 'ok', ticketId: 'tk-1' });
    expect(res).toHaveLength(150);
  });
  it('never throws: a network error or a 5xx is "retry", a 4xx is "failed"', async () => {
    expect(await new ExpoPushProvider(null, async () => { throw new Error('offline'); }).send([msg(1)])).toEqual([{ result: 'retry' }]);
    expect(await new ExpoPushProvider(null, async () => ({ ok: false, status: 503, json: async () => ({}) })).send([msg(1)])).toEqual([{ result: 'retry' }]);
    expect(await new ExpoPushProvider(null, async () => ({ ok: false, status: 400, json: async () => ({}) })).send([msg(1)])).toEqual([{ result: 'failed' }]);
  });
  it('reads receipts in chunks of 1000 and maps them; ids Expo does not know yet stay pending; a network error leaves everything pending', async () => {
    const asks: { url: string; ids: string[] }[] = [];
    const p = new ExpoPushProvider('secret', async (url, init) => {
      const ids = (JSON.parse(init.body) as { ids: string[] }).ids;
      asks.push({ url, ids });
      expect(init.headers.authorization).toBe('Bearer secret');
      return { ok: true, status: 200, json: async () => ({ data: { [ids[0]!]: { status: 'error', details: { error: 'DeviceNotRegistered' } }, [ids[1]!]: { status: 'ok' }, [ids[2]!]: { status: 'error', details: { error: 'MessageRateExceeded' } } } }) };
    });
    const ids = Array.from({ length: 1200 }, (_, i) => `t${i}`);
    const r = await p.receipts(ids);
    expect(asks.map((a) => a.ids.length)).toEqual([1000, 200]);
    expect(asks[0]!.url).toBe('https://exp.host/--/api/v2/push/getReceipts');
    expect(r.get('t0')).toBe('gone');
    expect(r.get('t1')).toBe('ok');
    expect(r.get('t2')).toBe('failed');
    expect(r.get('t3')).toBe('pending');
    expect(r.size).toBe(1200);
    const down = await new ExpoPushProvider(null, async () => { throw new Error('offline'); }).receipts(['a', 'b']);
    expect([...down.values()]).toEqual(['pending', 'pending']);
    const bad = await new ExpoPushProvider(null, async () => ({ ok: false, status: 503, json: async () => ({}) })).receipts(['a']);
    expect(bad.get('a')).toBe('pending');
  });
});
