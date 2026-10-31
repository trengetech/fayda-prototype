import type { ListingInput } from '@fayda/contracts/schemas';
import { QueryClient, QueryClientProvider, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createApiClient, type ApiClient, type DealAccessInput } from './client';
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

/** The buyer feed, one page at a time: call `fetchNextPage` near the end of the list. */
export function useBuyerFeed() {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: ['buyer-feed', client.baseUrl],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.getBuyerFeed(pageParam),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useBuyerListing(id: string | null) {
  const client = useApiClient();
  return useQuery({ queryKey: ['buyer-listing', client.baseUrl, id], queryFn: () => client.getBuyerListing(id as string), enabled: !!id });
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

// ---------- bargaining ----------
/** Prefix of every negotiation query, so one call refreshes them all (a socket event or a finished action). */
export const NEGOTIATIONS_KEY = 'negotiations';

export function useBuyerNegotiations() {
  const client = useApiClient();
  return useQuery({ queryKey: [NEGOTIATIONS_KEY, 'buyer', client.baseUrl], queryFn: () => client.listBuyerNegotiations() });
}

export function useBuyerNegotiation(id: string | null) {
  const client = useApiClient();
  return useQuery({ queryKey: [NEGOTIATIONS_KEY, 'buyer', client.baseUrl, id], queryFn: () => client.getBuyerNegotiation(id as string), enabled: !!id });
}

export function useSellerNegotiations() {
  const client = useApiClient();
  return useQuery({ queryKey: [NEGOTIATIONS_KEY, 'seller', client.baseUrl], queryFn: () => client.listSellerNegotiations() });
}

export function useSellerNegotiation(id: string | null) {
  const client = useApiClient();
  return useQuery({ queryKey: [NEGOTIATIONS_KEY, 'seller', client.baseUrl, id], queryFn: () => client.getSellerNegotiation(id as string), enabled: !!id });
}

/** Makes a first offer. The same `idempotencyKey` on a retry cannot create a second negotiation. */
export function useMakeOffer() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, variantId, amount, idempotencyKey }: { listingId: string; variantId: string; amount: number; idempotencyKey?: string }) => client.startOffer(listingId, variantId, amount, idempotencyKey),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [NEGOTIATIONS_KEY] }).then(() => qc.invalidateQueries({ queryKey: ['buyer-listing'] })),
  });
}

export type BuyerAction = { id: string; action: 'counter'; amount: number } | { id: string; action: 'accept' | 'decline' | 'withdraw' };
export function useBuyerRespond() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: BuyerAction) => (a.action === 'counter' ? client.buyerCounter(a.id, a.amount) : a.action === 'accept' ? client.buyerAccept(a.id) : a.action === 'decline' ? client.buyerDecline(a.id) : client.buyerWithdraw(a.id)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [NEGOTIATIONS_KEY] }).then(() => qc.invalidateQueries({ queryKey: ['buyer-listing'] })),
  });
}

export type SellerAction =
  | { id: string; action: 'counter'; amount: number; dealAccess?: DealAccessInput | null }
  | { id: string; action: 'accept'; dealAccess?: DealAccessInput | null }
  | { id: string; action: 'decline' };
export function useSellerRespond() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: SellerAction) => (a.action === 'counter' ? client.sellerCounter(a.id, a.amount, a.dealAccess) : a.action === 'accept' ? client.sellerAccept(a.id, a.dealAccess) : client.sellerDecline(a.id)),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [NEGOTIATIONS_KEY] }),
  });
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
