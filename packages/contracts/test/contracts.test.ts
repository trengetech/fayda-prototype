import { describe, expect, it } from 'vitest';
import { ERROR_CODES, HealthSchema, MetaSchema, PaiseSchema, ProblemSchema, buildOpenApiDocument } from '../src/index.js';

describe('system contracts', () => {
  it('accepts a healthy response and a database-down response', () => {
    const up = { status: 'ok', database: { status: 'up', latencyMs: 12 }, time: new Date().toISOString() };
    const down = { status: 'down', database: { status: 'down', latencyMs: null }, time: new Date().toISOString() };
    expect(HealthSchema.safeParse(up).success).toBe(true);
    expect(HealthSchema.safeParse(down).success).toBe(true);
  });
  it('rejects a malformed health response', () => {
    expect(HealthSchema.safeParse({ status: 'fine', database: {}, time: 'now' }).success).toBe(false);
  });
  it('requires a simulated flag on every provider', () => {
    const ok = { environment: 'development', version: '0.0.0', providers: [{ key: 'auth', name: 'dev-otp', simulated: true }] };
    expect(MetaSchema.safeParse(ok).success).toBe(true);
    const missing = { ...ok, providers: [{ key: 'auth', name: 'dev-otp' }] };
    expect(MetaSchema.safeParse(missing).success).toBe(false);
  });
});

describe('common contracts', () => {
  it('money is integer paise', () => {
    expect(PaiseSchema.safeParse(250000).success).toBe(true);
    expect(PaiseSchema.safeParse(2500.5).success).toBe(false);
    expect(PaiseSchema.safeParse(-1).success).toBe(false);
  });
  it('problem bodies carry a stable error code', () => {
    expect(ProblemSchema.safeParse({ title: 'Not found', status: 404, code: 'NOT_FOUND' }).success).toBe(true);
    expect(ProblemSchema.safeParse({ title: 'x', status: 400, code: 'MADE_UP' }).success).toBe(false);
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe('OpenAPI', () => {
  const doc = buildOpenApiDocument('0.0.0');
  it('is generated from the Zod contracts', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(Object.keys(doc.paths ?? {})).toEqual(['/v1/health', '/v1/meta']);
  });
  it('documents the 503 health response and the simulated flag', () => {
    expect(JSON.stringify(doc.paths?.['/v1/health'])).toContain('503');
    expect(JSON.stringify(doc.components?.schemas)).toContain('simulated');
  });
});
