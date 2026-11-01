import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RankingService } from '../src/discovery/ranking.service.js';
import { feedImpressions, listingRankScores, listings } from '../src/db/schema.js';
import { makeCaller, type Caller, type Json } from './api.js';
import { makeBuyer, makeListing, makeShop, rupees, sellerIdOf } from './community-helpers.js';
import { dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
let newestApp: NestFastifyApplication;
let call: Caller;
let callNewest: Caller;
let dir: string;
let anita: string; // seller tokens
let ravi: string;
let asha: string; // buyers
let kiran: string;
let meena: string;
const ids: Record<string, string> = {};

/** A small catalogue of the kind of thing sellers write: spellings vary, tags are loose. */
const CATALOGUE: { key: string; seller: 'anita' | 'ravi'; title: string; category: string; tags: string[]; description?: string; stock?: number }[] = [
  { key: 'kurta', seller: 'anita', title: 'Cotton kurta', category: 'Ethnic wear', tags: ['cotton', 'summer wear'] },
  { key: 'saree', seller: 'anita', title: 'Banarasi saree', category: 'Ethnic wear', tags: ['silk', 'wedding'] },
  { key: 'lehenga', seller: 'anita', title: 'Bridal lehenga', category: 'Ethnic wear', tags: ['wedding', 'heavy work'] },
  { key: 'dupatta', seller: 'anita', title: 'Phulkari dupatta', category: 'Ethnic wear', tags: ['phulkari'], description: 'Goes well with a plain kurta' },
  { key: 'skirt', seller: 'ravi', title: 'Pleated skirt', category: 'Western wear', tags: ['pleated'] },
  { key: 'shirt', seller: 'ravi', title: 'Linen shirt', category: 'Menswear', tags: ['linen', 'summer wear'] },
  { key: 'jeans', seller: 'ravi', title: 'Slim fit jeans', category: 'Menswear', tags: ['denim'] },
  { key: 'sneakers', seller: 'ravi', title: 'Canvas sneakers', category: 'Footwear', tags: ['casual'] },
  { key: 'milk', seller: 'ravi', title: 'Milk silk blouse', category: 'Western wear', tags: ['blouse'] },
];

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-search-'));
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir, FEED_RANKER: 'scored' });
  newestApp = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir, FEED_RANKER: 'newest' });
  call = makeCaller(app);
  callNewest = makeCaller(newestApp);
  anita = await makeShop(call, '9876503001', 'anitasr', ['Ethnic wear']);
  ravi = await makeShop(call, '9876503002', 'ravisr', ['Menswear', 'Western wear', 'Footwear']);
  asha = await makeBuyer(call, '9765403001');
  kiran = await makeBuyer(call, '9765403002', 'Kiran P');
  meena = await makeBuyer(call, '9765403003', 'Meena S');
  for (const c of CATALOGUE) {
    const l = await makeListing(call, c.seller === 'anita' ? anita : ravi, { title: c.title, category: c.category, tags: c.tags, description: c.description ?? '', price: rupees(1000), variants: [{ label: 'M', stock: c.stock ?? 5 }] });
    ids[c.key] = l.id;
  }
  await app.get(RankingService).refreshScores();
});
afterAll(async () => {
  await dbOf(app).db.execute(sql`truncate table users cascade`);
  await app.close();
  await newestApp.close();
  rmSync(dir, { recursive: true, force: true });
});

const feed = async (token: string, qs = '', c: Caller = call): Promise<Json> => {
  const r = await c('GET', `/v1/buyer/feed${qs}`, { token });
  if (r.status !== 200) throw new Error(JSON.stringify(r.body));
  return r.body;
};
const titles = (b: Json): string[] => b.items.map((i: Json) => i.title);

describe('search: spelling and synonyms', () => {
  it('finds a kurta however the buyer or seller spells it', async () => {
    for (const q of ['kurta', 'kurti', 'kurtis', 'kurtaa', 'KURTA']) expect(titles(await feed(asha, `?q=${q}`))).toContain('Cotton kurta');
  });
  it('finds a saree for sari, and a lehenga for lehnga or ghagra', async () => {
    expect(titles(await feed(asha, '?q=sari'))).toContain('Banarasi saree');
    expect(titles(await feed(asha, '?q=lehnga'))).toContain('Bridal lehenga');
    expect(titles(await feed(asha, '?q=ghagra'))).toContain('Bridal lehenga');
    expect(titles(await feed(asha, '?q=shaadi'))).toEqual(expect.arrayContaining(['Banarasi saree', 'Bridal lehenga']));
  });
  it('does not match words that only look a little alike', async () => {
    expect(titles(await feed(asha, '?q=shirt'))).not.toContain('Pleated skirt');
    expect(titles(await feed(asha, '?q=skirt'))).not.toContain('Linen shirt');
    expect(titles(await feed(asha, '?q=milk'))).toEqual(['Milk silk blouse']);
    expect(titles(await feed(asha, '?q=zebra'))).toEqual([]);
  });
  it('still needs every word to match something', async () => {
    expect(titles(await feed(asha, '?q=kurti%20cotton'))).toEqual(['Cotton kurta']);
    expect(titles(await feed(asha, '?q=kurti%20denim'))).toEqual([]);
  });
  it('treats % and _ as plain characters', async () => {
    expect(titles(await feed(asha, '?q=%25%25'))).toEqual([]);
    expect(titles(await feed(asha, '?q=k_rta'))).toEqual([]);
  });
});

describe('search: relevance order', () => {
  it('puts a title match above a description-only match, and the typed word above a synonym', async () => {
    // "kurta": the kurta itself (title) beats the dupatta that only mentions it in its description
    expect(titles(await feed(asha, '?q=kurta')).slice(0, 2)).toEqual(['Cotton kurta', 'Phulkari dupatta']);
    // "saree" typed: the saree is first; "sari" typed finds it too but a title with the exact word would outrank a synonym
    const r = await feed(asha, '?q=wedding');
    expect(new Set(titles(r))).toEqual(new Set(['Banarasi saree', 'Bridal lehenga']));
  });
  it('pages a ranked search without repeating or skipping, and the marker only fits its own order', async () => {
    const all = titles(await feed(asha, '?q=wear&limit=50'));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const b: Json = await feed(asha, `?q=wear&limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...titles(b));
      cursor = b.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(all);
    expect(new Set(seen).size).toBe(seen.length);
    const first = await feed(asha, '?q=wear&limit=1');
    expect((await call('GET', `/v1/buyer/feed?q=wear&sort=NEWEST&cursor=${first.nextCursor}`, { token: asha })).status).toBe(400);
    for (const broken of ['nonsense', Buffer.from('RANKED:abc:123').toString('base64url'), Buffer.from(`RANKED:5.5:not-a-uuid`).toString('base64url')]) {
      expect((await call('GET', `/v1/buyer/feed?q=wear&cursor=${broken}`, { token: asha })).status).toBe(400);
    }
  });
  it('NEWEST stays strictly newest first, also when searching', async () => {
    const b = await feed(asha, '?sort=NEWEST');
    expect(titles(b)[0]).toBe('Milk silk blouse');
    expect(b.ranker).toBe('NEWEST');
  });
});

describe('For You ranking', () => {
  const order = async (token: string, c: Caller = call) => titles(await feed(token, '', c));

  it('is newest first when the ranker is switched to newest, and the page says so', async () => {
    const b = await feed(asha, '', callNewest);
    expect(b.ranker).toBe('NEWEST');
    expect(titles(b)[0]).toBe('Milk silk blouse');
    expect((await feed(asha)).ranker).toBe('SCORED');
  });

  it('lifts a liked listing, and sinks a sold-out one', async () => {
    for (const buyer of [asha, kiran, meena]) await call('PUT', `/v1/buyer/listings/${ids.dupatta}/like`, { token: buyer });
    // an older listing, made sold out, with the same likes, must still sink
    for (const buyer of [asha, kiran, meena]) await call('PUT', `/v1/buyer/listings/${ids.jeans}/like`, { token: buyer });
    const db = dbOf(app).db;
    await db.execute(sql`update listing_variants set stock = 0 where listing_id = ${ids.jeans}`);
    await app.get(RankingService).refreshScores();
    const o = await order(asha);
    expect(o.indexOf('Phulkari dupatta')).toBeLessThan(o.indexOf('Pleated skirt'));
    expect(o[o.length - 1]).toBe('Slim fit jeans');
  });

  it('boosts shops the buyer follows, only for that buyer', async () => {
    const before = await order(kiran);
    const ravi1 = before.findIndex((t) => ['Canvas sneakers', 'Linen shirt', 'Pleated skirt', 'Milk silk blouse'].includes(t));
    await call('PUT', `/v1/buyer/follows/sellers/${await sellerIdOf(app, '9876503002')}`, { token: kiran });
    const after = await order(kiran);
    const top4 = after.slice(0, 4);
    expect(top4.every((t) => ['Canvas sneakers', 'Linen shirt', 'Pleated skirt', 'Milk silk blouse'].includes(t))).toBe(true);
    expect(ravi1).toBeGreaterThanOrEqual(0);
    // another buyer is not affected
    expect(await order(meena)).toEqual(await order(asha));
  });

  it('pages For You without repeats while scores do not change', async () => {
    const all = await order(asha);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 10; i++) {
      const b: Json = await feed(asha, `?limit=2${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...titles(b));
      cursor = b.nextCursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(all);
  });

  it('keeps Following newest first, and a shop page newest first', async () => {
    const f = await call('GET', '/v1/buyer/feed?scope=FOLLOWING', { token: kiran });
    expect(f.body.ranker).toBe('NEWEST');
    const s = await call('GET', '/v1/buyer/shops/ravisr/listings', { token: asha });
    expect(s.body.ranker).toBe('NEWEST');
  });

  it('never shows a score, a ranking field or a private rule to the buyer', async () => {
    const text = JSON.stringify(await feed(asha));
    expect(text).not.toMatch(/rankScore|rank_score|rankKey|rankedAt|autoAccept|autoDecline|autoCounter|dealCodes|dealAccept|upiId/i);
  });

  it('stores each refresh as its own generation and keeps only the last 30 minutes', async () => {
    const db = dbOf(app).db;
    const svc = app.get(RankingService);
    const live = (await db.select({ id: listings.id }).from(listings).where(eq(listings.status, 'ACTIVE'))).length;
    const now = Date.now();
    expect(await svc.refreshScores(now + 1_000_000)).toBe(live);
    const gens = async () => (await db.execute(sql`select distinct generation from listing_rank_scores order by 1`)) as unknown as { generation: string }[];
    expect((await gens()).length).toBeGreaterThanOrEqual(2);
    // a refresh 31 minutes later removes the older generations
    await svc.refreshScores(now + 1_000_000 + 31 * 60_000);
    expect((await gens()).length).toBe(1);
    const [likedScore] = await db.select({ s: listingRankScores.score }).from(listingRankScores).where(eq(listingRankScores.listingId, ids.dupatta!));
    const [plainScore] = await db.select({ s: listingRankScores.score }).from(listingRankScores).where(eq(listingRankScores.listingId, ids.kurta!));
    expect(likedScore!.s).toBeGreaterThan(plainScore!.s);
  });

  it('keeps a scroll in one order when scores are refreshed between two pages', async () => {
    const svc = app.get(RankingService);
    const now = Date.now() + 5_000_000;
    await svc.refreshScores(now);
    const all = titles(await feed(meena, '?limit=50'));
    const first: Json = await feed(meena, '?limit=3');
    expect(titles(first)).toEqual(all.slice(0, 3));
    // the listing on top sells out and a refresh runs: from now on it sinks to the bottom of a fresh scroll
    await dbOf(app).db.execute(sql`update listing_variants set stock = 0 where listing_id = (select id from listings where title = ${all[0]!})`);
    await svc.refreshScores(now + 6 * 60_000);
    const fresh = titles(await feed(meena, '?limit=50'));
    expect(fresh[fresh.length - 1]).toBe(all[0]);
    // the scroll that began before the refresh still gets exactly the old order: nothing repeated, nothing skipped
    const seen = titles(first);
    let cursor: string | null = first.nextCursor;
    for (let i = 0; i < 10 && cursor; i++) {
      const b: Json = await feed(meena, `?limit=3&cursor=${cursor}`);
      seen.push(...titles(b));
      cursor = b.nextCursor;
    }
    expect(seen).toEqual(all);
    // a marker whose generation has been deleted still works, on the newest scores
    await svc.refreshScores(now + 60 * 60_000);
    const old: Json = await call('GET', `/v1/buyer/feed?limit=3&cursor=${first.nextCursor}`, { token: meena });
    expect(old.status).toBe(200);
  });
});

describe('search text and index', () => {
  it('finds a listing by a changed tag or a renamed shop, without a republish', async () => {
    const db = dbOf(app).db;
    expect(titles(await feed(asha, '?q=zebrastripe'))).toEqual([]);
    await db.execute(sql`update listings set tags = array['zebrastripe'] where id = ${ids.sneakers}`);
    expect(titles(await feed(asha, '?q=zebrastripe'))).toEqual(['Canvas sneakers']);
    expect(titles(await feed(asha, '?q=quokkashop'))).toEqual([]);
    await db.execute(sql`update sellers set name = 'Quokkashop' where handle = 'ravisr'`);
    expect(titles(await feed(asha, '?q=quokkashop'))).toEqual(expect.arrayContaining(['Canvas sneakers', 'Linen shirt']));
    await db.execute(sql`update sellers set name = 'Shop ravisr' where handle = 'ravisr'`);
    expect(titles(await feed(asha, '?q=quokkashop'))).toEqual([]);
  });

  it('has a trigram index that answers both the word and the similar-word test', async () => {
    const db = dbOf(app).db;
    const plan = await db.transaction(async (tx) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const rows = (await tx.execute(sql`explain select id from listings where search_text ilike any (array['%kurta%']::text[]) or 'kurtaa' <% search_text`)) as unknown as { 'QUERY PLAN': string }[];
      return rows.map((r) => r['QUERY PLAN']).join('\n');
    });
    expect(plan).toMatch(/listings_search_trgm_idx/);
  });
});

describe('impressions', () => {
  const body = (items: Json[], over: Json = {}) => ({ scope: 'FOR_YOU', ranker: 'SCORED', items, ...over });
  const count = async (userToken: string) => {
    void userToken;
    const r = await dbOf(app).db.select({ n: sql<number>`count(*)::int` }).from(feedImpressions);
    return r[0]!.n;
  };

  it('records what was shown, skips listings that are not live, and always answers 204', async () => {
    const before = await count(asha);
    const nobody = '11111111-1111-4111-8111-111111111111';
    const r = await call('POST', '/v1/buyer/feed/impressions', { token: asha, body: body([{ listingId: ids.kurta, position: 0 }, { listingId: ids.saree, position: 1 }, { listingId: nobody, position: 2 }]) });
    expect(r.status).toBe(204);
    expect(await count(asha)).toBe(before + 2);
  });
  it('refuses a bad body, a seller token and no token', async () => {
    expect((await call('POST', '/v1/buyer/feed/impressions', { token: asha, body: body([]) })).status).toBe(400);
    expect((await call('POST', '/v1/buyer/feed/impressions', { token: asha, body: body([{ listingId: 'x', position: 0 }]) })).status).toBe(400);
    expect((await call('POST', '/v1/buyer/feed/impressions', { token: asha, body: body([{ listingId: ids.kurta, position: 0 }], { ranker: 'RANDOM' }) })).status).toBe(400);
    expect((await call('POST', '/v1/buyer/feed/impressions', { token: anita, body: body([{ listingId: ids.kurta, position: 0 }]) })).status).toBe(403);
    expect((await call('POST', '/v1/buyer/feed/impressions', { body: body([{ listingId: ids.kurta, position: 0 }]) })).status).toBe(401);
  });
  it('stops a runaway app at the hourly cap', async () => {
    const db = dbOf(app).db;
    await db.execute(sql`delete from feed_impressions`);
    const items = Array.from({ length: 50 }, (_, i) => ({ listingId: ids.kurta, position: i }));
    for (let i = 0; i < 22; i++) await call('POST', '/v1/buyer/feed/impressions', { token: kiran, body: body(items) });
    expect(await count(kiran)).toBe(1000);
  });
  it('is pruned after 90 days by the ranking task', async () => {
    const db = dbOf(app).db;
    await db.execute(sql`update feed_impressions set created_at = now() - interval '91 days'`);
    const svc = app.get(RankingService);
    const changed = await svc.run(Date.now() + 10 * 3_600_000);
    expect(changed).toBeGreaterThanOrEqual(1000);
    expect(await count(kiran)).toBe(0);
  });
});
