import { CONTRACT_LEVEL } from '@fayda/contracts/schemas';
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
    id: '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70', status: 'DRAFT', title: 'Kurta', description: '', category: 'Ethnic wear', tags: [], price: 150000, media: [],
    variants: [{ id: 'v1', label: 'M', stock: 2 }], bargaining: { mode: 'BUY_NOW', expiryMinutes: 1440 },
    rules: { autoAcceptAt: null, autoDeclineBelow: null, autoCounterAt: null }, checkout: { channel: 'DIRECT', productUrl: null },
    dealCodes: { accept: null, counter: null }, publishedAt: null, updatedAt: 1, stats: { likes: 0, saves: 0, comments: 0 },
  };
  const input = { title: 'Kurta', category: 'Ethnic wear', tags: [], price: 150000, media: [], variants: [{ label: 'M', stock: 2 }], bargaining: { mode: 'BUY_NOW', expiryMinutes: 1440 }, checkout: { channel: 'DIRECT' }, publish: false };
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
  it('asks for the next feed page with the cursor, and parses the page', async () => {
    const seller = { id: 's1', name: 'Kiran Studio', handle: 'kiranstudio', area: 'Madhapur', city: 'Hyderabad', rating: null, reviewCount: 0 };
    const item = { id: listing.id, title: 'Cotton kurta', price: 150000, category: 'Ethnic wear', soldOut: false, acceptsOffers: true, coverUrl: '/v1/media/m1', hasVideo: false, video: null, following: false, ownShop: false, likeCount: 0, commentCount: 0, liked: false, saved: false, seller };
    const urls: string[] = [];
    const c = authed(async (u) => { urls.push(String(u)); return json(200, { items: [item], nextCursor: 'abc' }); });
    expect((await c.getBuyerFeed()).nextCursor).toBe('abc');
    await c.getBuyerFeed({ cursor: 'abc', limit: 5 });
    expect(urls).toEqual(['http://api.test/v1/buyer/feed', 'http://api.test/v1/buyer/feed?limit=5&cursor=abc']);
  });

  it('builds a stable feed address from search, filters and sort, leaving empty values out', async () => {
    const urls: string[] = [];
    const c = authed(async (u) => { urls.push(String(u)); return json(200, { items: [], nextCursor: null }); });
    await c.getBuyerFeed({ scope: 'FOLLOWING', q: '  red   kurta ', category: 'Ethnic wear', minPrice: 50000, maxPrice: 0, size: '', acceptsOffers: false, sort: 'PRICE_LOW', cursor: 'c1', limit: 10 });
    await c.getBuyerFeed({ sort: 'NEWEST', q: '' });
    await c.getShopListings('anita.shop', { acceptsOffers: true });
    expect(urls).toEqual([
      'http://api.test/v1/buyer/feed?scope=FOLLOWING&q=red+kurta&category=Ethnic+wear&minPrice=50000&maxPrice=0&sort=PRICE_LOW&limit=10&cursor=c1',
      'http://api.test/v1/buyer/feed?sort=NEWEST',
      'http://api.test/v1/buyer/shops/anita.shop/listings?acceptsOffers=true',
    ]);
  });

  it('follows and unfollows with PUT and DELETE, and reads shops and facets', async () => {
    const calls: { url: string; method?: string }[] = [];
    const bodies: Record<string, unknown> = {
      '/v1/buyer/follows/sellers/s1': { following: true, followerCount: 3 },
      '/v1/buyer/feed/facets': { categories: ['Ethnic wear'], sizes: ['m'], minPrice: 40000, maxPrice: 500000 },
      '/v1/buyer/follows': { items: [{ id: 's1', name: 'Anita', handle: 'anita', area: 'Tolichowki', city: 'Hyderabad', followedAt: 1 }], nextCursor: null },
    };
    const c = authed(async (u, init) => { calls.push({ url: String(u), method: init?.method }); return json(200, bodies[new URL(String(u)).pathname]); });
    expect(await c.followSeller('s1')).toEqual({ following: true, followerCount: 3 });
    await c.unfollowSeller('s1');
    expect((await c.getFeedFacets()).sizes).toEqual(['m']);
    expect((await c.listFollows()).items[0]?.handle).toBe('anita');
    expect(calls.map((x) => `${x.method ?? 'GET'} ${new URL(x.url).pathname}`)).toEqual(['PUT /v1/buyer/follows/sellers/s1', 'DELETE /v1/buyer/follows/sellers/s1', 'GET /v1/buyer/feed/facets', 'GET /v1/buyer/follows']);
  });

  it('drops a private field the buyer schema does not list', async () => {
    const seller = { id: 's1', name: 'Kiran Studio', handle: 'kiranstudio', area: 'Madhapur', city: 'Hyderabad', rating: null, reviewCount: 0, slaConfirmHours: 24, slaShipDays: 3, categories: ['Ethnic wear'], record: { orders: 0, completed: 0, confirmed: 0, cancelled: 0, expired: 0, medianConfirmMs: null, rating: null, reviewCount: 0 } };
    const page = { id: listing.id, title: 'Cotton kurta', description: '', category: 'Ethnic wear', tags: [], price: 150000, soldOut: false, likeCount: 0, commentCount: 0, viewCount: 0, liked: false, saved: false, ownListing: false, media: [], variants: [{ id: 'v1', label: 'M', available: true, low: false }], bargaining: { mode: 'BOTH', acceptsOffers: true, expiryMinutes: 1440 }, checkout: { channel: 'DIRECT', productUrl: null, payMethods: ['UPI'] }, seller };
    const got = await authed(async () => json(200, { ...page, rules: { autoAcceptAt: 120000 } })).getBuyerListing(listing.id);
    expect(got).not.toHaveProperty('rules'); // the buyer schema drops anything it does not list
  });
});

describe('version check', () => {
  const seen = () => {
    const headers: Record<string, string>[] = [];
    const f: typeof fetch = async (_u, init) => {
      headers.push((init?.headers ?? {}) as Record<string, string>);
      return json(200, meta);
    };
    return { headers, f };
  };

  it('says which app it is and the contract level it was built with, only when it knows its app', async () => {
    const a = seen();
    await createApiClient({ baseUrl: 'http://api.test', fetch: a.f, clientApp: 'seller' }).getMeta();
    expect(a.headers[0]).toMatchObject({ 'x-client-app': 'seller', 'x-client-level': String(CONTRACT_LEVEL) });
    const b = seen();
    await createApiClient({ baseUrl: 'http://api.test', fetch: b.f }).getMeta();
    expect(b.headers[0]).not.toHaveProperty('x-client-app');
    expect(b.headers[0]).not.toHaveProperty('x-client-level');
  });

  it('recognises “this app is too old” from the 426 answer', async () => {
    const p = { title: 'Upgrade required', status: 426, code: 'CLIENT_TOO_OLD', detail: 'This version of the app is too old to work with the server. Please update the app.' };
    const err = (await client(async () => json(426, p, 'application/problem+json')).getBuyerFeed().catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.updateRequired).toBe(true);
    expect(err.message).toMatch(/update the app/i);
    const other = (await client(async () => json(404, { title: 'Not found', status: 404, code: 'NOT_FOUND' }, 'application/problem+json')).getBuyerFeed().catch((e: unknown) => e)) as ApiError;
    expect(other.updateRequired).toBe(false);
  });

  it('a response in the wrong shape tells the person the app may be out of date', async () => {
    const err = (await client(async () => json(200, { status: 'fine' })).getHealth().catch((e: unknown) => e)) as ApiError;
    expect(err.message).toMatch(/unexpected shape/);
    expect(err.message).toMatch(/out of date/i);
    expect(err.updateRequired).toBe(false);
  });
});
