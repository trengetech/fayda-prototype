import { describe, expect, it } from 'vitest';
import { BuyerFeedSchema, CommentQuerySchema, PostCommentSchema, BuyerNegotiationSchema, CounterSchema, ERROR_CODES, FeedQuerySchema, ShopViewSchema, HealthSchema, ListingInputSchema, MediaIntentSchema, MetaSchema, PaiseSchema, ProblemSchema, StartOfferSchema, buildOpenApiDocument } from '../src/index.js';

describe('system contracts', () => {
  it('accepts a healthy response and a database-down response', () => {
    const up = { status: 'ok', database: { status: 'up', latencyMs: 12 }, time: new Date().toISOString() };
    const down = { status: 'down', database: { status: 'down', latencyMs: null }, time: new Date().toISOString() };
    expect(HealthSchema.safeParse(up).success).toBe(true);
    expect(HealthSchema.safeParse(down).success).toBe(true);
  });
  it('rejects a malformed health response', () => {
    expect(HealthSchema.safeParse({ status: 'fine', database: {}, time: 'now' }).success).toBe(false);
  });
  it('requires a simulated flag on every provider', () => {
    const ok = { environment: 'development', version: '0.0.0', providers: [{ key: 'auth', name: 'dev-otp', simulated: true }] };
    expect(MetaSchema.safeParse(ok).success).toBe(true);
    const missing = { ...ok, providers: [{ key: 'auth', name: 'dev-otp' }] };
    expect(MetaSchema.safeParse(missing).success).toBe(false);
  });
});

describe('common contracts', () => {
  it('money is integer paise', () => {
    expect(PaiseSchema.safeParse(250000).success).toBe(true);
    expect(PaiseSchema.safeParse(2500.5).success).toBe(false);
    expect(PaiseSchema.safeParse(-1).success).toBe(false);
  });
  it('problem bodies carry a stable error code', () => {
    expect(ProblemSchema.safeParse({ title: 'Not found', status: 404, code: 'NOT_FOUND' }).success).toBe(true);
    expect(ProblemSchema.safeParse({ title: 'x', status: 400, code: 'MADE_UP' }).success).toBe(false);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe('OpenAPI', () => {
  const doc = buildOpenApiDocument('0.0.0');
  it('is generated from the Zod contracts', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths ?? {}).sort()).toEqual(
      [
        '/v1/auth/logout', '/v1/auth/otp/request', '/v1/auth/otp/verify', '/v1/auth/refresh', '/v1/buyer/addresses', '/v1/buyer/addresses/{id}', '/v1/buyer/addresses/{id}/default', '/v1/buyer/feed', '/v1/buyer/feed/facets', '/v1/buyer/follows', '/v1/buyer/follows/sellers/{sellerId}', '/v1/buyer/listings/{id}',
        '/v1/buyer/comments/{id}', '/v1/buyer/listings/{id}/comments', '/v1/buyer/listings/{id}/like', '/v1/buyer/listings/{id}/save', '/v1/buyer/saved',
        '/v1/buyer/listings/{id}/offers', '/v1/buyer/negotiations', '/v1/buyer/negotiations/{id}', '/v1/buyer/negotiations/{id}/accept',
        '/v1/buyer/negotiations/{id}/counter', '/v1/buyer/negotiations/{id}/decline', '/v1/buyer/negotiations/{id}/withdraw',
        '/v1/buyer/orders', '/v1/buyer/orders/{id}', '/v1/buyer/orders/{id}/payment-qr', '/v1/buyer/orders/{id}/review',
        '/v1/buyer/profile', '/v1/buyer/profile/contact', '/v1/buyer/requests', '/v1/buyer/requests/reach', '/v1/buyer/requests/{id}',
        '/v1/buyer/requests/{id}/close', '/v1/buyer/shops/{handle}', '/v1/buyer/shops/{handle}/listings', '/v1/buyer/responses/{id}/decline', '/v1/buyer/responses/{id}/want', '/v1/buyer/threads',
        '/v1/buyer/threads/photos/{mediaId}', '/v1/buyer/threads/{id}', '/v1/buyer/threads/{id}/messages', '/v1/buyer/threads/{id}/read', '/v1/health', '/v1/me',
        '/v1/media/upload/{id}', '/v1/media/{id}', '/v1/meta', '/v1/seller/listings', '/v1/seller/listings/{id}',
        '/v1/seller/comments/{id}', '/v1/seller/listings/{id}/comments',
        '/v1/seller/listings/{id}/status', '/v1/seller/media/intents', '/v1/seller/media/{id}/complete', '/v1/seller/negotiations',
        '/v1/seller/negotiations/{id}', '/v1/seller/negotiations/{id}/accept', '/v1/seller/negotiations/{id}/counter',
        '/v1/seller/negotiations/{id}/decline', '/v1/seller/orders', '/v1/seller/orders/{id}', '/v1/seller/orders/{id}/cancel',
        '/v1/seller/orders/{id}/confirm', '/v1/seller/orders/{id}/deliver', '/v1/seller/orders/{id}/ship', '/v1/seller/payment',
        '/v1/seller/profile', '/v1/seller/record', '/v1/seller/requests', '/v1/seller/requests/{id}/responses', '/v1/seller/reviews',
        '/v1/seller/threads', '/v1/seller/threads/photos/{mediaId}', '/v1/seller/threads/{id}', '/v1/seller/threads/{id}/messages', '/v1/seller/threads/{id}/read',
        '/v1/shops/{id}/record', '/v1/shops/{id}/reviews',
      ].sort(),
    );
  });
  it('marks signed-in routes as needing a bearer token', () => {
    expect(JSON.stringify(doc.paths?.['/v1/me'])).toContain('bearerAuth');
    expect(JSON.stringify(doc.paths?.['/v1/auth/otp/verify'])).not.toContain('bearerAuth');
  });
  it('documents the 503 health response and the simulated flag', () => {
    expect(JSON.stringify(doc.paths?.['/v1/health'])).toContain('503');
    expect(JSON.stringify(doc.components?.schemas)).toContain('simulated');
  });
});

describe('listing and media contracts', () => {
  const listing = { title: 'Kurta', category: 'Ethnic wear', price: 150000, media: [], variants: [], bargaining: { mode: 'BUY_NOW', expiryMinutes: 1440 }, checkout: { channel: 'DIRECT' } };
  it('saves a draft unless the app says publish', () => {
    expect(ListingInputSchema.parse(listing).publish).toBe(false);
    expect(ListingInputSchema.parse({ ...listing, publish: true }).publish).toBe(true);
  });
  it('rejects ids that are not UUIDs and oversized lists', () => {
    expect(ListingInputSchema.safeParse({ ...listing, media: [{ mediaId: 'abc' }] }).success).toBe(false);
    expect(ListingInputSchema.safeParse({ ...listing, variants: Array.from({ length: 31 }, () => ({ label: 'M', stock: 1 })) }).success).toBe(false);
  });
  it('lets the upload address be a path on the API or a full address, and always PUT', () => {
    const base = { mediaId: '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70', expiresAt: 1 };
    expect(MediaIntentSchema.safeParse({ ...base, upload: { method: 'PUT', url: '/v1/media/upload/x', headers: {} } }).success).toBe(true);
    expect(MediaIntentSchema.safeParse({ ...base, upload: { method: 'POST', url: '/x', headers: {} } }).success).toBe(false);
  });
  it('strips anything a buyer schema does not name, so private fields cannot slip through', () => {
    const seller = { id: 's', name: 'n', handle: 'h', area: 'a', city: 'c', rating: null, reviewCount: 0 };
    const parsed = BuyerFeedSchema.parse({ items: [{ id: 'l', title: 't', price: 1, category: 'c', soldOut: false, acceptsOffers: true, coverUrl: null, hasVideo: false, video: null, following: false, ownShop: false, likeCount: 0, commentCount: 0, liked: false, saved: false, seller, rules: { autoAcceptAt: 1 }, dealCodes: { accept: 'X' } }], nextCursor: null });
    expect(JSON.stringify(parsed)).not.toMatch(/rules|dealCodes|autoAccept/);
  });
});

describe('social contracts', () => {
  it('accepts a comment of any length at the edge and leaves the length rule to the domain', () => {
    expect(PostCommentSchema.safeParse({ text: 'Is this available?' }).success).toBe(true);
    expect(PostCommentSchema.safeParse({ text: 'x'.repeat(2001) }).success).toBe(false);
    expect(PostCommentSchema.safeParse({ text: 'hi', clientKey: 'short' }).success).toBe(false);
  });
  it('reads comment paging from strings and refuses an oversized page', () => {
    expect(CommentQuerySchema.parse({ limit: '20' })).toEqual({ limit: 20 });
    expect(CommentQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
  });
});

describe('discovery contracts', () => {
  it('reads the feed query from strings, and refuses an unknown scope, sort or page size', () => {
    expect(FeedQuerySchema.parse({ scope: 'FOLLOWING', minPrice: '50000', acceptsOffers: 'true', limit: '20', sort: 'PRICE_LOW' })).toEqual({ scope: 'FOLLOWING', minPrice: 50000, acceptsOffers: true, limit: 20, sort: 'PRICE_LOW' });
    expect(FeedQuerySchema.parse({ acceptsOffers: 'false' }).acceptsOffers).toBe(false);
    expect(FeedQuerySchema.safeParse({ scope: 'EVERYONE' }).success).toBe(false);
    expect(FeedQuerySchema.safeParse({ sort: 'RANDOM' }).success).toBe(false);
    expect(FeedQuerySchema.safeParse({ limit: '500' }).success).toBe(false);
    expect(FeedQuerySchema.safeParse({ minPrice: '-1' }).success).toBe(false);
  });

  it('a shop page carries no contact numbers or payment details even if the server sent them', () => {
    const record = { orders: 0, completed: 0, confirmed: 0, cancelled: 0, expired: 0, medianConfirmMs: null, rating: null, reviewCount: 0 };
    const shop = { id: 's', name: 'n', handle: 'h', bio: '', area: 'a', city: 'c', categories: [], mapsUrl: 'https://m', googleProfileUrl: null, socialUrl: null, slaConfirmHours: 4, slaShipDays: 2, record, followerCount: 0, listingCount: 0, following: false, isOwn: false };
    const parsed = ShopViewSchema.parse({ ...shop, contactPhone: '9000000000', contactWhatsapp: '9000000001', upiId: 'x@upi' });
    expect(JSON.stringify(parsed)).not.toMatch(/9000000|upi|contact/i);
  });
});

describe('negotiation contracts', () => {
  it('accepts whole-paise offers and refuses a missing size', () => {
    expect(StartOfferSchema.safeParse({ variantId: '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70', amount: 120000 }).success).toBe(true);
    expect(StartOfferSchema.safeParse({ amount: 120000 }).success).toBe(false);
    expect(StartOfferSchema.safeParse({ variantId: 'x', amount: 120000 }).success).toBe(false);
    expect(CounterSchema.safeParse({ amount: -5 }).success).toBe(false);
  });

  it('gives the buyer a view with no field that could carry a private rule or an automatic marker', () => {
    const keys = Object.keys(BuyerNegotiationSchema.shape);
    for (const forbidden of ['rules', 'autoAcceptAt', 'autoCounterAt', 'autoDeclineBelow', 'autoCounterDueAt', 'autoDeclineAt', 'dealCodes', 'by', 'visibility']) expect(keys).not.toContain(forbidden);
    // Offers show only "ME" or "SELLER": a rule's reply is a seller reply.
    const offer = BuyerNegotiationSchema.shape.offers.element.shape.side;
    expect(offer.safeParse('SYSTEM').success).toBe(false);
    expect(offer.safeParse('SELLER').success).toBe(true);
  });
});
