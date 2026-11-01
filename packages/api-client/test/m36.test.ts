import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/client';
import { ALL_LIVE_KEYS, COMMENTS_KEY, invalidationFor, queryKeys } from '../src/keys';

const json = (status: number, body: unknown) => (status === 204 ? new Response(null, { status }) : new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const id = '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70';
const spy = (body: unknown, status = 200) => {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];
  const c = createApiClient({
    baseUrl: 'http://api.test',
    getAccessToken: () => 'tok',
    fetch: async (u, init) => {
      const i = init as RequestInit;
      calls.push({ url: String(u), method: i.method ?? 'GET', headers: i.headers as Record<string, string>, ...(i.body ? { body: JSON.parse(String(i.body)) } : {}) });
      return json(status, body);
    },
  });
  return { c, calls };
};
const comment = { id, text: 'Is it true to size?', at: 1, author: { name: 'Asha', shop: false }, mine: true, canRemove: true };

describe('likes and saves', () => {
  it('like and unlike use PUT and DELETE on the listing and parse the real count', async () => {
    const { c, calls } = spy({ liked: true, likeCount: 3 });
    expect(await c.likeListing(id)).toEqual({ liked: true, likeCount: 3 });
    await c.unlikeListing(id);
    expect(calls.map((x) => `${x.method} ${x.url}`)).toEqual([`PUT http://api.test/v1/buyer/listings/${id}/like`, `DELETE http://api.test/v1/buyer/listings/${id}/like`]);
  });
  it('save and unsave use PUT and DELETE, and the Saved list pages with a cursor', async () => {
    const { c, calls } = spy({ saved: true });
    await c.saveListing(id);
    await c.unsaveListing(id);
    const page = spy({ items: [], nextCursor: null });
    await page.c.listSaved();
    await page.c.listSaved('abc', 10);
    expect(calls.map((x) => `${x.method} ${x.url}`)).toEqual([`PUT http://api.test/v1/buyer/listings/${id}/save`, `DELETE http://api.test/v1/buyer/listings/${id}/save`]);
    expect(page.calls.map((x) => x.url)).toEqual(['http://api.test/v1/buyer/saved', 'http://api.test/v1/buyer/saved?limit=10&cursor=abc']);
  });
});

describe('comments', () => {
  it('reads a page on the audience route of the app asking', async () => {
    const { c, calls } = spy({ items: [comment], nextCursor: 'n1', total: 4 });
    expect((await c.listComments('buyer', id, null, 20)).total).toBe(4);
    await c.listComments('seller', id, 'n1');
    expect(calls.map((x) => x.url)).toEqual([`http://api.test/v1/buyer/listings/${id}/comments?limit=20`, `http://api.test/v1/seller/listings/${id}/comments?cursor=n1`]);
  });
  it('posts with the idempotency key and the client key, and removes with DELETE', async () => {
    const { c, calls } = spy(comment, 201);
    expect((await c.postComment('buyer', id, { text: 'Hello there', clientKey: 'client-key-1' }, 'idem-key-001')).author.name).toBe('Asha');
    await c.postComment('seller', id, { text: 'Thanks!' });
    expect(calls[0]).toMatchObject({ method: 'POST', url: `http://api.test/v1/buyer/listings/${id}/comments`, headers: expect.objectContaining({ 'idempotency-key': 'idem-key-001' }), body: { text: 'Hello there', clientKey: 'client-key-1' } });
    expect(calls[1]!.url).toBe(`http://api.test/v1/seller/listings/${id}/comments`);
    const del = spy(null, 204);
    await del.c.removeComment('seller', id);
    expect(`${del.calls[0]!.method} ${del.calls[0]!.url}`).toBe(`DELETE http://api.test/v1/seller/comments/${id}`);
  });
  it('drops fields the comment schema does not name (a user id cannot reach the app)', async () => {
    const { c } = spy({ ...comment, authorUserId: 'secret-user-id', authorPhone: '9000000000' });
    expect(JSON.stringify(await c.postComment('buyer', id, { text: 'x1' }))).not.toMatch(/secret|9000000000/);
  });
  it('a new comment on a seller’s listing refreshes comments and the seller’s listings', () => {
    expect(invalidationFor({ name: 'comment.created', listingId: id, commentId: id })).toEqual(expect.arrayContaining([COMMENTS_KEY, 'seller-listings']));
    expect(ALL_LIVE_KEYS).toContain(COMMENTS_KEY);
    expect(queryKeys.comments('buyer', 'http://api.test', id)).toEqual([COMMENTS_KEY, 'buyer', 'http://api.test', id]);
  });
});
