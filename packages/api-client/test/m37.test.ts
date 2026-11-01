import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/client';
import { ALL_LIVE_KEYS, NOTIFICATIONS_KEY, invalidationFor, notificationHref } from '../src/keys';

const json = (status: number, body: unknown) => (status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const spy = (body: unknown, status = 200) => {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  const c = createApiClient({
    baseUrl: 'http://api.test',
    getAccessToken: () => 'tok',
    fetch: async (u, init) => {
      const i = init as RequestInit;
      calls.push({ url: String(u), method: i.method ?? 'GET', ...(i.body ? { body: JSON.parse(String(i.body)) } : {}) });
      return json(status, body);
    },
  });
  return { c, calls };
};
const id = '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70';
const TOKEN = { token: 'ExponentPushToken[abcdefghijklmnopqrstuv]', platform: 'android' as const };

describe('notifications and push', () => {
  it('reads the centre on the audience route with a cursor, and the unread count', async () => {
    const { c, calls } = spy({ items: [], nextCursor: null, unread: 0 });
    await c.listNotifications('seller', 'abc', 10);
    await c.listNotifications('buyer');
    expect(calls.map((x) => x.url)).toEqual(['http://api.test/v1/seller/notifications?limit=10&cursor=abc', 'http://api.test/v1/buyer/notifications']);
    const u = spy({ unread: 3 });
    expect(await u.c.getUnreadCount('buyer')).toEqual({ unread: 3 });
    await u.c.markNotificationRead('buyer', id);
    await u.c.markAllNotificationsRead('buyer');
    expect(u.calls.map((x) => `${x.method} ${x.url}`)).toEqual(['GET http://api.test/v1/buyer/notifications/unread-count', `POST http://api.test/v1/buyer/notifications/${id}/read`, 'POST http://api.test/v1/buyer/notifications/read-all']);
  });
  it('registers and removes a push token with PUT and DELETE', async () => {
    const { c, calls } = spy(null, 204);
    await c.registerPushToken('seller', TOKEN);
    await c.removePushToken('seller', TOKEN);
    expect(calls).toEqual([
      { url: 'http://api.test/v1/seller/push-token', method: 'PUT', body: TOKEN },
      { url: 'http://api.test/v1/seller/push-token', method: 'DELETE', body: TOKEN },
    ]);
  });
  it('a notification event refreshes the notification queries, and they refresh on reconnect', () => {
    expect(invalidationFor({ name: 'notification.created', notificationId: 'n1' })).toEqual([NOTIFICATIONS_KEY]);
    expect(ALL_LIVE_KEYS).toContain(NOTIFICATIONS_KEY);
  });
  it('maps a target to the screen of each app', () => {
    expect(notificationHref('buyer', { kind: 'NEGOTIATION', id: 'n1' })).toBe('/negotiation/n1');
    expect(notificationHref('seller', { kind: 'NEGOTIATION', id: 'n1' })).toBe('/offer/n1');
    expect(notificationHref('seller', { kind: 'LISTING', id: 'l1' })).toBe('/comments/l1');
    expect(notificationHref('buyer', { kind: 'LISTING', id: 'l1' })).toBe('/listing/l1');
    expect(notificationHref('buyer', { kind: 'THREAD', id: 't1' })).toBe('/chat/t1');
    expect(notificationHref('seller', { kind: 'ORDER', id: 'o1' })).toBe('/order/o1');
    expect(notificationHref('seller', { kind: 'REQUEST', id: 'r1' })).toBe('/requests');
  });
});

describe('report, block and dashboard', () => {
  it('reports a comment and a message on the audience route', async () => {
    const { c, calls } = spy({ received: true }, 201);
    await c.reportComment('buyer', id, { reason: 'SPAM', note: null });
    await c.reportMessage('seller', 't1', 'm1', { reason: 'ABUSE', note: 'rude' });
    expect(calls.map((x) => `${x.method} ${x.url}`)).toEqual([`POST http://api.test/v1/buyer/comments/${id}/report`, 'POST http://api.test/v1/seller/threads/t1/messages/m1/report']);
    expect(calls[1]!.body).toEqual({ reason: 'ABUSE', note: 'rude' });
  });
  it('lists, blocks and unblocks without ever naming a user id', async () => {
    const one = { id: 'b1', name: 'Asha', since: 1 };
    const l = spy({ items: [one] });
    expect((await l.c.listBlocks('buyer')).items).toEqual([one]);
    const b = spy(one);
    expect(await b.c.blockPerson('seller', { source: 'THREAD', id })).toEqual(one);
    expect(b.calls[0]).toEqual({ url: 'http://api.test/v1/seller/blocks', method: 'PUT', body: { source: 'THREAD', id } });
    const u = spy(null, 204);
    await u.c.unblockPerson('seller', 'b1');
    expect(u.calls[0]).toMatchObject({ method: 'DELETE', url: 'http://api.test/v1/seller/blocks/b1' });
  });
  it('rejects a dashboard that is not the contract', async () => {
    const { c } = spy({ windows: [] });
    await expect(c.getSellerDashboard()).rejects.toThrow();
  });
});
