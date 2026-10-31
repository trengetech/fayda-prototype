import type { ListingInput } from '@fayda/contracts/schemas';
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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

export const sellerListingsKey = (baseUrl: string) => ['seller-listings', baseUrl] as const;

export function useSellerListings() {
  const client = useApiClient();
  return useQuery({ queryKey: sellerListingsKey(client.baseUrl), queryFn: () => client.listSellerListings() });
}

export function useSellerListing(id: string | null) {
  const client = useApiClient();
  return useQuery({ queryKey: ['seller-listing', client.baseUrl, id], queryFn: () => client.getSellerListing(id as string), enabled: !!id });
}

/** Saves a listing (creates it when there is no `id`). Pass the same `idempotencyKey` when retrying the same save. */
export function useSaveListing() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input, idempotencyKey }: { id?: string | null; input: ListingInput; idempotencyKey?: string }) =>
      id ? client.updateListing(id, input, idempotencyKey) : client.createListing(input, idempotencyKey),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-listings'] }).then(() => qc.invalidateQueries({ queryKey: ['seller-listing'] })),
  });
}

export function useSetListingStatus() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'ACTIVE' | 'PAUSED' }) => client.setListingStatus(id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-listings'] }).then(() => qc.invalidateQueries({ queryKey: ['seller-listing'] })),
  });
}

export function useDeleteListingDraft() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({ mutationFn: (id: string) => client.deleteListingDraft(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['seller-listings'] }) });
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
