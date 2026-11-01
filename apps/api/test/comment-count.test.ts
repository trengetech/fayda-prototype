import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { makeCaller, type Caller, type Json } from './api.js';
import { makeBuyer, makeListing, makeShop } from './community-helpers.js';
import { dbOf, startApp } from './helpers.js';

// COMMENT_COUNT_MODE: `all` counts everyone on cards and the product page; `viewer` leaves out the viewer's blocked people.
let dir: string;
const apps: NestFastifyApplication[] = [];
let seller: string, asha: string, kiran: string, meena: string;
let listingId: string;

const countOn = async (call: Caller, token: string | undefined): Promise<{ page: number; card: number }> => {
  const page = (await call('GET', `/v1/buyer/listings/${listingId}`, { ...(token ? { token } : {}) })).body as Json;
  const feed = (await call('GET', `/v1/buyer/feed?q=Count%20kurta`, { ...(token ? { token } : {}) })).body.items.find((i: Json) => i.title === 'Count kurta') as Json;
  return { page: page.commentCount, card: feed.commentCount };
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-commentcount-'));
  const all = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir });
  apps.push(all);
  const call = makeCaller(all);
  seller = await makeShop(call, '9876507001', 'countshop');
  asha = await makeBuyer(call, '9765407001', 'Asha Rao');
  kiran = await makeBuyer(call, '9765407002', 'Kiran Patel');
  meena = await makeBuyer(call, '9765407003', 'Meena Sharma');
  listingId = (await makeListing(call, seller, { title: 'Count kurta' })).id;
  await call('POST', `/v1/buyer/listings/${listingId}/comments`, { token: kiran, body: { text: 'kiran here' } });
  const m = await call('POST', `/v1/buyer/listings/${listingId}/comments`, { token: meena, body: { text: 'meena here' } });
  expect((await call('PUT', '/v1/buyer/blocks', { token: asha, body: { source: 'COMMENT', id: m.body.id } })).status).toBe(200);
});
afterAll(async () => {
  await dbOf(apps[0]!).db.execute(sql`truncate table users cascade`);
  for (const a of apps) await a.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('comment count mode', () => {
  it('defaults to counting everyone', () => {
    expect(loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(32), DATABASE_URL: 'postgres://x' }).commentCountMode).toBe('all');
    expect(() => loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(32), DATABASE_URL: 'postgres://x', COMMENT_COUNT_MODE: 'nope' })).toThrow(/COMMENT_COUNT_MODE/);
  });

  it('all: a blocked person is still counted on the card and the page', async () => {
    const call = makeCaller(apps[0]!);
    expect(await countOn(call, asha)).toEqual({ page: 2, card: 2 });
  });

  it('viewer: the blocker does not count the blocked person; everyone else and signed-out readers still do', async () => {
    const v = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir, COMMENT_COUNT_MODE: 'viewer' });
    apps.push(v);
    const call = makeCaller(v);
    expect(await countOn(call, asha)).toEqual({ page: 1, card: 1 });
    expect(await countOn(call, kiran)).toEqual({ page: 2, card: 2 });
  });
});
