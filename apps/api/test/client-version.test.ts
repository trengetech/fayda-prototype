import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { CONTRACT_LEVEL } from '@fayda/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { clientTooOld } from '../src/common/client-version.js';
import { makeCaller, type Caller } from './api.js';
import { startApp } from './helpers.js';

// Apps send X-Client-App and X-Client-Level; the server refuses an app older than it accepts with 426 CLIENT_TOO_OLD.
let dir: string;
let open: NestFastifyApplication;
let strict: NestFastifyApplication;
let callOpen: Caller;
let callStrict: Caller;
const PROBE = '/v1/buyer/notifications/unread-count'; // needs sign-in: 401 means "the version check let it through"
const hdr = (app: string, level: string) => ({ 'x-client-app': app, 'x-client-level': level });

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-clientver-'));
  open = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir });
  strict = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '10000', UPLOADS_DIR: dir, MIN_CLIENT_LEVEL_BUYER: '5' });
  callOpen = makeCaller(open);
  callStrict = makeCaller(strict);
});
afterAll(async () => {
  await open.close();
  await strict.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('/v1/meta reports the levels', () => {
  it('says its own level and the oldest it accepts for each app', async () => {
    const r = await callOpen('GET', '/v1/meta');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ apiLevel: CONTRACT_LEVEL, minClientLevel: { buyer: 1, seller: 1 } });
    expect((await callStrict('GET', '/v1/meta')).body.minClientLevel).toEqual({ buyer: 5, seller: 1 });
  });

  it('rejects a minimum that is not a whole number of at least 1', () => {
    const env = { NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(32), DATABASE_URL: 'postgres://x' };
    expect(() => loadConfig({ ...env, MIN_CLIENT_LEVEL_BUYER: '0' })).toThrow(/MIN_CLIENT_LEVEL_BUYER/);
    expect(() => loadConfig({ ...env, MIN_CLIENT_LEVEL_SELLER: 'two' })).toThrow(/MIN_CLIENT_LEVEL_SELLER/);
    expect(loadConfig(env).minClientLevel).toEqual({ buyer: 1, seller: 1 });
  });
});

describe('an app that is too old', () => {
  it('gets 426 CLIENT_TOO_OLD with a plain message, on any route but the exempt ones', async () => {
    const r = await callStrict('GET', PROBE, { headers: hdr('buyer', '2') });
    expect(r.status).toBe(426);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.body).toMatchObject({ status: 426, code: 'CLIENT_TOO_OLD', title: 'Upgrade required' });
    expect(r.body.detail).toMatch(/update the app/i);
    expect((await callStrict('POST', '/v1/auth/otp/verify', { headers: hdr('buyer', '4'), body: { phone: '9000000000', code: '123456', app: 'buyer' } })).status).toBe(426);
  });

  it('can still read health, meta and the API description, so it can tell the person to update', async () => {
    for (const path of ['/v1/health', '/v1/meta', '/v1/meta?x=1', '/v1/openapi.json']) {
      expect((await callStrict('GET', path, { headers: hdr('buyer', '1') })).status, path).toBe(200);
    }
  });
});

describe('everything else passes', () => {
  it('an app at or above the minimum, the other app, no header, and a header that cannot be read', async () => {
    const pass = async (headers?: Record<string, string>) => (await callStrict('GET', PROBE, headers ? { headers } : {})).status;
    expect(await pass(hdr('buyer', '5'))).toBe(401);
    expect(await pass(hdr('buyer', '9'))).toBe(401);
    expect(await pass(hdr('seller', '1'))).toBe(401); // the seller app has its own minimum (1)
    expect(await pass()).toBe(401); // a browser, a script, an app from before this check
    for (const level of ['abc', '0', '-3', '2.5', '']) expect(await pass(hdr('buyer', level)), `level "${level}"`).toBe(401);
    expect(await pass(hdr('tablet', '1'))).toBe(401);
    expect((await callOpen('GET', PROBE, { headers: hdr('buyer', '1') })).status).toBe(401);
  });

  it('the check itself: no header means no opinion', () => {
    expect(clientTooOld('/v1/buyer/feed', {}, { buyer: 9, seller: 9 })).toBeNull();
    expect(clientTooOld('/v1/buyer/feed', { 'x-client-app': 'buyer', 'x-client-level': '8' }, { buyer: 9, seller: 1 })?.code).toBe('CLIENT_TOO_OLD');
    expect(clientTooOld('/v1/buyer/feed', { 'x-client-app': 'seller', 'x-client-level': '8' }, { buyer: 9, seller: 1 })).toBeNull();
  });
});
