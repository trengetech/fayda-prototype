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

/** A fake API: routes are keyed "METHOD /path". An unexpected request fails the test with its name. */
export type Route = (init: { method: string; headers: Record<string, string>; body: unknown }) => Response | Promise<Response>;
export function fakeApi(routes: Record<string, Route>, fetchFn: jest.Mock) {
  fetchFn.mockImplementation((url: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const key = `${init.method ?? 'GET'} ${String(url).replace('http://api.test', '')}`;
    const route = routes[key];
    if (!route) return Promise.reject(new Error(`Unexpected request: ${key}`));
    return Promise.resolve(route({ method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined }));
  });
}

const seller = { id: 's1', name: 'Kiran Studio', handle: 'kiranstudio', area: 'Madhapur', city: 'Hyderabad' };
export const feedItem = (over: Record<string, unknown> = {}) => ({
  id: '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70', title: 'Cotton kurta', price: 150000, category: 'Ethnic wear', soldOut: false, acceptsOffers: true, coverUrl: '/v1/media/m1', hasVideo: false, seller, ...over,
});
export const buyerListing = (over: Record<string, unknown> = {}) => ({
  id: '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70', title: 'Cotton kurta', description: 'Block print, soft cotton.', category: 'Ethnic wear', price: 150000, soldOut: false,
  media: [{ kind: 'image', url: '/v1/media/m1', posterUrl: null }],
  variants: [{ id: 'v1', label: 'M', available: true, low: false }],
  bargaining: { mode: 'BOTH', acceptsOffers: true, expiryMinutes: 1440 }, checkout: { channel: 'DIRECT', productUrl: null }, seller, ...over,
});

export const buyerNegotiation = (over: Record<string, unknown> = {}) => ({
  id: 'n1', listing: { id: '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70', title: 'Cotton kurta', price: 150000, coverUrl: '/v1/media/m1', variantLabel: 'M', sellerName: 'Kiran Studio' },
  status: 'OPEN', statusLabel: 'Waiting for seller', closeReason: null, closeText: null, variantId: 'v1',
  offers: [{ id: 'o1', side: 'ME', amount: 100000, status: 'PENDING', at: 1, expiresAt: Date.now() + 3_600_000 }], events: [],
  pendingExpiresAt: Date.now() + 3_600_000, agreement: null, channel: 'DIRECT', canRespond: false, canCounter: false, canWithdraw: true, counterBounds: null,
  offersLeft: 5, updatedAt: 1, ...over,
});
/** The seller has countered at ₹1,400. */
export const sellerCountered = (over: Record<string, unknown> = {}) =>
  buyerNegotiation({
    statusLabel: 'Seller countered', canRespond: true, canCounter: true, canWithdraw: false, counterBounds: { minExclusive: 100000, maxExclusive: 140000 }, offersLeft: 4,
    offers: [
      { id: 'o1', side: 'ME', amount: 100000, status: 'COUNTERED', at: 1, expiresAt: 9 },
      { id: 'o2', side: 'SELLER', amount: 140000, status: 'PENDING', at: 2, expiresAt: Date.now() + 3_600_000 },
    ],
    ...over,
  });
