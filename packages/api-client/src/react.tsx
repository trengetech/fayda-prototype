import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createApiClient, type ApiClient } from './client';

const ClientContext = createContext<ApiClient | null>(null);

/** Provides the typed client and a TanStack Query cache to the app. */
export function ApiProvider({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const client = useMemo(() => createApiClient({ baseUrl }), [baseUrl]);
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
