import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { listingViews } from '../src/db/schema.js';
import { makeCaller, type Caller } from './api.js';
import { makeBuyer, makeListing, makeShop } from './community-helpers.js';
import { ManualClock, dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
let call: Caller;
let dir: string;
let clock: ManualClock;
let anita: string;
let asha: string;
let kiran: string;
let kurta: { id: string };

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-views-'));
  clock = new ManualClock();
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir }, clock);
  call = makeCaller(app);
  anita = await makeShop(call, '9876506001', 'anitaviews', ['Ethnic wear']);
  asha = await makeBuyer(call, '9765406001', 'Asha Rao');
  kiran = await makeBuyer(call, '9765406002', 'Kiran Patel');
  kurta = await makeListing(call, anita, { title: 'Viewed kurta' });
});
afterAll(async () => {
  await dbOf(app).db.execute(sql`truncate table users cascade`);
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const view = (token: string, id: string) => call('POST', `/v1/buyer/listings/${id}/view`, { token });
const count = async (id: string) => (await dbOf(app).db.select().from(listingViews).where(eq(listingViews.listingId, id))).length;
const dash = async () => (await call('GET', '/v1/seller/dashboard', { token: anita })).body.windows as { days: number; views: number }[];

describe('listing views', () => {
  it('count once per person per listing per hour, and again after the hour', async () => {
    expect((await view(asha, kurta.id)).status).toBe(204);
    expect((await view(asha, kurta.id)).status).toBe(204);
    await Promise.all(Array.from({ length: 6 }, () => view(asha, kurta.id)));
    expect(await count(kurta.id)).toBe(1);
    expect((await view(kiran, kurta.id)).status).toBe(204);
    expect(await count(kurta.id)).toBe(2);
    clock.advance(61 * 60_000);
    const fresh = await call('POST', '/v1/auth/otp/verify', { body: { phone: '9765406001', code: '123456', app: 'buyer' } });
    expect((await view(fresh.body.accessToken, kurta.id)).status).toBe(204);
    expect(await count(kurta.id)).toBe(3);
  });

  it('never count your own opens, a draft, a paused listing or one that does not exist, and always answer the same', async () => {
    anita = (await call('POST', '/v1/auth/otp/verify', { body: { phone: '9876506001', code: '123456', app: 'seller' } })).body.accessToken;
    asha = (await call('POST', '/v1/auth/otp/verify', { body: { phone: '9765406001', code: '123456', app: 'buyer' } })).body.accessToken;
    const before = await count(kurta.id);
    // a seller cannot reach the buyer route at all
    expect((await call('POST', `/v1/buyer/listings/${kurta.id}/view`, { token: anita })).body.code).toBe('WRONG_APP');
    // the shop's own person, signed in to the buyer app with the same number, is the owner: not counted
    const owner = await makeBuyer(call, '9876506001', 'Anita Shop');
    expect((await view(owner, kurta.id)).status).toBe(204);
    expect(await count(kurta.id)).toBe(before);
    const paused = await makeListing(call, anita, { title: 'Paused one' });
    await call('POST', `/v1/seller/listings/${paused.id}/status`, { token: anita, body: { status: 'PAUSED' } });
    expect((await view(asha, paused.id)).status).toBe(204);
    expect(await count(paused.id)).toBe(0);
    expect((await view(asha, '00000000-0000-4000-8000-000000000000')).status).toBe(204);
    expect((await call('POST', `/v1/buyer/listings/${kurta.id}/view`)).status).toBe(401);
  });

  it('appear on the seller dashboard in the 7 and 30 day windows, as a count and nothing more', async () => {
    const w = await dash();
    expect(w.map((x) => x.days)).toEqual([7, 30]);
    expect(w[0]!.views).toBe(3);
    expect(w[1]!.views).toBe(3);
    const raw = JSON.stringify((await call('GET', '/v1/seller/dashboard', { token: anita })).body);
    expect(raw).not.toMatch(/viewer|9765406001|Asha/);
  });
});
