import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ManualClock, dbOf, startApp } from './helpers.js';

const PHONE = '9876500077';
const MIN = 60_000;

let clock: ManualClock;
let first: NestFastifyApplication;
let second: NestFastifyApplication;

beforeAll(async () => {
  clock = new ManualClock();
  // Two API processes on one database, as in production.
  first = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000' }, clock);
  second = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000' }, clock);
});
beforeEach(async () => {
  await dbOf(first).db.execute(sql`truncate table users cascade`);
  await dbOf(first).db.execute(sql`truncate table otp_attempts`);
});
afterAll(async () => {
  await first.close();
  await second.close();
});

const verify = async (app: NestFastifyApplication, code: string) => {
  const res = await app.inject({ method: 'POST', url: '/v1/auth/otp/verify', payload: { phone: PHONE, code, app: 'buyer' } });
  return { status: res.statusCode, code: (JSON.parse(res.body) as { code?: string }).code };
};

describe('wrong-code lockout is shared through the database', () => {
  it('counts wrong codes across two API processes and locks both', async () => {
    for (let i = 0; i < 3; i++) expect((await verify(first, '000000')).status).toBe(400);
    for (let i = 0; i < 2; i++) expect((await verify(second, '000000')).status).toBe(400);
    // Five wrong tries in total: the right code is now refused by either process.
    expect(await verify(first, '123456')).toEqual({ status: 429, code: 'RATE_LIMITED' });
    expect(await verify(second, '123456')).toEqual({ status: 429, code: 'RATE_LIMITED' });
  });

  it('does not lose counts when wrong codes arrive at the same moment', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => verify(i % 2 ? first : second, '000000')));
    expect(results.every((r) => r.status === 400)).toBe(true);
    expect((await verify(first, '123456')).status).toBe(429);
  });

  it('unlocks after 5 minutes and starts counting again from one', async () => {
    for (let i = 0; i < 5; i++) await verify(first, '000000');
    expect((await verify(second, '123456')).status).toBe(429);
    clock.advance(5 * MIN + 1);
    // One wrong try after the lock ends is a first try, not a sixth.
    expect((await verify(second, '000000')).status).toBe(400);
    expect((await verify(first, '123456')).status).toBe(200);
  });

  it('a right code clears the count', async () => {
    for (let i = 0; i < 4; i++) await verify(first, '000000');
    expect((await verify(second, '123456')).status).toBe(200);
    for (let i = 0; i < 4; i++) expect((await verify(first, '000000')).status).toBe(400);
    expect((await verify(second, '123456')).status).toBe(200);
  });
});
