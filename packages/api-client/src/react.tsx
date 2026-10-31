import type { CancelOrder, CreateRequest, ListingInput, PlaceOrder, PutReview, Respond, SendMessage, ShipmentBody } from '@fayda/contracts/schemas';
import { QueryClient, QueryClientProvider, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createApiClient, type ApiClient, type DealAccessInput } from './client';
import { ALL_LIVE_KEYS, NEGOTIATIONS_KEY, ORDERS_KEY, RECORD_KEY, REQUESTS_KEY, REVIEWS_KEY, THREADS_KEY, invalidationFor, queryKeys } from './keys';
import { startRealtime } from './realtime';
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

// ---------- orders ----------
const invalidate = (qc: ReturnType<typeof useQueryClient>, ...prefixes: string[]) => Promise.all(prefixes.map((p) => qc.invalidateQueries({ queryKey: [p] })));
/** After an order changes: the order lists, chat unread, the seller record and the product page stock. */
const afterOrderChange = (qc: ReturnType<typeof useQueryClient>) => invalidate(qc, ORDERS_KEY, THREADS_KEY, RECORD_KEY, NEGOTIATIONS_KEY, 'buyer-listing');

export function useBuyerOrders() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.orders('buyer', client.baseUrl), queryFn: () => client.listBuyerOrders() });
}
export function useBuyerOrder(id: string | null) {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.order('buyer', client.baseUrl, id), queryFn: () => client.getBuyerOrder(id as string), enabled: !!id });
}
export function useSellerOrders() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.orders('seller', client.baseUrl), queryFn: () => client.listSellerOrders() });
}
export function useSellerOrder(id: string | null) {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.order('seller', client.baseUrl, id), queryFn: () => client.getSellerOrder(id as string), enabled: !!id });
}
export function useSellerRecord() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.sellerRecord(client.baseUrl), queryFn: () => client.getSellerRecord() });
}
export function useShopRecord(sellerId: string | null) {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.shopRecord(client.baseUrl, sellerId), queryFn: () => client.getShopRecord(sellerId as string), enabled: !!sellerId });
}

/** Places an order. Reuse the same `idempotencyKey` when retrying the same checkout, so it cannot make two orders. */
export function usePlaceOrder() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: PlaceOrder; idempotencyKey?: string }) => client.placeOrder(input, idempotencyKey),
    onSuccess: () => void afterOrderChange(qc),
  });
}

export type SellerOrderAction =
  | { id: string; action: 'confirm'; shipment?: ShipmentBody | null; idempotencyKey?: string }
  | { id: string; action: 'ship'; shipment: ShipmentBody; idempotencyKey?: string }
  | { id: string; action: 'deliver'; idempotencyKey?: string }
  | { id: string; action: 'cancel'; input: CancelOrder; idempotencyKey?: string };
/** The seller moves an order: confirm, ship, deliver or cancel. */
export function useSellerOrderAction() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: SellerOrderAction) =>
      a.action === 'confirm' ? client.confirmOrder(a.id, a.shipment, a.idempotencyKey) : a.action === 'ship' ? client.shipOrder(a.id, a.shipment, a.idempotencyKey) : a.action === 'deliver' ? client.deliverOrder(a.id, a.idempotencyKey) : client.cancelOrder(a.id, a.input, a.idempotencyKey),
    onSuccess: () => void afterOrderChange(qc),
  });
}

// ---------- reviews ----------
export function usePutReview() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, input, idempotencyKey }: { orderId: string; input: PutReview; idempotencyKey?: string }) => client.putReview(orderId, input, idempotencyKey),
    onSuccess: () => void invalidate(qc, ORDERS_KEY, REVIEWS_KEY, RECORD_KEY),
  });
}
export function useSellerReviews() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.sellerReviews(client.baseUrl), queryFn: () => client.listSellerReviews() });
}
export function useShopReviews(sellerId: string | null) {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.shopReviews(client.baseUrl, sellerId), queryFn: () => client.getShopReviews(sellerId as string), enabled: !!sellerId });
}

// ---------- chat ----------
export function useThreads(side: 'buyer' | 'seller') {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.threads(side, client.baseUrl), queryFn: () => (side === 'buyer' ? client.listBuyerThreads() : client.listSellerThreads()) });
}
export function useThread(side: 'buyer' | 'seller', id: string | null) {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.thread(side, client.baseUrl, id), queryFn: () => (side === 'buyer' ? client.getBuyerThread(id as string) : client.getSellerThread(id as string)), enabled: !!id });
}
/** Sends a message. Pass a `clientKey` (8 to 64 characters, one per message) so a retry is not posted twice. */
export function useSendMessage(side: 'buyer' | 'seller') {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ threadId, input }: { threadId: string; input: SendMessage }) => (side === 'buyer' ? client.sendBuyerMessage(threadId, input) : client.sendSellerMessage(threadId, input)),
    onSuccess: () => void invalidate(qc, THREADS_KEY, ORDERS_KEY),
  });
}
export function useMarkThreadRead(side: 'buyer' | 'seller') {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (threadId: string) => (side === 'buyer' ? client.markBuyerThreadRead(threadId) : client.markSellerThreadRead(threadId)),
    onSuccess: () => void invalidate(qc, THREADS_KEY, ORDERS_KEY),
  });
}

// ---------- requests ----------
export function useBuyerRequests() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.requests('buyer', client.baseUrl), queryFn: () => client.listBuyerRequests() });
}
export function useBuyerRequest(id: string | null) {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.request('buyer', client.baseUrl, id), queryFn: () => client.getBuyerRequest(id as string), enabled: !!id });
}
export function useRequestReach(category: string | null) {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.requestReach(client.baseUrl, category), queryFn: () => client.getRequestReach(category as string), enabled: !!category });
}
export function useSellerRequests() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.requests('seller', client.baseUrl), queryFn: () => client.listSellerRequests() });
}
export function useCreateRequest() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: CreateRequest; idempotencyKey?: string }) => client.createRequest(input, idempotencyKey),
    onSuccess: () => void invalidate(qc, REQUESTS_KEY),
  });
}
/** Buyer actions on a request or one of its responses. */
export function useRequestAction() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { action: 'close'; requestId: string; idempotencyKey?: string } | { action: 'want' | 'decline'; responseId: string; idempotencyKey?: string }) =>
      a.action === 'close' ? client.closeRequest(a.requestId, a.idempotencyKey) : a.action === 'want' ? client.wantResponse(a.responseId, a.idempotencyKey) : client.declineResponse(a.responseId, a.idempotencyKey),
    onSuccess: () => void invalidate(qc, REQUESTS_KEY, THREADS_KEY),
  });
}
export function useRespondToRequest() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, input, idempotencyKey }: { requestId: string; input: Respond; idempotencyKey?: string }) => client.respondToRequest(requestId, input, idempotencyKey),
    onSuccess: () => void invalidate(qc, REQUESTS_KEY),
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

/**
 * Live updates: while signed in, a change to a negotiation, order, chat or request refreshes the matching screens (see
 * `invalidationFor`), and a reconnect refreshes all of them. Mount it once, inside both providers. If the socket is down the screens still work; they just refresh on use.
 */
export function useRealtime(): void {
  const manager = useSessionManager();
  const qc = useQueryClient();
  const status = useSession().status;
  useEffect(() => {
    if (status !== 'signedIn') return;
    const refresh = () => void Promise.all(ALL_LIVE_KEYS.map((k) => qc.invalidateQueries({ queryKey: [k] })));
    const rt = startRealtime({
      baseUrl: manager.client.baseUrl,
      getAccessToken: manager.getAccessToken,
      refreshAccessToken: manager.refreshAccessToken,
      onUpdate: () => undefined,
      onEvent: (e) => void Promise.all(invalidationFor(e).map((k) => qc.invalidateQueries({ queryKey: [k] }))),
      onConnect: refresh,
    });
    return () => rt.close();
  }, [status, manager, qc]);
}
