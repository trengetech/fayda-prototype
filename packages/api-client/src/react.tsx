import { CONTRACT_LEVEL, versionStatus } from '@fayda/contracts/schemas';
import type { ClientApp, VersionStatus, BlockInput, NotificationCategory, PushTokenInput, ReportInput, AddressInput, CancelOrder, CreateRequest, ListingInput, NewAddress, PlaceOrder, PostComment, PutReview, Respond, SendMessage, ShipmentBody } from '@fayda/contracts/schemas';
import { QueryClient, QueryClientProvider, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { createApiClient, feedQueryString, type ApiClient, type DealAccessInput, type FeedParams } from './client';
import { ALL_LIVE_KEYS, BLOCKS_KEY, COMMENTS_KEY, NOTIFICATIONS_KEY, FEED_KEY, FOLLOWS_KEY, SAVED_KEY, SHOP_KEY, NEGOTIATIONS_KEY, ORDERS_KEY, PROFILE_KEY, RECORD_KEY, REQUESTS_KEY, REVIEWS_KEY, THREADS_KEY, invalidationFor, queryKeys } from './keys';
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

/**
 * Whether this app can work with the server it talks to, from `/v1/meta`: `ok`, `update-required` (the app is older than the server
 * accepts) or `server-older` (the app is newer than the server). `ok` while the answer is not in or cannot be fetched: a network
 * problem is not a version problem. Checked on start and again every few minutes.
 */
export function useVersionStatus(app: ClientApp): { status: VersionStatus; apiLevel: number | null } {
  const client = useApiClient();
  const q = useQuery({ queryKey: ['meta', client.baseUrl], queryFn: () => client.getMeta(), staleTime: 5 * 60_000 });
  if (!q.data) return { status: 'ok', apiLevel: null };
  return { status: versionStatus(app, CONTRACT_LEVEL, q.data), apiLevel: q.data.apiLevel ?? 1 };
}

export const sellerListingsKey = (baseUrl: string) => ['seller-listings', baseUrl] as const;

export function useSellerListings() {
  const client = useApiClient();
  return useQuery({ queryKey: sellerListingsKey(client.baseUrl), queryFn: () => client.listSellerListings() });
}

/**
 * The buyer feed, one page at a time: call `fetchNextPage` near the end of the list. Every distinct set of params
 * (scope, search, filters, sort) is its own cached list, so switching tabs does not refetch what is already loaded.
 */
export function useBuyerFeed(params: Omit<FeedParams, 'cursor'> = {}) {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: queryKeys.feed(client.baseUrl, feedQueryString(params)),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.getBuyerFeed({ ...params, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useFeedFacets() {
  const client = useApiClient();
  return useQuery({ queryKey: [FEED_KEY, client.baseUrl, 'facets'], queryFn: () => client.getFeedFacets(), staleTime: 60_000 });
}

export function useShop(handle: string | null) {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.shop(client.baseUrl, handle), queryFn: () => client.getShop(handle as string), enabled: !!handle });
}

export function useShopListings(handle: string | null, params: Omit<FeedParams, 'cursor' | 'scope'> = {}) {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: queryKeys.shopListings(client.baseUrl, handle, feedQueryString(params)),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.getShopListings(handle as string, { ...params, ...(pageParam ? { cursor: pageParam } : {}) }),
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!handle,
  });
}

export function useFollowedShops() {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: queryKeys.follows(client.baseUrl),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.listFollows(pageParam),
    getNextPageParam: (last) => last.nextCursor,
  });
}

type CardPatch = { liked?: boolean; saved?: boolean; likeCount?: number };
type CardLike = { id: string; liked: boolean; saved: boolean; likeCount: number };

/**
 * Changes one listing's like or save everywhere it is cached (every feed page, the Saved list, the product page), so the
 * heart flips at once. Returns the previous values for a rollback.
 */
function patchListing(qc: ReturnType<typeof useQueryClient>, baseUrl: string, listingId: string, patch: (c: CardLike) => CardPatch) {
  const apply = (c: CardLike): CardLike => ({ ...c, ...patch(c) });
  const pages = (old: { pages: { items: CardLike[] }[]; pageParams: unknown[] } | undefined) =>
    old && 'pages' in old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.id === listingId ? apply(i) : i)) })) } : old;
  for (const key of [FEED_KEY, SHOP_KEY, SAVED_KEY]) qc.setQueriesData({ queryKey: [key, baseUrl] }, pages as never);
  qc.setQueriesData<CardLike>({ queryKey: ['buyer-listing', baseUrl, listingId] }, (old) => (old && 'liked' in old ? apply(old) : old));
}

/** After a failed like or save, every place a card was patched is read again from the server. */
function reloadCards(qc: ReturnType<typeof useQueryClient>, baseUrl: string) {
  for (const key of [FEED_KEY, SHOP_KEY, SAVED_KEY, 'buyer-listing']) void qc.invalidateQueries({ queryKey: [key, baseUrl] });
}

/** Stops reads already in flight from landing on top of a guess made a moment later. */
function holdCards(qc: ReturnType<typeof useQueryClient>, baseUrl: string) {
  return Promise.all([FEED_KEY, SHOP_KEY, SAVED_KEY, 'buyer-listing'].map((key) => qc.cancelQueries({ queryKey: [key, baseUrl] })));
}

type FeedPages = { pages: { items: { seller: { id: string }; following: boolean }[] }[]; pageParams: unknown[] };

/**
 * Follow or unfollow a shop. The heart/Follow button flips at once (every cached feed card and the shop page), the
 * server's answer then replaces the guess, and a failure puts things back. Following lists are refetched either way.
 */
export function useSetFollow() {
  const client = useApiClient();
  const qc = useQueryClient();
  const flip = (sellerId: string, following: boolean) => {
    qc.setQueriesData<FeedPages>({ queryKey: [FEED_KEY, client.baseUrl] }, (old) =>
      old && 'pages' in old ? { ...old, pages: old.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.seller.id === sellerId ? { ...i, following } : i)) })) } : old,
    );
    qc.setQueriesData<{ id: string; following: boolean; followerCount: number }>({ queryKey: [SHOP_KEY, client.baseUrl] }, (old) =>
      old && 'followerCount' in old && old.id === sellerId ? { ...old, following, followerCount: Math.max(0, old.followerCount + (following === old.following ? 0 : following ? 1 : -1)) } : old,
    );
  };
  return useMutation({
    mutationFn: ({ sellerId, follow }: { sellerId: string; follow: boolean }) => (follow ? client.followSeller(sellerId) : client.unfollowSeller(sellerId)),
    onMutate: ({ sellerId, follow }) => {
      flip(sellerId, follow);
      return { sellerId, follow };
    },
    onError: (_e, _v, ctx) => {
      if (ctx) flip(ctx.sellerId, !ctx.follow);
      // The guess may not match what the server really holds (another tap, another device): reload every card from it.
      void qc.invalidateQueries({ queryKey: [FEED_KEY, client.baseUrl] });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [FOLLOWS_KEY] });
      void qc.invalidateQueries({ queryKey: [SHOP_KEY] });
      void qc.invalidateQueries({ queryKey: [FEED_KEY, client.baseUrl], predicate: (q) => q.queryKey[2] !== 'facets' && typeof q.queryKey[2] === 'string' && q.queryKey[2].includes('scope=FOLLOWING') });
    },
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

// ---------- buyer profile and delivery addresses ----------
export function useBuyerProfile() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.buyerProfile(client.baseUrl), queryFn: () => client.getBuyerProfile() });
}
export type AddressAction =
  | { action: 'add'; input: NewAddress }
  | { action: 'update'; id: string; input: AddressInput }
  | { action: 'delete'; id: string }
  | { action: 'default'; id: string };
/** Add, edit, delete or choose the default address. The profile the server returns replaces the cached one. */
export function useAddressAction() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: AddressAction) =>
      a.action === 'add' ? client.addAddress(a.input) : a.action === 'update' ? client.updateAddress(a.id, a.input) : a.action === 'delete' ? client.deleteAddress(a.id) : client.setDefaultAddress(a.id),
    onSuccess: (profile) => {
      qc.setQueryData(queryKeys.buyerProfile(client.baseUrl), profile);
      void invalidate(qc, PROFILE_KEY);
    },
  });
}

// ---------- social: likes, saves, comments (M3.6) ----------

/** Like or unlike a listing. The heart and the count change at once; the server's answer then replaces the guess, and a refusal puts it back. */
export function useSetLike() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, like }: { listingId: string; like: boolean }) => (like ? client.likeListing(listingId) : client.unlikeListing(listingId)),
    onMutate: async ({ listingId, like }) => {
      await holdCards(qc, client.baseUrl);
      patchListing(qc, client.baseUrl, listingId, (c) => (c.liked === like ? {} : { liked: like, likeCount: Math.max(0, c.likeCount + (like ? 1 : -1)) }));
    },
    onSuccess: (state, { listingId }) => patchListing(qc, client.baseUrl, listingId, () => ({ liked: state.liked, likeCount: state.likeCount })),
    onError: () => reloadCards(qc, client.baseUrl),
  });
}

export function useSetSave() {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, save }: { listingId: string; save: boolean }) => (save ? client.saveListing(listingId) : client.unsaveListing(listingId)),
    onMutate: async ({ listingId, save }) => {
      await holdCards(qc, client.baseUrl);
      patchListing(qc, client.baseUrl, listingId, () => ({ saved: save }));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: [SAVED_KEY] });
    },
    onError: () => reloadCards(qc, client.baseUrl),
  });
}

export function useSavedListings() {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: queryKeys.saved(client.baseUrl),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.listSaved(pageParam),
    getNextPageParam: (last) => last.nextCursor,
  });
}

/** A listing's comments, newest first, one page at a time. `side` is the app asking (a seller reads their own listing). */
export function useComments(side: 'buyer' | 'seller', listingId: string | null) {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: queryKeys.comments(side, client.baseUrl, listingId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.listComments(side, listingId as string, pageParam),
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!listingId,
  });
}

/** Posts a comment. Pass one `clientKey` and idempotency key per attempt and reuse them when retrying the same text. */
export function usePostComment(side: 'buyer' | 'seller') {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ listingId, input, idempotencyKey }: { listingId: string; input: PostComment; idempotencyKey?: string }) => client.postComment(side, listingId, input, idempotencyKey),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [COMMENTS_KEY] });
      void qc.invalidateQueries({ queryKey: [FEED_KEY] });
      void qc.invalidateQueries({ queryKey: ['buyer-listing'] });
      void qc.invalidateQueries({ queryKey: ['seller-listings'] });
    },
  });
}

export function useRemoveComment(side: 'buyer' | 'seller') {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => client.removeComment(side, commentId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [COMMENTS_KEY] });
      void qc.invalidateQueries({ queryKey: [FEED_KEY] });
      void qc.invalidateQueries({ queryKey: ['buyer-listing'] });
      void qc.invalidateQueries({ queryKey: ['seller-listings'] });
    },
  });
}

// ---------- notifications, push, report and block, dashboard (M3.7) ----------
/** Counts one view when the product page opens for this listing. A failure is ignored: a view is never worth an error. */
export function useRecordView(listingId: string | null): void {
  const client = useApiClient();
  useEffect(() => {
    if (listingId) void client.recordListingView(listingId).catch(() => undefined);
  }, [client, listingId]);
}

/** The unread number for the bell. Refreshed by the `notification.created` event and on reconnect. */
export function useUnreadCount(side: 'buyer' | 'seller') {
  const client = useApiClient();
  return useQuery({ queryKey: [...queryKeys.notifications(side, client.baseUrl), 'unread'], queryFn: () => client.getUnreadCount(side) });
}

/** The notification centre, newest first, one page at a time. */
export function useNotifications(side: 'buyer' | 'seller') {
  const client = useApiClient();
  return useInfiniteQuery({
    queryKey: [...queryKeys.notifications(side, client.baseUrl), 'list'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => client.listNotifications(side, pageParam),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useMarkNotificationRead(side: 'buyer' | 'seller') {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.markNotificationRead(side, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] }),
  });
}

export function useMarkAllNotificationsRead(side: 'buyer' | 'seller') {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.markAllNotificationsRead(side),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] }),
  });
}

export function useDeleteNotification(side: 'buyer' | 'seller') {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => client.deleteNotification(side, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] }),
  });
}

export function useClearNotifications(side: 'buyer' | 'seller') {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.clearNotifications(side),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] }),
  });
}

/** Which kinds of notification this person wants (push and centre), one row per kind. */
export function useNotificationSettings(side: 'buyer' | 'seller') {
  const client = useApiClient();
  return useQuery({ queryKey: [...queryKeys.notifications(side, client.baseUrl), 'settings'], queryFn: () => client.getNotificationSettings(side) });
}

export function useSetNotificationSetting(side: 'buyer' | 'seller') {
  const client = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { category: NotificationCategory; push: boolean; inApp: boolean }) => client.setNotificationSetting(side, v.category, { push: v.push, inApp: v.inApp }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] }),
  });
}

/** Tells the API this phone's push token, while signed in, and again if it changes. `getToken` returns null when push is unavailable (no permission, an emulator without Google services). */
export function usePushRegistration(side: 'buyer' | 'seller', getToken: () => Promise<PushTokenInput | null>): void {
  const client = useApiClient();
  const status = useSession().status;
  useEffect(() => {
    if (status !== 'signedIn') return;
    let cancelled = false;
    void getToken()
      .then((t) => (t && !cancelled ? client.registerPushToken(side, t) : undefined))
      .catch(() => undefined); // push is a convenience: a failure never blocks the app
    return () => {
      cancelled = true;
    };
  }, [status, client, side, getToken]);
}

export function useReport(side: 'buyer' | 'seller') {
  const client = useApiClient();
  return useMutation({
    mutationFn: (a: { kind: 'COMMENT'; commentId: string; input: ReportInput } | { kind: 'MESSAGE'; threadId: string; messageId: string; input: ReportInput }) =>
      a.kind === 'COMMENT' ? client.reportComment(side, a.commentId, a.input) : client.reportMessage(side, a.threadId, a.messageId, a.input),
  });
}

export function useBlocks(side: 'buyer' | 'seller') {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.blocks(side, client.baseUrl), queryFn: () => client.listBlocks(side) });
}

/** Blocking and unblocking change what comments and chats show, so those are refreshed too. */
export function useBlockActions(side: 'buyer' | 'seller') {
  const client = useApiClient();
  const qc = useQueryClient();
  const done = () => {
    for (const k of [BLOCKS_KEY, COMMENTS_KEY, THREADS_KEY]) void qc.invalidateQueries({ queryKey: [k] });
  };
  return {
    block: useMutation({ mutationFn: (input: BlockInput) => client.blockPerson(side, input), onSuccess: done }),
    unblock: useMutation({ mutationFn: (blockId: string) => client.unblockPerson(side, blockId), onSuccess: done }),
  };
}

export function useSellerDashboard() {
  const client = useApiClient();
  return useQuery({ queryKey: queryKeys.dashboard(client.baseUrl), queryFn: () => client.getSellerDashboard() });
}
