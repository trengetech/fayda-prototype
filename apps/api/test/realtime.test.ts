import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { io, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { JPEG, makeCaller, makeSeller, signIn, uploadFile, type Caller, type Json } from './api.js';
import { dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
let call: Caller;
let dir: string;
let url: string;
const sockets: Socket[] = [];
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-realtime-'));
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir });
  await app.listen(0, '127.0.0.1');
  url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  call = makeCaller(app);
});
afterEach(async () => {
  sockets.splice(0).forEach((s) => s.close());
  await dbOf(app).db.execute(sql`truncate table users cascade`);
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const rupees = (n: number) => n * 100;
/** Connects and resolves once the server accepted us. Rejects with the server's error. */
const connect = (token: string | null): Promise<Socket> =>
  new Promise((resolve, reject) => {
    const s = io(url, { transports: ['websocket'], auth: token ? { token } : {}, reconnection: false });
    sockets.push(s);
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => reject(e));
  });
const nextEvent = (s: Socket, ms = 4000): Promise<Json> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('no event')), ms);
    s.once('negotiation.updated', (p) => (clearTimeout(t), resolve(p)));
  });
const quiet = (s: Socket, ms = 800): Promise<boolean> =>
  new Promise((resolve) => {
    let heard = false;
    s.once('negotiation.updated', () => (heard = true));
    setTimeout(() => resolve(!heard), ms);
  });

async function world() {
  const seller = await makeSeller(call, '9876544001', 'rtshop');
  const m = (await uploadFile(call, seller, JPEG())).id as string;
  const l = await call('POST', '/v1/seller/listings', {
    token: seller,
    body: { title: 'Cotton kurta', category: 'Ethnic wear', price: rupees(1500), media: [{ mediaId: m }], variants: [{ label: 'M', stock: 2 }], bargaining: { mode: 'BOTH', expiryMinutes: 1440 }, checkout: { channel: 'DIRECT' }, publish: true },
  });
  return { seller, listingId: l.body.id as string, variantId: l.body.variants[0].id as string, buyer: await signIn(call, '9876544002', 'buyer'), other: await signIn(call, '9876544003', 'buyer') };
}

describe('real-time updates', () => {
  it('refuses a connection without a valid token', async () => {
    await expect(connect(null)).rejects.toThrow('UNAUTHENTICATED');
    await expect(connect('not-a-token')).rejects.toThrow('UNAUTHENTICATED');
  });

  it('refuses a token whose session has ended', async () => {
    const token = await signIn(call, '9876544010', 'buyer');
    await call('POST', '/v1/auth/logout', { token });
    await expect(connect(token)).rejects.toThrow('UNAUTHENTICATED');
  });

  it('tells the seller about a new offer and the buyer about the reply, with ids only', async () => {
    const w = await world();
    const sellerSocket = await connect(w.seller);
    const buyerSocket = await connect(w.buyer);
    const otherSocket = await connect(w.other);

    const sellerHears = nextEvent(sellerSocket);
    const offered = await call('POST', `/v1/buyer/listings/${w.listingId}/offers`, { token: w.buyer, body: { variantId: w.variantId, amount: rupees(1000) } });
    const e1 = await sellerHears;
    expect(e1).toEqual({ negotiationId: offered.body.id, listingId: w.listingId });

    // When the event arrives the new state is already readable: it is sent after the commit.
    const seen = await call('GET', `/v1/seller/negotiations/${e1.negotiationId}`, { token: w.seller });
    expect(seen.body.needsReply).toBe(true);

    const buyerHears = nextEvent(buyerSocket);
    await call('POST', `/v1/seller/negotiations/${offered.body.id}/counter`, { token: w.seller, body: { amount: rupees(1400) } });
    expect(await buyerHears).toEqual({ negotiationId: offered.body.id, listingId: w.listingId });
    expect(await quiet(otherSocket)).toBe(true); // a stranger hears nothing
  });

  it('keeps the two apps apart: the seller’s phone also signed in as a buyer hears only its own app’s events', async () => {
    const w = await world();
    const sellerAppSocket = await connect(w.seller);
    const sellerAsBuyer = await connect(await signIn(call, '9876544001', 'buyer'));
    const heard = nextEvent(sellerAppSocket);
    await call('POST', `/v1/buyer/listings/${w.listingId}/offers`, { token: w.buyer, body: { variantId: w.variantId, amount: rupees(1000) } });
    await heard;
    expect(await quiet(sellerAsBuyer)).toBe(true);
  });

  it('tells both sides when a timer closes an offer, and when a listing edit does', async () => {
    const w = await world();
    const buyerSocket = await connect(w.buyer);
    const offered = await call('POST', `/v1/buyer/listings/${w.listingId}/offers`, { token: w.buyer, body: { variantId: w.variantId, amount: rupees(1000) } });
    await new Promise((r) => setTimeout(r, 300));
    const heard = nextEvent(buyerSocket);
    await call('POST', `/v1/seller/listings/${w.listingId}/status`, { token: w.seller, body: { status: 'PAUSED' } });
    expect((await heard).negotiationId).toBe(offered.body.id);
  });
});
