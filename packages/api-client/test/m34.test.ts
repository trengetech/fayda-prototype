import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/client';
import { ALL_LIVE_KEYS, invalidationFor, queryKeys } from '../src/keys';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const id = '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70';
interface Seen { url: string; init: RequestInit }
const spy = (body: unknown, status = 200) => {
  const calls: Seen[] = [];
  const c = createApiClient({ baseUrl: 'http://api.test', getAccessToken: () => 'tok', fetch: async (u, init) => (calls.push({ url: String(u), init: init as RequestInit }), json(status, body)) });
  return { c, calls };
};
const record = { orders: 3, completed: 1, confirmed: 2, cancelled: 0, expired: 0, medianConfirmMs: 1000, rating: 4.5, reviewCount: 2 };
const order = {
  id, number: 'FD-100001', status: 'PLACED', statusLabel: 'Placed',
  listing: { id, title: 'Kurta', coverUrl: null, variantLabel: 'M', channel: 'DIRECT' },
  price: 150000, listPrice: 160000, priceSource: 'LIST', channel: 'DIRECT', paymentMethod: 'UPI', dealAccess: null, address: null,
  createdAt: 1, confirmBy: 2, confirmedAt: null, shipment: null, cancelText: null,
  seller: { id, name: 'Kiran', area: 'Banjara Hills', slaConfirmHours: 6, slaShipDays: 2, record, contact: null },
  payment: null, review: null, canReview: false, buyAgain: null, threadId: null, unread: 0,
};
const thread = { id, kind: 'ORDER', title: 'FD-100001', otherName: 'Kiran', orderId: id, requestId: null, unread: 0, lastMessage: null, lastAt: 1, messages: [] };

describe('orders', () => {
  it('places an order with the idempotency key, and the same key twice sends the same header', async () => {
    const { c, calls } = spy(order, 201);
    const input = { listingId: id, variantId: id, addressId: id, paymentMethod: 'UPI' as const };
    expect((await c.placeOrder(input, 'order-key-1')).number).toBe('FD-100001');
    await c.placeOrder(input, 'order-key-1');
    expect(calls.map((x) => x.url)).toEqual(['http://api.test/v1/buyer/orders', 'http://api.test/v1/buyer/orders']);
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual(input);
    expect(calls.map((x) => (x.init.headers as Record<string, string>)['idempotency-key'])).toEqual(['order-key-1', 'order-key-1']);
    expect(calls[0]?.init.headers).toMatchObject({ authorization: 'Bearer tok' });
  });

  it('reads the buyer order list and one order', async () => {
    const list = spy({ items: [order], unread: 0 });
    expect((await list.c.listBuyerOrders()).items).toHaveLength(1);
    expect(list.calls[0]?.url).toBe('http://api.test/v1/buyer/orders');
    const one = spy(order);
    await one.c.getBuyerOrder(id);
    expect(one.calls[0]?.url).toBe(`http://api.test/v1/buyer/orders/${id}`);
  });

  it('saves a review with PUT and gives the payment QR as an image source with the token', async () => {
    const { c, calls } = spy(order);
    await c.putReview(id, { rating: 5, text: 'Great' }, 'review-key-1');
    expect(calls[0]).toMatchObject({ url: `http://api.test/v1/buyer/orders/${id}/review`, init: { method: 'PUT' } });
    expect(c.getPaymentQrSource(id)).toEqual({ uri: `http://api.test/v1/buyer/orders/${id}/payment-qr`, headers: { authorization: 'Bearer tok' } });
  });

  it('gives no authorization header for the QR when signed out', () => {
    const c = createApiClient({ baseUrl: 'http://api.test', fetch: async () => json(200, {}) });
    expect(c.getPaymentQrSource(id).headers).toEqual({});
  });

  it('gives a chat photo as an image source with the token, and none when signed out', () => {
    const { c } = spy(order);
    expect(c.getChatPhotoSource('/v1/buyer/threads/photos/abc')).toEqual({ uri: 'http://api.test/v1/buyer/threads/photos/abc', headers: { authorization: 'Bearer tok' } });
    const out = createApiClient({ baseUrl: 'http://api.test', fetch: async () => json(200, {}) });
    expect(out.getChatPhotoSource('/v1/seller/threads/photos/abc').headers).toEqual({});
  });

  it('the seller moves an order with the right routes and bodies', async () => {
    const seller = { ...order, buyerName: 'Asha', buyerContact: null, canConfirm: true, canShip: false, canDeliver: false, canCancel: true };
    delete (seller as Record<string, unknown>).seller;
    delete (seller as Record<string, unknown>).payment;
    delete (seller as Record<string, unknown>).canReview;
    delete (seller as Record<string, unknown>).buyAgain;
    delete (seller as Record<string, unknown>).listPrice;
    const { c, calls } = spy(seller);
    await c.confirmOrder(id, null, 'k-confirm-1');
    await c.shipOrder(id, { courier: 'DTDC' }, 'k-ship-0001');
    await c.deliverOrder(id, 'k-deliver-1');
    await c.cancelOrder(id, { reason: 'OUT_OF_STOCK' }, 'k-cancel-01');
    expect(calls.map((x) => x.url.replace('http://api.test/v1/seller/orders/' + id, ''))).toEqual(['/confirm', '/ship', '/deliver', '/cancel']);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ shipment: null });
    expect(JSON.parse(calls[1]?.init.body as string)).toEqual({ courier: 'DTDC' });
    expect(JSON.parse(calls[3]?.init.body as string)).toEqual({ reason: 'OUT_OF_STOCK' });
    expect((calls[2]?.init.headers as Record<string, string>)['idempotency-key']).toBe('k-deliver-1');
  });

  it('reads the seller record, own and public', async () => {
    const own = spy(record);
    await own.c.getSellerRecord();
    expect(own.calls[0]?.url).toBe('http://api.test/v1/seller/record');
    const pub = spy(record);
    await pub.c.getShopRecord(id);
    expect(pub.calls[0]?.url).toBe(`http://api.test/v1/shops/${id}/record`);
    expect(pub.calls[0]?.init.headers).not.toHaveProperty('authorization');
  });
});

describe('chat, requests, reviews, media', () => {
  it('sends a message with its client key in the body, and marks read, per side', async () => {
    const { c, calls } = spy(thread);
    await c.sendBuyerMessage(id, { text: 'Hi', clientKey: 'msg-key-0001' });
    await c.markSellerThreadRead(id);
    await c.getSellerThread(id);
    expect(calls[0]).toMatchObject({ url: `http://api.test/v1/buyer/threads/${id}/messages`, init: { method: 'POST' } });
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ text: 'Hi', clientKey: 'msg-key-0001' });
    expect(calls[1]?.url).toBe(`http://api.test/v1/seller/threads/${id}/read`);
    expect(calls[2]?.url).toBe(`http://api.test/v1/seller/threads/${id}`);
  });

  it('buyer request routes, including reach with an encoded category', async () => {
    const req = { id, category: 'Ethnic wear', title: 'Red kurta', description: null, size: null, budget: null, media: [], status: 'OPEN', expiresAt: 1, reachedCount: 0, createdAt: 1, responses: [] };
    const { c, calls } = spy(req);
    await c.createRequest({ category: 'Ethnic wear', title: 'Red kurta', mediaIds: [id] }, 'req-key-0001');
    await c.closeRequest(id);
    await c.wantResponse(id, 'want-key-001');
    await c.declineResponse(id);
    expect(calls.map((x) => x.url.replace('http://api.test', ''))).toEqual(['/v1/buyer/requests', `/v1/buyer/requests/${id}/close`, `/v1/buyer/responses/${id}/want`, `/v1/buyer/responses/${id}/decline`]);
    const reach = spy({ count: 7 });
    expect(await reach.c.getRequestReach('Ethnic wear')).toEqual({ count: 7 });
    expect(reach.calls[0]?.url).toBe('http://api.test/v1/buyer/requests/reach?category=Ethnic%20wear');
    const bad = spy({ nope: 1 });
    await expect(bad.c.getRequestReach('x')).rejects.toThrow(/unexpected shape/);
  });

  it('seller request routes and reviews', async () => {
    const list = spy({ items: [], newCount: 0 });
    await list.c.listSellerRequests();
    expect(list.calls[0]?.url).toBe('http://api.test/v1/seller/requests');
    const reviews = spy({ items: [], rating: null, reviewCount: 0 });
    await reviews.c.listSellerReviews();
    await reviews.c.getShopReviews(id);
    expect(reviews.calls.map((x) => x.url)).toEqual(['http://api.test/v1/seller/reviews', `http://api.test/v1/shops/${id}/reviews`]);
  });

  it('uploads through the buyer route when asked, and the seller route by default', async () => {
    const { c, calls } = spy({ mediaId: id, upload: { method: 'PUT', url: '/v1/media/upload/x', headers: {} }, expiresAt: 1 });
    const input = { kind: 'image', purpose: 'REVIEW', mime: 'image/jpeg', size: 10 };
    await c.createMediaIntent(input, 'buyer');
    await c.createMediaIntent({ ...input, purpose: 'LISTING' });
    expect(calls.map((x) => x.url)).toEqual(['http://api.test/v1/buyer/media/intents', 'http://api.test/v1/seller/media/intents']);
  });
});

describe('realtime invalidation', () => {
  it('maps each event to the query prefixes it makes stale', () => {
    expect(invalidationFor({ name: 'order.updated', orderId: id })).toEqual(expect.arrayContaining(['orders', 'threads', 'record']));
    expect(invalidationFor({ name: 'chat.updated', threadId: id })).toEqual(['threads', 'orders']);
    expect(invalidationFor({ name: 'request.updated', requestId: id })).toEqual(['requests', 'threads']);
    expect(invalidationFor({ name: 'negotiation.updated', negotiationId: id, listingId: id })).toEqual(['negotiations', 'buyer-listing']);
  });

  it('every prefix a socket event can invalidate is also refreshed on reconnect', () => {
    for (const e of [
      { name: 'order.updated', orderId: id },
      { name: 'chat.updated', threadId: id },
      { name: 'request.updated', requestId: id },
      { name: 'negotiation.updated', negotiationId: id, listingId: id },
    ] as const) for (const k of invalidationFor(e)) expect(ALL_LIVE_KEYS).toContain(k);
  });

  it('list keys are prefixes of their detail keys', () => {
    const list = queryKeys.orders('buyer', 'http://api.test');
    const one = queryKeys.order('buyer', 'http://api.test', id);
    expect(one.slice(0, list.length)).toEqual([...list]);
    expect(queryKeys.thread('seller', 'u', id)[0]).toBe('threads');
  });
});

describe('delivery addresses', () => {
  const profile = { name: 'Kiran', addresses: [{ id, name: 'K', line1: '7', line2: 'Miyapur', pin: '500049', city: 'Hyderabad', state: 'Telangana' }], defaultAddressId: id, contact: { phone: '9700012345', whatsapp: null }, agreementVersion: 'v', agreementAcceptedAt: 1, missing: [] };
  const input = { name: 'K', line1: '7', line2: 'Miyapur', pin: '500049', city: 'Hyderabad', state: 'Telangana' };
  it('adds, edits, deletes and sets the default with the right method and address', async () => {
    const { c, calls } = spy(profile);
    await c.addAddress({ ...input, makeDefault: true });
    await c.updateAddress(id, input);
    await c.deleteAddress(id);
    expect((await c.setDefaultAddress(id)).defaultAddressId).toBe(id);
    expect(calls.map((x) => `${x.init.method} ${x.url.replace('http://api.test', '')}`)).toEqual([
      'POST /v1/buyer/addresses',
      `PUT /v1/buyer/addresses/${id}`,
      `DELETE /v1/buyer/addresses/${id}`,
      `POST /v1/buyer/addresses/${id}/default`,
    ]);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ ...input, makeDefault: true });
    expect(calls.every((x) => (x.init.headers as Record<string, string>).authorization === 'Bearer tok')).toBe(true);
  });
  it('the profile key is shared, so the profile refreshes after an address change', () => {
    expect(queryKeys.buyerProfile('http://api.test')).toEqual(['buyer-profile', 'http://api.test']);
  });
});
