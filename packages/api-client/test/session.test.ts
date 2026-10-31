import { describe, expect, it } from 'vitest';
import { createSessionManager, type SecureStorage } from '../src/session';

const user = { id: 'u1', phone: '9876543210', name: null };
const profile = { complete: false, missing: ['name'] };
const auth = (n: number) => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresInSeconds: 900, user, app: 'buyer', profile });
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const problem = (status: number, code: string) => json(status, { title: 'x', status, code });

function memoryStorage(initial: Record<string, string> = {}): SecureStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return { data, getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) };
}

/** A tiny fake API: one valid refresh token at a time, and one valid access token. */
function fakeServer() {
  const s = { n: 1, validRefresh: 'refresh-1', validAccess: 'access-1', calls: [] as string[], offline: false, refreshes: 0 };
  const fetchFn: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    s.calls.push(`${init?.method ?? 'GET'} ${path}`);
    if (s.offline) throw new TypeError('Network request failed');
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const bearer = new Headers(init?.headers).get('authorization');
    if (path === '/v1/auth/otp/verify') return body.code === '123456' ? json(200, auth(s.n)) : problem(400, 'INVALID_OTP');
    if (path === '/v1/auth/refresh') {
      s.refreshes++;
      if (body.refreshToken !== s.validRefresh) return problem(401, 'UNAUTHENTICATED');
      s.n++;
      s.validRefresh = `refresh-${s.n}`;
      s.validAccess = `access-${s.n}`;
      return json(200, auth(s.n));
    }
    if (path === '/v1/me') return bearer === `Bearer ${s.validAccess}` ? json(200, { user, app: 'buyer', profile }) : problem(401, 'UNAUTHENTICATED');
    if (path === '/v1/auth/logout') return new Response(null, { status: 204 });
    return problem(404, 'NOT_FOUND');
  };
  return { s, fetchFn };
}
const make = (storage: SecureStorage, f: typeof fetch) => createSessionManager({ baseUrl: 'http://api.test', app: 'buyer', storage, fetch: f });

describe('session manager', () => {
  it('starts signed out when nothing is saved', async () => {
    const m = make(memoryStorage(), fakeServer().fetchFn);
    expect(m.store.getState().status).toBe('restoring');
    await m.restore();
    expect(m.store.getState().status).toBe('signedOut');
  });

  it('signs in, keeps only the refresh token, and exposes the missing profile fields', async () => {
    const storage = memoryStorage();
    const m = make(storage, fakeServer().fetchFn);
    await m.signIn('9876543210', '123456');
    expect(m.store.getState()).toMatchObject({ status: 'signedIn', user: { id: 'u1' }, profile: { missing: ['name'] } });
    expect([...storage.data.entries()]).toEqual([['fayda.buyer.refreshToken', 'refresh-1']]);
  });

  it('does not sign in with a wrong code', async () => {
    const m = make(memoryStorage(), fakeServer().fetchFn);
    await expect(m.signIn('9876543210', '000000')).rejects.toMatchObject({ problem: { code: 'INVALID_OTP' } });
    expect(m.store.getState().status).not.toBe('signedIn');
  });

  it('restores a saved session without asking for a code, and saves the rotated token', async () => {
    const { fetchFn } = fakeServer();
    const storage = memoryStorage({ 'fayda.buyer.refreshToken': 'refresh-1' });
    const m = make(storage, fetchFn);
    await m.restore();
    expect(m.store.getState().status).toBe('signedIn');
    expect(storage.data.get('fayda.buyer.refreshToken')).toBe('refresh-2');
  });

  it('signs out when the saved token is refused, but stays signed in (offline) when the network is down', async () => {
    const stale = memoryStorage({ 'fayda.buyer.refreshToken': 'old' });
    const m1 = make(stale, fakeServer().fetchFn);
    await m1.restore();
    expect(m1.store.getState().status).toBe('signedOut');
    expect(stale.data.size).toBe(0);

    const srv = fakeServer();
    srv.s.offline = true;
    const kept = memoryStorage({ 'fayda.buyer.refreshToken': 'refresh-1' });
    const m2 = make(kept, srv.fetchFn);
    await m2.restore();
    expect(m2.store.getState().status).toBe('offline');
    expect(kept.data.get('fayda.buyer.refreshToken')).toBe('refresh-1');
    srv.s.offline = false;
    await m2.restore();
    expect(m2.store.getState().status).toBe('signedIn');
  });

  it('refreshes once and retries when an expired access token is refused, even for parallel calls', async () => {
    const srv = fakeServer();
    const m = make(memoryStorage(), srv.fetchFn);
    await m.signIn('9876543210', '123456');
    srv.s.validAccess = 'expired-elsewhere'; // the server no longer accepts access-1
    const before = srv.s.refreshes;
    const [a, b] = await Promise.all([m.client.me(), m.client.me()]);
    expect(a.user.id).toBe('u1');
    expect(b.user.id).toBe('u1');
    expect(srv.s.refreshes - before).toBe(1);
  });

  it('ends the session when the refresh itself is refused', async () => {
    const srv = fakeServer();
    const storage = memoryStorage();
    const m = make(storage, srv.fetchFn);
    await m.signIn('9876543210', '123456');
    srv.s.validAccess = 'x';
    srv.s.validRefresh = 'revoked';
    await expect(m.client.me()).rejects.toMatchObject({ status: 401 });
    expect(m.store.getState().status).toBe('signedOut');
    expect(storage.data.size).toBe(0);
  });

  it('signs out locally even if the server cannot be reached', async () => {
    const srv = fakeServer();
    const storage = memoryStorage();
    const m = make(storage, srv.fetchFn);
    await m.signIn('9876543210', '123456');
    srv.s.offline = true;
    await m.signOut();
    expect(m.store.getState()).toMatchObject({ status: 'signedOut', user: null });
    expect(storage.data.size).toBe(0);
  });
});
