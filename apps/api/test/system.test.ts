import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { HealthSchema, MetaSchema, ProblemSchema, buildOpenApiDocument } from '@fayda/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { APP_VERSION } from '../src/version.js';
import { dbOf, startApp } from './helpers.js';

describe('system endpoints (real Supabase test database)', () => {
  let app: NestFastifyApplication;
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health is 200 and reports the database as up', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthSchema.parse(res.json());
    expect(body.status).toBe('ok');
    expect(body.database.status).toBe('up');
    expect(body.database.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('answers many concurrent requests through the transaction pooler (regression: pipelining hung)', async () => {
    const res = await Promise.all(Array.from({ length: 24 }, () => app.inject({ method: 'GET', url: '/v1/health' })));
    expect(res.every((r) => r.statusCode === 200)).toBe(true);
  });

  it('GET /v1/health is 503 when the database is down, and leaks no error details', async () => {
    const spy = vi.spyOn(dbOf(app), 'ping').mockRejectedValue(new Error('connect ECONNREFUSED secret-host:6543'));
    const res = await app.inject({ method: 'GET', url: '/v1/health' });
    spy.mockRestore();
    expect(res.statusCode).toBe(503);
    const body = HealthSchema.parse(res.json());
    expect(body).toMatchObject({ status: 'down', database: { status: 'down', latencyMs: null } });
    expect(res.body).not.toContain('secret-host');
  });

  it('GET /v1/meta lists the environment and every provider with a simulated flag', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/meta' });
    expect(res.statusCode).toBe(200);
    const body = MetaSchema.parse(res.json());
    expect(body.environment).toBe('test');
    expect(body.version).toBe(APP_VERSION);
    expect(body.providers.length).toBeGreaterThan(0);
    expect(body.providers.every((p) => typeof p.simulated === 'boolean')).toBe(true);
    expect(body.providers.find((p) => p.key === 'auth')?.simulated).toBe(true);
  });

  it('GET /v1/openapi.json serves the document generated from the contracts', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(JSON.parse(JSON.stringify(buildOpenApiDocument(APP_VERSION))));
  });

  it('unknown routes return problem+json with a stable code', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(ProblemSchema.parse(res.json()).code).toBe('NOT_FOUND');
  });

  it('sets security headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/meta' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
