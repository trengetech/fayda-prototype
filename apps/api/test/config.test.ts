import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = { DATABASE_URL: 'postgresql://user:pw@host:6543/postgres' };

describe('loadConfig environment label', () => {
  it('defaults to NODE_ENV', () => {
    expect(loadConfig({ ...base, NODE_ENV: 'production' }).environment).toBe('production');
  });
  it('APP_ENV overrides the label without changing anything else', () => {
    const c = loadConfig({ ...base, NODE_ENV: 'production', APP_ENV: 'development' });
    expect(c.environment).toBe('development');
  });
  it('rejects an unknown label and never echoes secrets in the error', () => {
    expect(() => loadConfig({ ...base, APP_ENV: 'staging' })).toThrow(/APP_ENV/);
    expect(() => loadConfig({ DATABASE_URL: 'mysql://secret-pw@host' })).toThrow(/DATABASE_URL/);
    try { loadConfig({ DATABASE_URL: 'mysql://secret-pw@host' }); } catch (e) { expect(String(e)).not.toContain('secret-pw'); }
  });
});
