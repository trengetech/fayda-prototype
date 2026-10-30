import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError, createApiClient } from '../src/client';

const json = (status: number, body: unknown, type = 'application/json') => new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });
const health = { status: 'ok', database: { status: 'up', latencyMs: 20 }, time: '2026-10-31T10:00:00.000Z' };
const meta = { environment: 'development', version: '0.0.0', providers: [{ key: 'auth', name: 'dev-otp', simulated: true }] };
const client = (f: typeof fetch) => createApiClient({ baseUrl: 'http://api.test/', fetch: f, timeoutMs: 200 });

describe('api client', () => {
  it('parses health and meta, and trims the trailing slash', async () => {
    const urls: string[] = [];
    const c = client(async (u) => { urls.push(String(u)); return String(u).endsWith('health') ? json(200, health) : json(200, meta); });
    expect((await c.getHealth()).database.latencyMs).toBe(20);
    expect((await c.getMeta()).providers[0]?.simulated).toBe(true);
    expect(urls).toEqual(['http://api.test/v1/health', 'http://api.test/v1/meta']);
  });

  it('returns a 503 health body as data (database down), not an error', async () => {
    const down = { status: 'down', database: { status: 'down', latencyMs: null }, time: health.time };
    expect((await client(async () => json(503, down)).getHealth()).status).toBe('down');
  });

  it('turns problem+json into an ApiError with its code', async () => {
    const p = { title: 'Not found', status: 404, code: 'NOT_FOUND', detail: 'Cannot GET /v1/meta' };
    const err = await client(async () => json(404, p, 'application/problem+json')).getMeta().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).problem?.code).toBe('NOT_FOUND');
    expect((err as ApiError).message).toBe('Cannot GET /v1/meta');
  });

  it('rejects data in the wrong shape', async () => {
    const err = await client(async () => json(200, { status: 'fine' })).getHealth().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
  });

  it('reports an unreadable body', async () => {
    const err = await client(async () => new Response('<html>', { status: 502 })).getHealth().catch((e: unknown) => e);
    expect(err).toMatchObject({ name: 'ApiError', status: 502 });
  });

  it('reports a network failure and a timeout as NetworkError', async () => {
    const off = await client(async () => { throw new TypeError('Network request failed'); }).getHealth().catch((e: unknown) => e);
    expect(off).toBeInstanceOf(NetworkError);
    const slow: typeof fetch = (_u, init) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    const timeout = await client(slow).getHealth().catch((e: unknown) => e);
    expect(timeout).toBeInstanceOf(NetworkError);
    expect((timeout as Error).message).toContain('No answer');
  });
});
