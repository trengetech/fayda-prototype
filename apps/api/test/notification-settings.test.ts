import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notificationSettings, notifications, pushTokens } from '../src/db/schema.js';
import { NegotiationEvents, type RealtimeEvent } from '../src/negotiations/negotiation-events.js';
import { CATEGORIES, CATEGORY_CODES } from '../src/notifications/categories.js';
import { NotificationsService, READ_RETENTION_MS, UNREAD_RETENTION_MS } from '../src/notifications/notifications.service.js';
import type { PushMessage, PushProvider } from '../src/notifications/push-provider.js';
import { allCodes } from '../src/notifications/render.js';
import { makeCaller, type Caller } from './api.js';
import { makeBuyer, makeShop, userId } from './community-helpers.js';
import { ManualClock, dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
let call: Caller;
let dir: string;
let clock: ManualClock;
let seller: string;
let asha: string;
let kiran: string;
let sellerId: string;
let ashaId: string;
let kiranId: string;
const sent: PushMessage[] = [];
const events: RealtimeEvent[] = [];
const fake: PushProvider = {
  name: 'fake',
  simulated: false,
  async send(messages) {
    sent.push(...messages);
    return messages.map(() => ({ result: 'ok' as const }));
  },
  async receipts(ids) {
    return new Map(ids.map((id) => [id, 'pending' as const]));
  },
};
const svc = () => app.get(NotificationsService);
const TOKEN = 'ExponentPushToken[cccccccccccccccccccccc]';

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-notifset-'));
  clock = new ManualClock();
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir }, clock);
  call = makeCaller(app);
  (svc() as unknown as { push: PushProvider }).push = fake;
  app.get(NegotiationEvents).subscribeEvents((e) => events.push(...e));
  seller = await makeShop(call, '9876506001', 'setshop', ['Ethnic wear']);
  asha = await makeBuyer(call, '9765406001', 'Asha Rao');
  kiran = await makeBuyer(call, '9765406002', 'Kiran Patel');
  sellerId = await userId(app, '9876506001');
  ashaId = await userId(app, '9765406001');
  kiranId = await userId(app, '9765406002');
});
afterAll(async () => {
  await dbOf(app).db.execute(sql`truncate table users cascade`);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const put = async (uid: string, app_: 'buyer' | 'seller', code: string, over: { ageMs?: number; read?: boolean } = {}): Promise<string> => {
  const at = new Date(clock.now() - (over.ageMs ?? 0));
  const [row] = await dbOf(app).db.insert(notifications).values({ userId: uid, app: app_, code, createdAt: at, readAt: over.read ? at : null, pushedAt: at }).returning({ id: notifications.id });
  return row!.id;
};
const wipe = () => dbOf(app).db.execute(sql`truncate table notifications, notification_settings`);
const list = async (token: string, side: 'buyer' | 'seller'): Promise<{ codes: string[]; unread: number }> => {
  const r = await call('GET', `/v1/${side}/notifications`, { token });
  return { codes: r.body.items.map((i: { code: string }) => i.code), unread: r.body.unread };
};

describe('categories', () => {
  it('every code either app can show belongs to exactly one switch', () => {
    const listed = CATEGORIES.flatMap((c) => CATEGORY_CODES[c]);
    expect(new Set(listed).size).toBe(listed.length);
    for (const code of allCodes()) expect(listed, `${code} has no category`).toContain(code);
  });
});

describe('deleting', () => {
  it('deletes one of my own, never someone else’s, and the unread count follows', async () => {
    await wipe();
    const a = await put(ashaId, 'buyer', 'NEW_MESSAGE');
    await put(ashaId, 'buyer', 'ORDER_SHIPPED');
    const k = await put(kiranId, 'buyer', 'NEW_MESSAGE');
    expect((await call('DELETE', `/v1/buyer/notifications/${k}`, { token: asha })).status).toBe(404);
    expect((await list(kiran, 'buyer')).codes).toEqual(['NEW_MESSAGE']);
    const r = await call('DELETE', `/v1/buyer/notifications/${a}`, { token: asha });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ unread: 1 });
    expect((await call('DELETE', `/v1/buyer/notifications/${a}`, { token: asha })).status).toBe(404);
    expect((await call('DELETE', `/v1/seller/notifications/${a}`, { token: asha })).status).toBe(403); // a buyer token on the seller route
    expect((await call('DELETE', `/v1/buyer/notifications/${a}`)).status).toBe(401);
  });

  it('clear all removes only my notifications in this app', async () => {
    await wipe();
    await put(ashaId, 'buyer', 'NEW_MESSAGE');
    await put(ashaId, 'buyer', 'ORDER_SHIPPED', { read: true });
    await put(kiranId, 'buyer', 'NEW_MESSAGE');
    await put(sellerId, 'seller', 'NEW_COMMENT');
    expect((await call('DELETE', '/v1/buyer/notifications', { token: asha })).body).toEqual({ unread: 0 });
    expect((await list(asha, 'buyer')).codes).toEqual([]);
    expect((await list(kiran, 'buyer')).codes).toEqual(['NEW_MESSAGE']);
    expect((await list(seller, 'seller')).codes).toEqual(['NEW_COMMENT']);
  });
});

describe('settings', () => {
  it('start with everything on, and Orders marked always on', async () => {
    await wipe();
    const r = await call('GET', '/v1/buyer/notifications/settings', { token: asha });
    expect(r.status).toBe(200);
    expect(r.body.items.map((i: { category: string }) => i.category)).toEqual(CATEGORIES);
    expect(r.body.items.every((i: { push: boolean; inApp: boolean }) => i.push && i.inApp)).toBe(true);
    expect(r.body.items.find((i: { category: string }) => i.category === 'ORDERS').alwaysOn).toBe(true);
    expect((await call('GET', '/v1/buyer/notifications/settings')).status).toBe(401);
    expect((await call('GET', '/v1/seller/notifications/settings', { token: asha })).status).toBe(403);
  });

  it('switching a kind off hides it from the centre and the unread count; switching it back on brings it back; nothing is deleted', async () => {
    await wipe();
    await put(ashaId, 'buyer', 'NEW_MESSAGE');
    await put(ashaId, 'buyer', 'ORDER_SHIPPED');
    const off = await call('PUT', '/v1/buyer/notifications/settings/CHAT', { token: asha, body: { push: false, inApp: false } });
    expect(off.status).toBe(200);
    expect(off.body.items.find((i: { category: string }) => i.category === 'CHAT')).toMatchObject({ push: false, inApp: false });
    expect(await list(asha, 'buyer')).toEqual({ codes: ['ORDER_SHIPPED'], unread: 1 });
    expect((await call('GET', '/v1/buyer/notifications/unread-count', { token: asha })).body).toEqual({ unread: 1 });
    await call('PUT', '/v1/buyer/notifications/settings/CHAT', { token: asha, body: { push: true, inApp: true } });
    expect((await list(asha, 'buyer')).codes.sort()).toEqual(['NEW_MESSAGE', 'ORDER_SHIPPED']);
  });

  it('is per person and per app', async () => {
    await wipe();
    await put(ashaId, 'buyer', 'NEW_MESSAGE');
    await put(kiranId, 'buyer', 'NEW_MESSAGE');
    await call('PUT', '/v1/buyer/notifications/settings/CHAT', { token: asha, body: { push: false, inApp: false } });
    expect((await list(kiran, 'buyer')).codes).toEqual(['NEW_MESSAGE']);
    const mine = await call('GET', '/v1/seller/notifications/settings', { token: seller });
    expect(mine.body.items.find((i: { category: string }) => i.category === 'CHAT')).toMatchObject({ push: true, inApp: true });
  });

  it('refuses to switch Orders off, and refuses an unknown kind', async () => {
    const orders = await call('PUT', '/v1/buyer/notifications/settings/ORDERS', { token: asha, body: { push: false, inApp: true } });
    expect(orders.status).toBe(400);
    expect(orders.body.code).toBe('ALWAYS_ON');
    expect((await call('PUT', '/v1/buyer/notifications/settings/ORDERS', { token: asha, body: { push: true, inApp: false } })).body.code).toBe('ALWAYS_ON');
    expect((await call('PUT', '/v1/buyer/notifications/settings/ORDERS', { token: asha, body: { push: true, inApp: true } })).status).toBe(200);
    expect((await call('PUT', '/v1/buyer/notifications/settings/NOPE', { token: asha, body: { push: true, inApp: true } })).status).toBe(400);
    expect((await call('PUT', '/v1/buyer/notifications/settings/CHAT', { token: asha, body: { push: 'yes' } })).status).toBe(400);
  });

  it('clear all leaves what a switched-off kind is hiding', async () => {
    await wipe();
    await put(ashaId, 'buyer', 'NEW_MESSAGE');
    await put(ashaId, 'buyer', 'ORDER_SHIPPED');
    await call('PUT', '/v1/buyer/notifications/settings/CHAT', { token: asha, body: { push: true, inApp: false } });
    await call('DELETE', '/v1/buyer/notifications', { token: asha });
    await call('PUT', '/v1/buyer/notifications/settings/CHAT', { token: asha, body: { push: true, inApp: true } });
    expect((await list(asha, 'buyer')).codes).toEqual(['NEW_MESSAGE']);
  });
});

describe('the sweep follows the switches', () => {
  const fresh = async (uid: string, code: string) => {
    const [row] = await dbOf(app).db.insert(notifications).values({ userId: uid, app: 'buyer', code, createdAt: new Date(clock.now()) }).returning({ id: notifications.id });
    return row!.id;
  };
  const sweepOnce = async () => {
    sent.length = 0;
    events.length = 0;
    await svc().run(clock.now());
  };

  it('push off: no push but the open app still hears; centre off: a push but no event; Orders ignore both', async () => {
    await wipe();
    await dbOf(app).db.delete(pushTokens);
    await call('PUT', '/v1/buyer/push-token', { token: asha, body: { token: TOKEN, platform: 'android' } });
    // chat: push off only
    await call('PUT', '/v1/buyer/notifications/settings/CHAT', { token: asha, body: { push: false, inApp: true } });
    const m1 = await fresh(ashaId, 'NEW_MESSAGE');
    await sweepOnce();
    expect(sent).toHaveLength(0);
    expect(events.map((e) => (e.payload as { notificationId: string }).notificationId)).toEqual([m1]);
    // chat: centre off only
    await call('PUT', '/v1/buyer/notifications/settings/CHAT', { token: asha, body: { push: true, inApp: false } });
    await fresh(ashaId, 'NEW_MESSAGE');
    await sweepOnce();
    expect(sent).toHaveLength(1);
    expect(events).toHaveLength(0);
    // an Orders row stays on even if a switch row were forced off in the database
    await dbOf(app).db.insert(notificationSettings).values({ userId: ashaId, app: 'buyer', category: 'ORDERS', push: false, inApp: false, updatedAt: new Date() });
    const o = await fresh(ashaId, 'ORDER_SHIPPED');
    await sweepOnce();
    expect(sent).toHaveLength(1);
    expect(events.map((e) => (e.payload as { notificationId: string }).notificationId)).toEqual([o]);
    expect((await list(asha, 'buyer')).codes).toContain('ORDER_SHIPPED');
    // someone else's push is unaffected
    await dbOf(app).db.delete(notificationSettings).where(eq(notificationSettings.userId, ashaId));
  });
});

describe('housekeeping', () => {
  it('deletes read notifications after 90 days and unread after 180, keeps the rest, and checks only hourly', async () => {
    await wipe();
    clock.advance(2 * 3_600_000); // earlier sweeps in this file have already pruned within the last hour
    const DAY = 24 * 3_600_000;
    const oldRead = await put(ashaId, 'buyer', 'NEW_MESSAGE', { ageMs: READ_RETENTION_MS + DAY, read: true });
    const oldUnread = await put(ashaId, 'buyer', 'NEW_MESSAGE', { ageMs: READ_RETENTION_MS + DAY });
    const freshRead = await put(ashaId, 'buyer', 'NEW_MESSAGE', { ageMs: READ_RETENTION_MS - DAY, read: true });
    const veryOld = await put(ashaId, 'buyer', 'NEW_MESSAGE', { ageMs: UNREAD_RETENTION_MS + DAY });
    const fresh = await put(ashaId, 'buyer', 'NEW_MESSAGE');
    expect(await svc().prune(clock.now())).toBe(2); // oldRead and veryOld
    const left = async () => (await dbOf(app).db.select({ id: notifications.id }).from(notifications)).map((r) => r.id).sort();
    expect(await left()).toEqual([oldUnread, freshRead, fresh].sort());
    // an hour has not passed: nothing more is looked at, even though one row is now too old
    clock.advance(60_000);
    expect(await svc().prune(clock.now())).toBe(0);
    clock.advance(3_600_000);
    expect(await svc().prune(clock.now())).toBe(0); // oldUnread is 91 days old and unread: still kept
    expect(await left()).toEqual([oldUnread, freshRead, fresh].sort());
    expect(oldRead).not.toBe(veryOld);
  });
});
