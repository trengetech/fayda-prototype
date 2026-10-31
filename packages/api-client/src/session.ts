import { createStore, type StoreApi } from 'zustand/vanilla';
import type { AppAudience, AuthResult, ProfileStatus, User } from '@fayda/contracts/schemas';
import { ApiError, NetworkError, createApiClient, type ApiClient } from './client';

/** Where the refresh token lives. The apps pass expo-secure-store; tests pass a Map. */
export interface SecureStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type SessionStatus = 'restoring' | 'signedOut' | 'signedIn' | 'offline';
export interface SessionState {
  status: SessionStatus;
  user: User | null;
  profile: ProfileStatus | null;
}

export interface SessionManager {
  /** Zustand store: session and UI state only. Server data lives in TanStack Query. */
  readonly store: StoreApi<SessionState>;
  readonly client: ApiClient;
  readonly app: AppAudience;
  /** Reads the saved refresh token and signs in again without asking for a code. Call once at start, and again to retry when offline. */
  restore(): Promise<void>;
  signIn(phone: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  /** Re-reads what is still missing from the profile (after saving a step). */
  refreshProfile(): Promise<void>;
}

export interface SessionOptions {
  baseUrl: string;
  app: AppAudience;
  storage: SecureStorage;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const keyFor = (app: AppAudience) => `fayda.${app}.refreshToken`;

export function createSessionManager(opts: SessionOptions): SessionManager {
  const store = createStore<SessionState>(() => ({ status: 'restoring', user: null, profile: null }));
  let accessToken: string | null = null;
  let refreshing: Promise<string | null> | null = null;

  const accept = async (r: AuthResult): Promise<void> => {
    accessToken = r.accessToken;
    await opts.storage.setItem(keyFor(opts.app), r.refreshToken);
    store.setState({ status: 'signedIn', user: r.user, profile: r.profile });
  };
  const endSession = async (): Promise<void> => {
    accessToken = null;
    await opts.storage.removeItem(keyFor(opts.app));
    store.setState({ status: 'signedOut', user: null, profile: null });
  };

  /** One refresh at a time: parallel calls that all got 401 share the same new token, because each refresh token works once. */
  const refreshAccess = (): Promise<string | null> => {
    refreshing ??= (async () => {
      const saved = await opts.storage.getItem(keyFor(opts.app));
      if (!saved) return null;
      try {
        await accept(await bare.refresh(saved));
        return accessToken;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) await endSession();
        return null;
      }
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  };

  const bare = createApiClient({ baseUrl: opts.baseUrl, ...(opts.fetch ? { fetch: opts.fetch } : {}), ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}) });
  const client = createApiClient({
    baseUrl: opts.baseUrl,
    ...(opts.fetch ? { fetch: opts.fetch } : {}),
    ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}),
    getAccessToken: () => accessToken,
    onUnauthorized: refreshAccess,
  });

  return {
    store,
    client,
    app: opts.app,
    async restore() {
      store.setState({ status: 'restoring' });
      const saved = await opts.storage.getItem(keyFor(opts.app));
      if (!saved) return void store.setState({ status: 'signedOut' });
      try {
        await accept(await bare.refresh(saved));
      } catch (e) {
        // Offline is not "signed out": keep the saved token and let the user retry.
        if (e instanceof NetworkError) store.setState({ status: 'offline' });
        else await endSession();
      }
    },
    async signIn(phone, code) {
      await accept(await bare.verifyOtp(phone, code, opts.app));
    },
    async signOut() {
      try {
        if (accessToken) await client.logout();
      } catch {
        // The session may already be gone or the network down; either way this device forgets it.
      }
      await endSession();
    },
    async refreshProfile() {
      const me = await client.me();
      store.setState({ user: me.user, profile: me.profile });
    },
  };
}
