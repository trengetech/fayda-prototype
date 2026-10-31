import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError, createApiClient } from '../src/client';

const json = (status: number, body: unknown, type = 'application/json') => new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
const health = { status: 'ok', database: { status: 'up', latencyMs: 20 }, time: '2026-10-31T10:00:00.000Z' };
const meta = { environment: 'development', version: '0.0.0', providers: [{ key: 'auth', name: 'dev-otp', simulated: true }] };
const client = (f: typeof fetch) => createApiClient({ baseUrl: 'http://api.test/', fetch: f, timeoutMs: 200 });

describe('api client', () => {
  it('parses health and meta, and trims the trailing slash', async () => {
    const urls: string[] = [];
    const c = client(async (u) => { urls.push(String(u)); return String(u).endsWith('health') ? json(200, health) : json(200, meta); });
    expect((await c.getHealth()).database.latencyMs).toBe(20);
    expect((await c.getMeta()).providers[0]?.simulated).toBe(true);
    expect(urls).toEqual(['http://api.test/v1/health', 'http://api.test/v1/meta']);
  });

  it('returns a 503 health body as data (database down), not an error', async () => {
    const down = { status: 'down', database: { status: 'down', latencyMs: null }, time: health.time };
    expect((await client(async () => json(503, down)).getHealth()).status).toBe('down');
  });

  it('turns problem+json into an ApiError with its code', async () => {
    const p = { title: 'Not found', status: 404, code: 'NOT_FOUND', detail: 'Cannot GET /v1/meta' };
    const err = await client(async () => json(404, p, 'application/problem+json')).getMeta().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).problem?.code).toBe('NOT_FOUND');
    expect((err as ApiError).message).toBe('Cannot GET /v1/meta');
  });

  it('rejects data in the wrong shape', async () => {
    const err = await client(async () => json(200, { status: 'fine' })).getHealth().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
  });

  it('reports an unreadable body', async () => {
    const err = await client(async () => new Response('<html>', { status: 502 })).getHealth().catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'ApiError', status: 502 });
  });

  it('reports a network failure and a timeout as NetworkError', async () => {
    const off = await client(async () => { throw new TypeError('Network request failed'); }).getHealth().catch((e: unknown) => e);
    expect(off).toBeInstanceOf(NetworkError);
    const slow: typeof fetch = (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    const timeout = await client(slow).getHealth().catch((e: unknown) => e);
    expect(timeout).toBeInstanceOf(NetworkError);
    expect((timeout as Error).message).toContain('No answer');
  });
});

describe('media and listings', () => {
  const listing = {
    id: '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70', status: 'DRAFT', title: 'Kurta', description: '', category: 'Ethnic wear', price: 150000, media: [],
    variants: [{ id: 'v1', label: 'M', stock: 2 }], bargaining: { mode: 'FIXED', expiryHours: 24 },
    rules: { autoAcceptAt: null, autoDeclineBelow: null, autoCounterAt: null }, checkout: { channel: 'DIRECT', productUrl: null },
    dealCodes: { accept: null, counter: null }, publishedAt: null, updatedAt: 1,
  };
  const input = { title: 'Kurta', category: 'Ethnic wear', price: 150000, media: [], variants: [{ label: 'M', stock: 2 }], bargaining: { mode: 'FIXED', expiryHours: 24 }, checkout: { channel: 'DIRECT' }, publish: false };
  const authed = (f: typeof fetch) => createApiClient({ baseUrl: 'http://api.test', fetch: f, getAccessToken: () => 'tok' });

  it('sends the idempotency key and bearer token on a create, and parses the listing', async () => {
    let seen: RequestInit | undefined;
    const c = authed(async (_u, init) => { seen = init; return json(201, listing); });
    expect((await c.createListing(input, 'key-1234567')).id).toBe(listing.id);
    expect(seen?.method).toBe('POST');
    expect(seen?.headers).toMatchObject({ authorization: 'Bearer tok', 'idempotency-key': 'key-1234567' });
  });

  it('leaves the key out when none is given, and PUTs updates to the listing’s address', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const c = authed(async (u, init) => { calls.push({ url: String(u), init: init as RequestInit }); return json(200, listing); });
    await c.updateListing(listing.id, input);
    expect(calls[0]?.url).toBe(`http://api.test/v1/seller/listings/${listing.id}`);
    expect(calls[0]?.init.method).toBe('PUT');
    expect(calls[0]?.init.headers).not.toHaveProperty('idempotency-key');
  });

  it('lists listings from the wrapped response, and treats a delete as empty', async () => {
    expect(await authed(async () => json(200, { items: [listing] })).listSellerListings()).toHaveLength(1);
    expect(await authed(async () => new Response(null, { status: 204 })).deleteListingDraft(listing.id)).toBeUndefined();
  });

  it('surfaces field errors from a refused save', async () => {
    const p = { title: 'Bad request', status: 400, code: 'VALIDATION', detail: 'Check the highlighted fields.', fields: { price: 'Enter a whole-rupee price.' } };
    const err = await authed(async () => json(400, p, 'application/problem+json')).createListing(input).catch((e: unknown) => e);
    expect((err as ApiError).problem?.fields).toEqual({ price: 'Enter a whole-rupee price.' });
  });

  it('turns an API path into a full address, and leaves full addresses alone', () => {
    const c = authed(async () => json(200, {}));
    expect(c.resolveUrl('/v1/media/abc')).toBe('http://api.test/v1/media/abc');
    expect(c.resolveUrl('https://cdn.example/x')).toBe('https://cdn.example/x');
  });

  it('parses an upload intent', async () => {
    const intent = { mediaId: listing.id, upload: { method: 'PUT', url: '/v1/media/upload/x?token=t', headers: { 'Content-Type': 'image/jpeg' } }, expiresAt: 5 };
    const c = authed(async () => json(201, intent));
    expect((await c.createMediaIntent({ kind: 'image', purpose: 'LISTING', mime: 'image/jpeg', size: 10 })).upload.url).toContain('/v1/media/upload/');
  });
});
