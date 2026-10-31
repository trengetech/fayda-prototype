import { ApiProvider, SessionProvider, createSessionManager, type SecureStorage, type SessionManager } from '@fayda/api-client';
import { ThemeProvider } from '@fayda/ui';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
export const problem = (status: number, code: string, fields?: Record<string, string>, detail = 'Something is wrong') => json({ title: 'x', status, code, detail, ...(fields ? { fields } : {}) }, status);

export const memoryStorage = (): SecureStorage => {
  const m = new Map<string, string>();
  return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k) };
};

export const user = { id: 'u1', phone: '9876543210', name: null };

/** A session manager wired to a fake fetch. `state` lets a test start already signed in. */
export function managerWith(app: 'buyer' | 'seller', fetchFn: jest.Mock, state?: { missing: string[] }): SessionManager {
  const m = createSessionManager({ baseUrl: 'http://api.test', app, storage: memoryStorage(), fetch: fetchFn as unknown as typeof fetch });
  if (state) m.store.setState({ status: 'signedIn', user, profile: { complete: state.missing.length === 0, missing: state.missing } });
  else m.store.setState({ status: 'signedOut' });
  return m;
}

export const renderWith = (manager: SessionManager, ui: ReactElement) =>
  render(
    <ThemeProvider>
      <SessionProvider manager={manager}>
        <ApiProvider client={manager.client}>{ui}</ApiProvider>
      </SessionProvider>
    </ThemeProvider>,
  );
