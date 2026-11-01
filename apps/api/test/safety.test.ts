import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { reports } from '../src/db/schema.js';
import { makeCaller, signIn, type Caller, type Json } from './api.js';
import { insertOrder, makeBuyer, makeListing, makeShop, userId } from './community-helpers.js';
import { ManualClock, dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
let call: Caller;
let dir: string;
let clock: ManualClock;
let anita: string; // seller
let ravi: string; // another seller
let asha: string; // buyers
let kiran: string;
let meena: string;
let kurta: { id: string; variantId: string };
let shirt: { id: string };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-safety-'));
  clock = new ManualClock();
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir }, clock);
  call = makeCaller(app);
  anita = await makeShop(call, '9876505001', 'anitasafe', ['Ethnic wear']);
  ravi = await makeShop(call, '9876505002', 'ravisafe', ['Menswear']);
  asha = await makeBuyer(call, '9765405001', 'Asha Rao');
  kiran = await makeBuyer(call, '9765405002', 'Kiran Patel');
  meena = await makeBuyer(call, '9765405003', 'Meena Sharma');
  kurta = await makeListing(call, anita, { title: 'Safe kurta' });
  shirt = await makeListing(call, ravi, { title: 'Safe shirt', category: 'Menswear' });
});
afterAll(async () => {
  await dbOf(app).db.execute(sql`truncate table users cascade`);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (token: string, listingId: string, text: string, side: 'buyer' | 'seller' = 'buyer') => call('POST', `/v1/${side}/listings/${listingId}/comments`, { token, body: { text } });
const texts = async (token: string, listingId: string, side: 'buyer' | 'seller' = 'buyer'): Promise<{ list: string[]; total: number }> => {
  const r = await call('GET', `/v1/${side}/listings/${listingId}/comments`, { token });
  return { list: r.body.items.map((c: Json) => c.text), total: r.body.total };
};
const commentId = async (token: string, listingId: string, text: string, side: 'buyer' | 'seller' = 'buyer'): Promise<string> =>
  (await call('GET', `/v1/${side}/listings/${listingId}/comments`, { token })).body.items.find((c: Json) => c.text === text).id;

describe('report a comment', () => {
  it('takes a reason and a note, keeps the words as reported, and repeating it changes nothing', async () => {
    await post(kiran, kurta.id, 'buy my stuff now!!!');
    const id = await commentId(asha, kurta.id, 'buy my stuff now!!!');
    const r = await call('POST', `/v1/buyer/comments/${id}/report`, { token: asha, body: { reason: 'SPAM', note: ' looks like an ad ' } });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ received: true });
    expect((await call('POST', `/v1/buyer/comments/${id}/report`, { token: asha, body: { reason: 'ABUSE' } })).status).toBe(201);
    const rows = await dbOf(app).db.select().from(reports).where(eq(reports.targetId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reason: 'SPAM', note: 'looks like an ad', status: 'OPEN', snapshot: 'buy my stuff now!!!', targetType: 'COMMENT', reporterUserId: await userId(app, '9765405001'), targetUserId: await userId(app, '9765405002') });
    // the author removes it: the report keeps what was said
    await call('DELETE', `/v1/buyer/comments/${id}`, { token: kiran });
    expect((await dbOf(app).db.select().from(reports).where(eq(reports.targetId, id)))[0]!.snapshot).toBe('buy my stuff now!!!');
  });

  it('refuses your own comment, a bad reason, an unknown comment and a removed one; the shop can report too', async () => {
    await post(asha, kurta.id, 'Is it pure cotton?');
    const mine = await commentId(asha, kurta.id, 'Is it pure cotton?');
    expect((await call('POST', `/v1/buyer/comments/${mine}/report`, { token: asha, body: { reason: 'SPAM' } })).status).toBe(403);
    expect((await call('POST', `/v1/buyer/comments/${mine}/report`, { token: kiran, body: { reason: 'RUDE' } })).status).toBe(400);
    expect((await call('POST', `/v1/buyer/comments/${mine}/report`, { token: kiran, body: { reason: 'OTHER', note: 'x'.repeat(301) } })).status).toBe(400);
    expect((await call('POST', '/v1/buyer/comments/00000000-0000-4000-8000-000000000000/report', { token: kiran, body: { reason: 'SPAM' } })).status).toBe(404);
    expect((await call('POST', `/v1/seller/comments/${mine}/report`, { token: anita, body: { reason: 'ABUSE' } })).status).toBe(201);
    // a comment on another shop's paused/draft listing, or removed, cannot be reported by a stranger
    const gone = await commentId(asha, kurta.id, 'Is it pure cotton?');
    await call('DELETE', `/v1/buyer/comments/${gone}`, { token: asha });
    expect((await call('POST', `/v1/buyer/comments/${gone}/report`, { token: meena, body: { reason: 'SPAM' } })).status).toBe(404);
    expect((await call('POST', `/v1/buyer/comments/${mine}/report`)).status).toBe(401);
  });

  it('allows 10 reports an hour, then limits, and the limit lifts after the hour', async () => {
    const spammer = await makeBuyer(call, '9765405009', 'Sam Spam');
    const ids: string[] = [];
    for (let i = 0; i < 11; i++) {
      await post(spammer, shirt.id, `spam number ${i}`);
      ids.push(await commentId(meena, shirt.id, `spam number ${i}`));
    }
    const codes: number[] = [];
    for (const id of ids) codes.push((await call('POST', `/v1/buyer/comments/${id}/report`, { token: meena, body: { reason: 'SPAM' } })).status);
    expect(codes.slice(0, 10).every((c) => c === 201)).toBe(true);
    expect(codes[10]).toBe(429);
    clock.advance(61 * 60_000);
    // the clock moved, so the sign-in tokens (15 minutes) ran out: sign in again
    [anita, ravi, asha, kiran, meena] = await Promise.all([signIn(call, '9876505001', 'seller'), signIn(call, '9876505002', 'seller'), signIn(call, '9765405001', 'buyer'), signIn(call, '9765405002', 'buyer'), signIn(call, '9765405003', 'buyer')]);
    expect((await call('POST', `/v1/buyer/comments/${ids[10]}/report`, { token: meena, body: { reason: 'SPAM' } })).status).toBe(201);
  });
});

describe('block from a comment', () => {
  it('a buyer’s block hides that person’s comments from the buyer only, and stops no one posting', async () => {
    await post(meena, kurta.id, 'meena says hi');
    expect((await texts(asha, kurta.id)).list).toContain('meena says hi');
    const id = await commentId(asha, kurta.id, 'meena says hi');
    const b = await call('PUT', '/v1/buyer/blocks', { token: asha, body: { source: 'COMMENT', id } });
    expect(b.status).toBe(200);
    expect(b.body).toMatchObject({ name: 'Meena' });
    expect(JSON.stringify(b.body)).not.toMatch(/user|phone|9765405003/i);
    expect((await call('PUT', '/v1/buyer/blocks', { token: asha, body: { source: 'COMMENT', id } })).body.id).toBe(b.body.id); // again: the same block
    const mine = await texts(asha, kurta.id);
    expect(mine.list).not.toContain('meena says hi');
    expect((await texts(kiran, kurta.id)).list).toContain('meena says hi');
    expect(mine.total).toBe((await texts(kiran, kurta.id)).total - 1);
    // meena can still post, and the seller still sees her
    expect((await post(meena, kurta.id, 'second comment')).status).toBe(201);
    expect((await texts(anita, kurta.id, 'seller')).list).toContain('meena says hi');
    // the block shows in the list and can be undone
    expect((await call('GET', '/v1/buyer/blocks', { token: asha })).body.items.map((x: Json) => x.name)).toEqual(['Meena']);
    expect((await call('DELETE', `/v1/buyer/blocks/${b.body.id}`, { token: kiran })).status).toBe(204); // someone else's: nothing happens
    expect((await call('GET', '/v1/buyer/blocks', { token: asha })).body.items).toHaveLength(1);
    expect((await call('DELETE', `/v1/buyer/blocks/${b.body.id}`, { token: asha })).status).toBe(204);
    expect((await call('DELETE', `/v1/buyer/blocks/${b.body.id}`, { token: asha })).status).toBe(204);
    expect((await texts(asha, kurta.id)).list).toContain('meena says hi');
  });

  it('a seller’s block stops that person commenting on that shop only, hides them from the seller, and the shop is never blocked from its own listing', async () => {
    const id = await commentId(anita, kurta.id, 'second comment', 'seller');
    const b = await call('PUT', '/v1/seller/blocks', { token: anita, body: { source: 'COMMENT', id } });
    expect(b.status).toBe(200);
    expect((await texts(anita, kurta.id, 'seller')).list).not.toContain('second comment');
    const refused = await post(meena, kurta.id, 'let me in');
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('BLOCKED');
    expect((await post(meena, shirt.id, 'other shop is fine')).status).toBe(201);
    expect((await post(kiran, kurta.id, 'kiran is fine')).status).toBe(201);
    // blocking yourself, or your own comment, is refused
    const own = await post(anita, kurta.id, 'thanks for asking', 'seller');
    expect(own.status).toBe(201);
    const ownId = await commentId(anita, kurta.id, 'thanks for asking', 'seller');
    expect((await call('PUT', '/v1/seller/blocks', { token: anita, body: { source: 'COMMENT', id: ownId } })).status).toBe(403);
    // unblocking lets her back in
    await call('DELETE', `/v1/seller/blocks/${b.body.id}`, { token: anita });
    expect((await post(meena, kurta.id, 'thanks')).status).toBe(201);
  });

  it('cannot block through a comment you cannot see', async () => {
    const id = await commentId(kiran, kurta.id, 'kiran is fine');
    await call('DELETE', `/v1/buyer/comments/${id}`, { token: kiran });
    expect((await call('PUT', '/v1/buyer/blocks', { token: asha, body: { source: 'COMMENT', id } })).status).toBe(404);
    expect((await call('PUT', '/v1/buyer/blocks', { token: asha, body: { source: 'THREAD', id: '00000000-0000-4000-8000-000000000000' } })).status).toBe(404);
    expect((await call('PUT', '/v1/buyer/blocks', { token: asha, body: { source: 'NOPE', id } })).status).toBe(400);
  });
});

describe('chat: report and block', () => {
  async function chat() {
    const l = await makeListing(call, anita, { title: `Chat kurta ${Math.random()}` });
    const order = await insertOrder(app, { buyerPhone: '9765405001', sellerPhone: '9876505001', listingId: l.id, variantId: l.variantId });
    return order;
  }
  const send = (token: string, side: 'buyer' | 'seller', id: string, text: string) => call('POST', `/v1/${side}/threads/${id}/messages`, { token, body: { text } });

  it('the other person’s message can be reported; your own, a system message and a stranger’s chat cannot', async () => {
    const o = await chat();
    await send(asha, 'buyer', o.threadId, 'Where is my order??');
    const t = await call('GET', `/v1/seller/threads/${o.threadId}`, { token: anita });
    const theirs = t.body.messages.find((m: Json) => m.text === 'Where is my order??');
    const sys = t.body.messages.find((m: Json) => m.from === 'SYSTEM');
    expect(theirs.from).toBe('OTHER');
    expect((await call('POST', `/v1/seller/threads/${o.threadId}/messages/${theirs.id}/report`, { token: anita, body: { reason: 'ABUSE', note: 'rude' } })).status).toBe(201);
    expect((await call('POST', `/v1/seller/threads/${o.threadId}/messages/${theirs.id}/report`, { token: anita, body: { reason: 'ABUSE' } })).status).toBe(201);
    expect(await dbOf(app).db.select().from(reports).where(eq(reports.targetId, theirs.id))).toHaveLength(1);
    expect((await call('POST', `/v1/seller/threads/${o.threadId}/messages/${sys.id}/report`, { token: anita, body: { reason: 'SPAM' } })).status).toBe(404);
    expect((await call('POST', `/v1/buyer/threads/${o.threadId}/messages/${theirs.id}/report`, { token: asha, body: { reason: 'SPAM' } })).status).toBe(403); // asha wrote it
    expect((await call('POST', `/v1/buyer/threads/${o.threadId}/messages/${theirs.id}/report`, { token: kiran, body: { reason: 'SPAM' } })).status).toBe(404);
    expect((await call('POST', `/v1/seller/threads/${o.threadId}/messages/${theirs.id}/report`, { token: ravi, body: { reason: 'SPAM' } })).status).toBe(404);
  });

  it('a chat photo is reported with its photo kept', async () => {
    const o = await chat();
    const { upload } = await import('./community-helpers.js');
    const photo = await upload(call, asha, 'buyer', 'CHAT');
    expect((await call('POST', `/v1/buyer/threads/${o.threadId}/messages`, { token: asha, body: { mediaId: photo.id } })).status).toBe(201);
    const t = await call('GET', `/v1/seller/threads/${o.threadId}`, { token: anita });
    const m = t.body.messages.find((x: Json) => x.type === 'MEDIA');
    expect((await call('POST', `/v1/seller/threads/${o.threadId}/messages/${m.id}/report`, { token: anita, body: { reason: 'ABUSE' } })).status).toBe(201);
    const [row] = await dbOf(app).db.select().from(reports).where(eq(reports.targetId, m.id));
    expect(row!.mediaId).toBe(photo.id);
  });

  it('blocking in a thread ends new messages both ways, shows on both sides, keeps the order readable, and unblocking restores it', async () => {
    const o = await chat();
    expect((await send(asha, 'buyer', o.threadId, 'hello')).status).toBe(201);
    const b = await call('PUT', '/v1/seller/blocks', { token: anita, body: { source: 'THREAD', id: o.threadId } });
    expect(b.status).toBe(200);
    expect(b.body.name).toBe('Asha');
    const sellerView = await call('GET', `/v1/seller/threads/${o.threadId}`, { token: anita });
    const buyerView = await call('GET', `/v1/buyer/threads/${o.threadId}`, { token: asha });
    expect(sellerView.body).toMatchObject({ messagingDisabled: true, youBlocked: true });
    expect(buyerView.body).toMatchObject({ messagingDisabled: true, youBlocked: false }); // the buyer is not told who blocked
    expect(buyerView.body.messages.map((m: Json) => m.text)).toContain('hello'); // history stays readable
    const s1 = await send(asha, 'buyer', o.threadId, 'are you there?');
    expect(s1.status).toBe(403);
    expect(s1.body.code).toBe('BLOCKED');
    expect((await send(anita, 'seller', o.threadId, 'no')).status).toBe(403);
    expect((await call('GET', '/v1/buyer/threads', { token: asha })).body.items.find((x: Json) => x.id === o.threadId)).toMatchObject({ messagingDisabled: true, youBlocked: false });
    expect((await call('GET', '/v1/seller/threads', { token: anita })).body.items.find((x: Json) => x.id === o.threadId)).toMatchObject({ messagingDisabled: true, youBlocked: true });
    expect((await call('GET', `/v1/buyer/orders/${o.id}`, { token: asha })).status).toBe(200);
    // a stranger cannot block through someone else's thread, and the block does not spread to other chats of other people
    expect((await call('PUT', '/v1/buyer/blocks', { token: kiran, body: { source: 'THREAD', id: o.threadId } })).status).toBe(404);
    const other = await chat(); // same two people, another order: the block is by person, so it applies here too
    expect((await send(asha, 'buyer', other.threadId, 'hi')).status).toBe(403);
    await call('DELETE', `/v1/seller/blocks/${b.body.id}`, { token: anita });
    expect((await send(asha, 'buyer', o.threadId, 'thanks')).status).toBe(201);
    expect((await call('GET', `/v1/buyer/threads/${o.threadId}`, { token: asha })).body).toMatchObject({ messagingDisabled: false, youBlocked: false });
  });
});
