import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IDEMPOTENCY_TTL_MS, IdempotencyService, hashRequest } from '../src/common/idempotency.service.js';
import { dbOf, startApp } from './helpers.js';

describe('idempotency keys (real database)', () => {
  let app: NestFastifyApplication;
  let svc: IdempotencyService;
  const now = Date.UTC(2026, 9, 30, 10, 0, 0);
  const h = hashRequest('POST', '/v1/buyer/offers', { amount: 200000 });

  beforeAll(async () => {
    app = await startApp();
    svc = app.get(IdempotencyService);
  });
  beforeEach(async () => {
    await dbOf(app).db.execute(sql`truncate table idempotency_keys`);
  });
  afterAll(async () => {
    await app.close();
  });

  it('claims a new key, then replays the stored response on retry', async () => {
    expect(await svc.begin('u1', 'k1', h, now)).toEqual({ state: 'NEW' });
    await svc.complete('u1', 'k1', 201, { negotiationId: 'ng_1' });
    expect(await svc.begin('u1', 'k1', h, now)).toEqual({ state: 'REPLAY', status: 201, body: { negotiationId: 'ng_1' } });
  });

  it('reports IN_PROGRESS while the first attempt has not finished', async () => {
    await svc.begin('u1', 'k1', h, now);
    expect(await svc.begin('u1', 'k1', h, now)).toEqual({ state: 'IN_PROGRESS' });
  });

  it('rejects the same key with a different request', async () => {
    await svc.begin('u1', 'k1', h, now);
    expect(await svc.begin('u1', 'k1', hashRequest('POST', '/v1/buyer/offers', { amount: 190000 }), now)).toEqual({ state: 'MISMATCH' });
  });

  it('keeps keys separate per caller', async () => {
    await svc.begin('u1', 'k1', h, now);
    expect(await svc.begin('u2', 'k1', h, now)).toEqual({ state: 'NEW' });
  });

  it('lets exactly one of several concurrent first attempts win', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => svc.begin('u1', 'race', h, now)));
    expect(results.filter((r) => r.state === 'NEW')).toHaveLength(1);
    expect(results.filter((r) => r.state === 'IN_PROGRESS')).toHaveLength(7);
  });

  it('frees an abandoned key and purges expired ones', async () => {
    await svc.begin('u1', 'k1', h, now);
    await svc.abandon('u1', 'k1');
    expect(await svc.begin('u1', 'k1', h, now)).toEqual({ state: 'NEW' });
    expect(await svc.purgeExpired(now)).toBe(0);
    expect(await svc.purgeExpired(now + IDEMPOTENCY_TTL_MS + 1)).toBe(1);
  });
});
