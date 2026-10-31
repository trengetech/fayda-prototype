import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createApiClient, type ApiClient } from './client';
import type { SessionManager, SessionState } from './session';

const ClientContext = createContext<ApiClient | null>(null);

/** Provides the typed client and a TanStack Query cache to the app. */
export function ApiProvider({ baseUrl, client: given, children }: { baseUrl?: string; client?: ApiClient; children: ReactNode }) {
  const client = useMemo(() => given ?? createApiClient({ baseUrl: baseUrl ?? '' }), [given, baseUrl]);
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } }), []);
  return (
    <ClientContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ClientContext.Provider>
  );
}

export function useApiClient(): ApiClient {
  const c = useContext(ClientContext);
  if (!c) throw new Error('useApiClient must be used inside ApiProvider');
  return c;
}

export function useHealth() {
  const client = useApiClient();
  return useQuery({ queryKey: ['health', client.baseUrl], queryFn: () => client.getHealth() });
}

export function useMeta() {
  const client = useApiClient();
  return useQuery({ queryKey: ['meta', client.baseUrl], queryFn: () => client.getMeta() });
}

const SessionContext = createContext<SessionManager | null>(null);

/** Provides the session manager. Wrap ApiProvider with it, passing `manager.client` to ApiProvider. */
export function SessionProvider({ manager, children }: { manager: SessionManager; children: ReactNode }) {
  return <SessionContext.Provider value={manager}>{children}</SessionContext.Provider>;
}

export function useSessionManager(): SessionManager {
  const m = useContext(SessionContext);
  if (!m) throw new Error('useSessionManager must be used inside SessionProvider');
  return m;
}

export function useSession(): SessionState {
  return useStore(useSessionManager().store);
}
