import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '1000' });
});
afterEach(async () => {
  await dbOf(app).db.execute(sql`truncate table users cascade`);
  await dbOf(app).db.execute(sql`truncate table otp_attempts`);
});
afterAll(async () => {
  await app.close();
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await app.inject({ method, url, headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {}, ...(opts.body !== undefined ? { payload: opts.body as object } : {}) });
  return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : null) as Json };
};
const address = (n = 1) => ({ name: `Kiran ${n}`, line1: `${n}`, line2: 'Miyapur', pin: '500049', city: 'Hyderabad', state: 'Telangana' });
/** A signed-in buyer who has finished onboarding with one address. */
async function buyer(phone: string): Promise<string> {
  const r = await call('POST', '/v1/auth/otp/verify', { body: { phone, code: '123456', app: 'buyer' } });
  const token = r.body.accessToken as string;
  const saved = await call('PUT', '/v1/buyer/profile', { token, body: { name: 'Kiran', address: address(1), contact: { phone }, agreementAccepted: true } });
  expect(saved.status).toBe(200);
  return token;
}

describe('delivery addresses', () => {
  it('adds an address; the default stays the first unless asked', async () => {
    const t = await buyer('9876500301');
    const first = (await call('GET', '/v1/buyer/profile', { token: t })).body;
    const added = await call('POST', '/v1/buyer/addresses', { token: t, body: address(2) });
    expect(added.status).toBe(201);
    expect(added.body.addresses).toHaveLength(2);
    expect(added.body.defaultAddressId).toBe(first.defaultAddressId);
    const second = await call('POST', '/v1/buyer/addresses', { token: t, body: { ...address(3), makeDefault: true } });
    const newest = second.body.addresses.find((a: Json) => a.line1 === '3');
    expect(second.body.defaultAddressId).toBe(newest.id);
  });

  it('checks the same address rules as onboarding and names the fields', async () => {
    const t = await buyer('9876500302');
    const bad = await call('POST', '/v1/buyer/addresses', { token: t, body: { ...address(2), pin: '12', city: ' ' } });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION');
    expect(Object.keys(bad.body.fields)).toEqual(expect.arrayContaining(['pin', 'city']));
    expect((await call('GET', '/v1/buyer/profile', { token: t })).body.addresses).toHaveLength(1);
  });

  it('edits only your own address (another buyer gets 404 and nothing changes)', async () => {
    const a = await buyer('9876500303');
    const b = await buyer('9876500304');
    const mine = (await call('GET', '/v1/buyer/profile', { token: a })).body.addresses[0];
    const hijack = await call('PUT', `/v1/buyer/addresses/${mine.id}`, { token: b, body: address(9) });
    expect(hijack.status).toBe(404);
    expect((await call('GET', '/v1/buyer/profile', { token: a })).body.addresses[0].line1).toBe('1');
    const ok = await call('PUT', `/v1/buyer/addresses/${mine.id}`, { token: a, body: { ...address(5), line2: ' Gachibowli ' } });
    expect(ok.status).toBe(200);
    expect(ok.body.addresses[0]).toMatchObject({ id: mine.id, line1: '5', line2: 'Gachibowli' });
  });

  it('cannot delete or default someone else’s address, and the seller app token is refused', async () => {
    const a = await buyer('9876500305');
    const b = await buyer('9876500306');
    const mine = (await call('GET', '/v1/buyer/profile', { token: a })).body.addresses[0];
    expect((await call('DELETE', `/v1/buyer/addresses/${mine.id}`, { token: b })).status).toBe(404);
    expect((await call('POST', `/v1/buyer/addresses/${mine.id}/default`, { token: b })).status).toBe(404);
    const seller = (await call('POST', '/v1/auth/otp/verify', { body: { phone: '9876500305', code: '123456', app: 'seller' } })).body.accessToken as string;
    expect((await call('POST', '/v1/buyer/addresses', { token: seller, body: address(2) })).status).toBe(403);
  });

  it('refuses to delete the only address', async () => {
    const t = await buyer('9876500307');
    const only = (await call('GET', '/v1/buyer/profile', { token: t })).body.addresses[0];
    const r = await call('DELETE', `/v1/buyer/addresses/${only.id}`, { token: t });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('LAST_ADDRESS');
    expect((await call('GET', '/v1/buyer/profile', { token: t })).body.addresses).toHaveLength(1);
  });

  it('deleting the default makes another address the default', async () => {
    const t = await buyer('9876500308');
    const p1 = (await call('GET', '/v1/buyer/profile', { token: t })).body;
    const p2 = (await call('POST', '/v1/buyer/addresses', { token: t, body: address(2) })).body;
    const second = p2.addresses.find((a: Json) => a.id !== p1.defaultAddressId);
    const after = await call('DELETE', `/v1/buyer/addresses/${p1.defaultAddressId}`, { token: t });
    expect(after.status).toBe(200);
    expect(after.body.addresses.map((a: Json) => a.id)).toEqual([second.id]);
    expect(after.body.defaultAddressId).toBe(second.id);
  });

  it('sets a default, and holds at most 10 addresses even when added at the same moment', async () => {
    const t = await buyer('9876500309');
    const p = (await call('POST', '/v1/buyer/addresses', { token: t, body: address(2) })).body;
    const other = p.addresses[1];
    const set = await call('POST', `/v1/buyer/addresses/${other.id}/default`, { token: t });
    expect(set.body.defaultAddressId).toBe(other.id);
    // 2 now; 12 simultaneous adds may fill only 8 more.
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => call('POST', '/v1/buyer/addresses', { token: t, body: address(10 + i) })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(8);
    expect(results.filter((r) => r.status === 400).every((r) => /up to 10/.test(r.body.detail ?? r.body.title ?? ''))).toBe(true);
    expect((await call('GET', '/v1/buyer/profile', { token: t })).body.addresses).toHaveLength(10);
  });

  it('needs a profile first', async () => {
    const r = await call('POST', '/v1/auth/otp/verify', { body: { phone: '9876500310', code: '123456', app: 'buyer' } });
    const add = await call('POST', '/v1/buyer/addresses', { token: r.body.accessToken, body: address(1) });
    expect(add.status).toBe(403);
    expect(add.body.code).toBe('NO_PROFILE');
  });
});
