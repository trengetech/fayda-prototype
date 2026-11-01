import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { comments, notifications, saves } from '../src/db/schema.js';
import { makeCaller, type Caller, type Json } from './api.js';
import { makeBuyer, makeListing, makeShop, userId } from './community-helpers.js';
import { dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
let call: Caller;
let dir: string;

let anita: string; // seller, shop "anitasocial"
let ravi: string; // another seller
let asha: string; // buyers
let kiran: string;
let meena: string;
let kurta: { id: string }; // anita's listings
let saree: { id: string };
let shirt: { id: string }; // ravi's listing

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-social-'));
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir });
  call = makeCaller(app);
  anita = await makeShop(call, '9876503001', 'anitasocial', ['Ethnic wear']);
  ravi = await makeShop(call, '9876503002', 'ravisocial', ['Menswear']);
  asha = await makeBuyer(call, '9765403001', 'Asha Rao');
  kiran = await makeBuyer(call, '9765403002', 'Kiran Patel');
  meena = await makeBuyer(call, '9765403003', 'Meena Sharma');
  kurta = await makeListing(call, anita, { title: 'Social kurta' });
  saree = await makeListing(call, anita, { title: 'Social saree', price: 450000 });
  shirt = await makeListing(call, ravi, { title: 'Social shirt', category: 'Menswear' });
});
afterAll(async () => {
  await dbOf(app).db.execute(sql`truncate table users cascade`);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const card = async (token: string, title: string): Promise<Json> => (await call('GET', `/v1/buyer/feed?q=${encodeURIComponent(title)}`, { token })).body.items.find((i: Json) => i.title === title);
const post = (token: string, listingId: string, text: string, extra: Json = {}, app: 'buyer' | 'seller' = 'buyer') => call('POST', `/v1/${app}/listings/${listingId}/comments`, { token, body: { text, ...extra } });

describe('likes', () => {
  it('like and unlike are repeatable, count real people, and show on the card and the product page', async () => {
    expect((await call('PUT', `/v1/buyer/listings/${kurta.id}/like`, { token: asha })).body).toEqual({ liked: true, likeCount: 1 });
    expect((await call('PUT', `/v1/buyer/listings/${kurta.id}/like`, { token: asha })).body).toEqual({ liked: true, likeCount: 1 }); // again: nothing changes
    expect((await call('PUT', `/v1/buyer/listings/${kurta.id}/like`, { token: kiran })).body).toEqual({ liked: true, likeCount: 2 });
    expect(await card(asha, 'Social kurta')).toMatchObject({ likeCount: 2, liked: true, saved: false });
    expect(await card(meena, 'Social kurta')).toMatchObject({ likeCount: 2, liked: false });
    expect((await call('GET', `/v1/buyer/listings/${kurta.id}`, { token: kiran })).body).toMatchObject({ likeCount: 2, liked: true, ownListing: false });
    expect((await call('DELETE', `/v1/buyer/listings/${kurta.id}/like`, { token: kiran })).body).toEqual({ liked: false, likeCount: 1 });
    expect((await call('DELETE', `/v1/buyer/listings/${kurta.id}/like`, { token: kiran })).body).toEqual({ liked: false, likeCount: 1 });
  });

  it('eight taps at once make one like', async () => {
    await Promise.all(Array.from({ length: 8 }, () => call('PUT', `/v1/buyer/listings/${saree.id}/like`, { token: meena })));
    expect((await call('GET', `/v1/buyer/listings/${saree.id}`, { token: meena })).body.likeCount).toBe(1);
  });

  it('refuses your own listing, an unknown one, the wrong app and no sign-in', async () => {
    const owner = await makeBuyer(call, '9876503001', 'Anita D'); // the same phone is one user in both apps
    const own = await call('PUT', `/v1/buyer/listings/${kurta.id}/like`, { token: owner });
    expect(own.status).toBe(422);
    expect(own.body.code).toBe('OWN_LISTING');
    expect((await call('GET', `/v1/buyer/listings/${kurta.id}`, { token: owner })).body.ownListing).toBe(true);
    expect((await call('PUT', '/v1/buyer/listings/11111111-1111-4111-8111-111111111111/like', { token: asha })).status).toBe(404);
    expect((await call('PUT', `/v1/buyer/listings/${kurta.id}/like`, { token: anita })).body.code).toBe('WRONG_APP');
    expect((await call('PUT', `/v1/buyer/listings/${kurta.id}/like`)).status).toBe(401);
  });

  it('a paused listing takes no new like, but a like can still be taken back', async () => {
    const paused = await makeListing(call, ravi, { title: 'Paused shirt', category: 'Menswear' });
    await call('PUT', `/v1/buyer/listings/${paused.id}/like`, { token: asha });
    await call('POST', `/v1/seller/listings/${paused.id}/status`, { token: ravi, body: { status: 'PAUSED' } });
    const again = await call('PUT', `/v1/buyer/listings/${paused.id}/like`, { token: kiran });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('NOT_AVAILABLE');
    expect((await call('DELETE', `/v1/buyer/listings/${paused.id}/like`, { token: asha })).body).toEqual({ liked: false, likeCount: 0 });
  });

  it('the seller sees counts only, never who', async () => {
    const mine = (await call('GET', '/v1/seller/listings', { token: anita })).body.items.find((i: Json) => i.title === 'Social kurta');
    expect(mine.stats).toMatchObject({ likes: 1, comments: 0 });
    expect(JSON.stringify(mine)).not.toMatch(/Asha|9765403/);
  });
});

describe('saves', () => {
  it('save and unsave are repeatable and private; the seller sees only a count', async () => {
    expect((await call('PUT', `/v1/buyer/listings/${kurta.id}/save`, { token: asha })).body).toEqual({ saved: true });
    await call('PUT', `/v1/buyer/listings/${kurta.id}/save`, { token: asha });
    expect(await card(asha, 'Social kurta')).toMatchObject({ saved: true });
    expect(await card(kiran, 'Social kurta')).toMatchObject({ saved: false });
    const mine = (await call('GET', '/v1/seller/listings', { token: anita })).body.items.find((i: Json) => i.title === 'Social kurta');
    expect(mine.stats.saves).toBe(1);
    expect(JSON.stringify(await call('GET', `/v1/buyer/listings/${kurta.id}`, { token: kiran }))).not.toMatch(/saveCount/);
    expect((await call('DELETE', `/v1/buyer/listings/${kurta.id}/save`, { token: asha })).body).toEqual({ saved: false });
    expect((await call('DELETE', `/v1/buyer/listings/${kurta.id}/save`, { token: asha })).body).toEqual({ saved: false });
  });

  it('the Saved list is the person’s own, newest save first, paged, and drops a listing that is no longer live', async () => {
    await call('PUT', `/v1/buyer/listings/${kurta.id}/save`, { token: kiran });
    await call('PUT', `/v1/buyer/listings/${saree.id}/save`, { token: kiran });
    await call('PUT', `/v1/buyer/listings/${shirt.id}/save`, { token: kiran });
    const one = await call('GET', '/v1/buyer/saved?limit=2', { token: kiran });
    expect(one.body.items.map((i: Json) => i.title)).toEqual(['Social shirt', 'Social saree']);
    expect(one.body.items.every((i: Json) => i.saved)).toBe(true);
    const two = await call('GET', `/v1/buyer/saved?limit=2&cursor=${one.body.nextCursor}`, { token: kiran });
    expect(two.body.items.map((i: Json) => i.title)).toEqual(['Social kurta']);
    expect(two.body.nextCursor).toBeNull();
    expect((await call('GET', '/v1/buyer/saved', { token: meena })).body.items).toEqual([]); // nobody else's saves
    expect((await call('GET', '/v1/buyer/saved?cursor=nonsense', { token: kiran })).status).toBe(400);
    await call('POST', `/v1/seller/listings/${shirt.id}/status`, { token: ravi, body: { status: 'PAUSED' } });
    expect((await call('GET', '/v1/buyer/saved', { token: kiran })).body.items.map((i: Json) => i.title)).toEqual(['Social saree', 'Social kurta']);
    await call('POST', `/v1/seller/listings/${shirt.id}/status`, { token: ravi, body: { status: 'ACTIVE' } });
  });

  it('refuses to save your own listing', async () => {
    const owner = await makeBuyer(call, '9876503001', 'Anita D');
    const r = await call('PUT', `/v1/buyer/listings/${kurta.id}/save`, { token: owner });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('OWN_LISTING');
  });

  it('a page of Saved is never empty while live saves remain, even when the newest saves were paused', async () => {
    const who = await makeBuyer(call, '9765403096', 'Pager Buyer');
    const a = await makeListing(call, ravi, { title: 'Pager one', category: 'Menswear' });
    const b = await makeListing(call, ravi, { title: 'Pager two', category: 'Menswear' });
    const c = await makeListing(call, ravi, { title: 'Pager three', category: 'Menswear' });
    for (const l of [a, b, c]) await call('PUT', `/v1/buyer/listings/${l.id}/save`, { token: who }); // saved in this order, so c is newest
    await call('POST', `/v1/seller/listings/${b.id}/status`, { token: ravi, body: { status: 'PAUSED' } });
    await call('POST', `/v1/seller/listings/${c.id}/status`, { token: ravi, body: { status: 'PAUSED' } });
    const first = await call('GET', '/v1/buyer/saved?limit=1', { token: who });
    expect(first.body.items.map((i: Json) => i.title)).toEqual(['Pager one']); // not an empty page with a cursor
    expect(first.body.nextCursor).toBeNull();
  });

  it('two saves racing for the last place at the limit: exactly one gets it', async () => {
    const who = await makeBuyer(call, '9765403098', 'Cap Buyer');
    const uid = await userId(app, '9765403098');
    await dbOf(app).db.execute(sql`insert into saves (user_id, target_type, target_id, created_at) select ${uid}::uuid, 'LISTING', gen_random_uuid(), now() from generate_series(1, 999)`);
    const [a, b] = await Promise.all([call('PUT', `/v1/buyer/listings/${kurta.id}/save`, { token: who }), call('PUT', `/v1/buyer/listings/${saree.id}/save`, { token: who })]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const [total] = await dbOf(app).db.select({ n: sql<number>`count(*)::int` }).from(saves).where(sql`${saves.userId} = ${uid}::uuid`);
    expect(total?.n).toBe(1000);
    const full = await call('PUT', `/v1/buyer/listings/${shirt.id}/save`, { token: who });
    expect(full.body.code).toBe('SAVE_LIMIT');
  });
});

describe('comments', () => {
  it('posts, trims, lists newest first with a total, and names people by first name only', async () => {
    const a = await post(asha, kurta.id, '  Is it true to size?  ');
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ text: 'Is it true to size?', author: { name: 'Asha', shop: false }, mine: true, canRemove: true });
    await post(kiran, kurta.id, 'Which colours do you have?');
    const list = await call('GET', `/v1/buyer/listings/${kurta.id}/comments`, { token: meena });
    expect(list.body.total).toBe(2);
    expect(list.body.items.map((c: Json) => c.text)).toEqual(['Which colours do you have?', 'Is it true to size?']);
    expect(list.body.items.map((c: Json) => c.author.name)).toEqual(['Kiran', 'Asha']);
    expect(list.body.items.every((c: Json) => !c.mine && !c.canRemove)).toBe(true); // meena wrote neither
    expect(JSON.stringify(list.body)).not.toMatch(/Rao|Patel|9765403|authorUserId|userId/);
    expect(await card(meena, 'Social kurta')).toMatchObject({ commentCount: 2 });
    const page = await call('GET', `/v1/buyer/listings/${kurta.id}/comments?limit=1`, { token: meena });
    expect(page.body.items).toHaveLength(1);
    const next = await call('GET', `/v1/buyer/listings/${kurta.id}/comments?limit=1&cursor=${page.body.nextCursor}`, { token: meena });
    expect(next.body.items.map((c: Json) => c.text)).toEqual(['Is it true to size?']);
    expect(next.body.nextCursor).toBeNull();
  });

  it('refuses empty and over-long text with a message on the text field', async () => {
    for (const text of ['   ', 'x'.repeat(301)]) {
      const r = await post(asha, kurta.id, text);
      expect(r.status).toBe(400);
      expect(r.body.fields.text).toBeTruthy();
    }
    expect((await post(asha, kurta.id, '😀'.repeat(300))).status).toBe(201); // characters, not bytes
  });

  it('a retry with the same key returns the first comment and makes no second one', async () => {
    const first = await post(meena, saree.id, 'Do you ship to Pune?', { clientKey: 'retry-key-0001' });
    const again = await post(meena, saree.id, 'Do you ship to Pune?', { clientKey: 'retry-key-0001' });
    expect(again.body.id).toBe(first.body.id);
    expect((await call('GET', `/v1/buyer/listings/${saree.id}/comments`, { token: meena })).body.total).toBe(1);
    const racing = await Promise.all(Array.from({ length: 5 }, () => post(meena, saree.id, 'And in a week?', { clientKey: 'race-key-00001' })));
    expect(new Set(racing.map((r) => r.body.id)).size).toBe(1);
  });

  it('stops a flood: 20 comments in an hour, then 429', async () => {
    const who = await makeBuyer(call, '9765403097', 'Chatty One');
    const uid = await userId(app, '9765403097');
    await dbOf(app).db.execute(sql`insert into comments (listing_id, author_user_id, text, created_at) select ${shirt.id}::uuid, ${uid}::uuid, 'hello', now() from generate_series(1, 20)`);
    const r = await post(who, kurta.id, 'one more');
    expect(r.status).toBe(429);
    expect(r.body.code).toBe('RATE_LIMITED');
  });

  it('the author and the listing’s owner can remove a comment; nobody else; it disappears from the list and the count', async () => {
    const mine = await post(asha, kurta.id, 'Remove me');
    const theirs = await post(kiran, kurta.id, 'Spam link');
    expect((await call('DELETE', `/v1/buyer/comments/${theirs.body.id}`, { token: asha })).status).toBe(404); // not hers
    expect((await call('DELETE', `/v1/seller/comments/${theirs.body.id}`, { token: ravi })).status).toBe(404); // another shop
    expect((await call('DELETE', `/v1/buyer/comments/${mine.body.id}`, { token: asha })).status).toBe(204);
    expect((await call('DELETE', `/v1/buyer/comments/${mine.body.id}`, { token: asha })).status).toBe(204); // again: nothing changes
    expect((await call('DELETE', `/v1/seller/comments/${theirs.body.id}`, { token: anita })).status).toBe(204); // the owner
    const texts = (await call('GET', `/v1/buyer/listings/${kurta.id}/comments`, { token: meena })).body.items.map((c: Json) => c.text);
    expect(texts).not.toContain('Remove me');
    expect(texts).not.toContain('Spam link');
    const rows = await dbOf(app).db.select({ by: comments.removedBy, text: comments.text }).from(comments).where(eq(comments.listingId, kurta.id));
    expect(rows.find((r) => r.text === 'Remove me')?.by).toBe('AUTHOR'); // kept for the record
    expect(rows.find((r) => r.text === 'Spam link')?.by).toBe('SELLER');
  });

  it('the owner replies as the shop, reads comments on their own listing, and is told about others’ comments but not their own', async () => {
    const before = await dbOf(app).db.select({ id: notifications.id }).from(notifications).where(eq(notifications.code, 'NEW_COMMENT'));
    expect(before.length).toBeGreaterThan(0); // from the buyers' comments above
    const reply = await post(anita, kurta.id, 'Yes, it runs true to size.', {}, 'seller');
    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ author: { name: 'Shop anitasocial', shop: true }, mine: true, canRemove: true });
    const after = await dbOf(app).db.select({ id: notifications.id }).from(notifications).where(eq(notifications.code, 'NEW_COMMENT'));
    expect(after.length).toBe(before.length); // her own reply tells her nothing
    const note = (await dbOf(app).db.select().from(notifications).where(eq(notifications.code, 'NEW_COMMENT')))[0]!;
    expect(note).toMatchObject({ app: 'seller', listingId: kurta.id });
    expect(note.params).toMatchObject({ title: 'Social kurta' });
    const seen = await call('GET', `/v1/buyer/listings/${kurta.id}/comments`, { token: asha });
    expect(seen.body.items[0]).toMatchObject({ text: 'Yes, it runs true to size.', author: { shop: true }, mine: false });
    expect((await call('GET', `/v1/seller/listings/${kurta.id}/comments`, { token: anita })).body.total).toBeGreaterThan(0);
    // a different shop can neither read nor reply on someone else's listing
    expect((await call('GET', `/v1/seller/listings/${kurta.id}/comments`, { token: ravi })).status).toBe(404);
    expect((await post(ravi, kurta.id, 'Buy mine instead', {}, 'seller')).status).toBe(404);
    expect((await call('GET', `/v1/seller/listings/${kurta.id}/comments`, { token: asha })).body.code).toBe('WRONG_APP');
  });

  it('a paused listing takes no new buyer comment and shows none to buyers, but the owner can still read them', async () => {
    const l = await makeListing(call, ravi, { title: 'Comment pause', category: 'Menswear' });
    await post(asha, l.id, 'Before the pause');
    await call('POST', `/v1/seller/listings/${l.id}/status`, { token: ravi, body: { status: 'PAUSED' } });
    const refused = await post(kiran, l.id, 'After the pause');
    expect(refused.status).toBe(409);
    expect((await call('GET', `/v1/buyer/listings/${l.id}/comments`, { token: kiran })).status).toBe(404);
    expect((await call('GET', `/v1/seller/listings/${l.id}/comments`, { token: ravi })).body.total).toBe(1);
  });

  it('the owner can still answer a question after pausing the listing; a buyer cannot add one', async () => {
    const l = await makeListing(call, ravi, { title: 'Reply after pause', category: 'Menswear' });
    await post(asha, l.id, 'Is size L left?');
    await call('POST', `/v1/seller/listings/${l.id}/status`, { token: ravi, body: { status: 'PAUSED' } });
    const reply = await post(ravi, l.id, 'Yes, back next week', {}, 'seller');
    expect(reply.status).toBe(201);
    expect(reply.body.author.shop).toBe(true);
    expect((await post(asha, l.id, 'Thanks')).status).toBe(409);
  });

  it('one client key cannot be used on a second listing, and is never answered with the first listing’s comment', async () => {
    const key = 'key-reuse-0001';
    const first = await post(asha, kurta.id, 'On the kurta', { clientKey: key });
    expect(first.status).toBe(201);
    const other = await post(asha, saree.id, 'On the saree', { clientKey: key });
    expect(other.status).toBe(409);
    expect((await call('GET', `/v1/buyer/listings/${saree.id}/comments`, { token: asha })).body.items.some((c: Json) => c.text === 'On the saree')).toBe(false);
  });

  it('thirty comments at once from one person: exactly 20 get through', async () => {
    const who = await makeBuyer(call, '9765403095', 'Burst Buyer');
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => post(who, kurta.id, `burst ${i}`, { clientKey: `burst-key-${String(i).padStart(3, '0')}` })));
    expect(results.filter((r) => r.status === 201).length).toBe(20);
    expect(results.filter((r) => r.status === 429).length).toBe(10);
  });

  it('a draft has no comments for anyone', async () => {
    const m = { body: await makeListing(call, ravi, { title: 'Just a draft', category: 'Menswear', publish: false }) };
    expect((await post(asha, m.body.id, 'hi')).status).toBe(404);
    expect((await call('GET', `/v1/seller/listings/${m.body.id}/comments`, { token: ravi })).status).toBe(404);
  });
});
