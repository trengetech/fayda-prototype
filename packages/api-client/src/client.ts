import {
  AuthResultSchema,
  BuyerProfileSchema,
  HealthSchema,
  MediaIntentSchema,
  MediaSchema,
  MeSchema,
  MetaSchema,
  OtpRequestedSchema,
  ProblemSchema,
  BuyerFeedSchema,
  CommentListSchema,
  CommentSchema,
  LikeStateSchema,
  SaveStateSchema,
  FeedFacetsSchema,
  FollowStateSchema,
  FollowedShopListSchema,
  ShopViewSchema,
  BuyerListingSchema,
  BuyerNegotiationListSchema,
  BuyerNegotiationSchema,
  SellerNegotiationListSchema,
  SellerNegotiationSchema,
  SellerListingListSchema,
  SellerListingSchema,
  SellerProfileSchema,
  BuyerOrderListSchema,
  BuyerOrderSchema,
  SellerOrderListSchema,
  SellerOrderSchema,
  SellerRecordSchema,
  ChatThreadListSchema,
  ChatThreadSchema,
  BuyerRequestListSchema,
  BuyerRequestSchema,
  SellerRequestListSchema,
  SellerRequestSchema,
  ShopReviewListSchema,
  type BuyerOrder,
  type BuyerOrderList,
  type SellerOrder,
  type SellerOrderList,
  type SellerRecord,
  type PlaceOrder,
  type ShipmentBody,
  type CancelOrder,
  type ChatThread,
  type ChatThreadList,
  type SendMessage,
  type PutReview,
  type BuyerRequest,
  type BuyerRequestList,
  type SellerRequest,
  type SellerRequestList,
  type CreateRequest,
  type Respond,
  type ShopReviewList,
  type AppAudience,
  type AuthResult,
  type BuyerProfile,
  type BuyerProfileInput,
  type Health,
  type Me,
  type BuyerFeed,
  type Comment,
  type CommentList,
  type LikeState,
  type PostComment,
  type SaveState,
  type FeedFacets,
  type FeedQuery,
  type FollowState,
  type FollowedShopList,
  type ShopView,
  type BuyerListing,
  type BuyerNegotiation,
  type BuyerNegotiationList,
  type SellerNegotiation,
  type SellerNegotiationList,
  type AddressInput,
  type ListingInput,
  type NewAddress,
  type Media,
  type MediaIntent,
  type MediaIntentInput,
  type Meta,
  type OtpRequested,
  type PaymentInput,
  type Problem,
  type SellerListing,
  type SellerProfile,
  type SellerShopInput,
  type z,
} from '@fayda/contracts/schemas';

/** The server answered with an error body (problem+json) or something we could not understand. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly problem?: Problem,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** The request never got an answer: offline, wrong address, server down, or timed out. */
export class NetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

export interface ApiClientOptions {
  /** Server address without a trailing slash, e.g. http://192.168.1.5:3000 */
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** The current access token, or null when signed out. Sent as a bearer token on signed-in calls. */
  getAccessToken?: () => string | null;
  /** Called once when a signed-in call is refused (token expired). Return a fresh access token to retry, or null to give up. */
  onUnauthorized?: () => Promise<string | null>;
}

export interface ApiClient {
  readonly baseUrl: string;
  getHealth(): Promise<Health>;
  getMeta(): Promise<Meta>;
  requestOtp(phone: string, app: AppAudience): Promise<OtpRequested>;
  verifyOtp(phone: string, code: string, app: AppAudience): Promise<AuthResult>;
  refresh(refreshToken: string): Promise<AuthResult>;
  logout(): Promise<void>;
  me(): Promise<Me>;
  getBuyerProfile(): Promise<BuyerProfile>;
  saveBuyerProfile(input: BuyerProfileInput): Promise<BuyerProfile>;
  updateBuyerContact(contact: { phone?: string | null; whatsapp?: string | null }): Promise<BuyerProfile>;
  /** Delivery addresses. Each call returns the whole profile, so the screen can replace what it shows. */
  addAddress(input: NewAddress): Promise<BuyerProfile>;
  updateAddress(id: string, input: AddressInput): Promise<BuyerProfile>;
  deleteAddress(id: string): Promise<BuyerProfile>;
  setDefaultAddress(id: string): Promise<BuyerProfile>;
  getSellerProfile(): Promise<SellerProfile>;
  saveSellerShop(input: SellerShopInput): Promise<SellerProfile>;
  saveSellerPayment(input: PaymentInput): Promise<SellerProfile>;
  /** Turns an address from the API (`/v1/media/…` or a full URL) into one a player or uploader can use. */
  resolveUrl(path: string): string;
  /** `app` picks the upload route: the seller app uses `seller` (default), the buyer app `buyer` (reviews, requests, chat photos). */
  createMediaIntent(input: MediaIntentInput, app?: AppAudience): Promise<MediaIntent>;
  completeMedia(mediaId: string, app?: AppAudience): Promise<Media>;
  listSellerListings(): Promise<SellerListing[]>;
  getSellerListing(id: string): Promise<SellerListing>;
  /** `idempotencyKey` makes a retry after a lost reply safe: reuse the same key for the same save. */
  createListing(input: ListingInput, idempotencyKey?: string): Promise<SellerListing>;
  updateListing(id: string, input: ListingInput, idempotencyKey?: string): Promise<SellerListing>;
  setListingStatus(id: string, status: 'ACTIVE' | 'PAUSED', idempotencyKey?: string): Promise<SellerListing>;
  deleteListingDraft(id: string): Promise<void>;
  /** One page of the buyer feed. Pass the previous page's `nextCursor` to get the next one. */
  /** The feed: For You or Following, with search, filters and sort. Empty values are left out of the address. */
  getBuyerFeed(params?: FeedParams): Promise<BuyerFeed>;
  /** The filter choices: categories, sizes in stock and the price span. */
  getFeedFacets(): Promise<FeedFacets>;
  /** A shop page by handle, and its live listings (same search, filters and sort as the feed). */
  getShop(handle: string): Promise<ShopView>;
  getShopListings(handle: string, params?: FeedParams): Promise<BuyerFeed>;
  /** Follow and unfollow are safe to repeat. */
  followSeller(sellerId: string): Promise<FollowState>;
  unfollowSeller(sellerId: string): Promise<FollowState>;
  listFollows(cursor?: string | null, limit?: number): Promise<FollowedShopList>;
  getBuyerListing(id: string): Promise<BuyerListing>;
  /** Like, save and comment. Like and save are safe to repeat; a comment post takes the same `clientKey` and idempotency key when retried. */
  likeListing(id: string): Promise<LikeState>;
  unlikeListing(id: string): Promise<LikeState>;
  saveListing(id: string): Promise<SaveState>;
  unsaveListing(id: string): Promise<SaveState>;
  listSaved(cursor?: string | null, limit?: number): Promise<BuyerFeed>;
  /** `app` picks the audience route: the buyer reads live listings, the seller reads their own. */
  listComments(app: 'buyer' | 'seller', listingId: string, cursor?: string | null, limit?: number): Promise<CommentList>;
  postComment(app: 'buyer' | 'seller', listingId: string, input: PostComment, idempotencyKey?: string): Promise<Comment>;
  removeComment(app: 'buyer' | 'seller', commentId: string): Promise<void>;
  /** Make a first offer on a size. Amounts are paise (whole rupees). Pass `idempotencyKey` to make a retry safe. */
  startOffer(listingId: string, variantId: string, amount: number, idempotencyKey?: string): Promise<BuyerNegotiation>;
  listBuyerNegotiations(): Promise<BuyerNegotiationList>;
  getBuyerNegotiation(id: string): Promise<BuyerNegotiation>;
  buyerCounter(id: string, amount: number, idempotencyKey?: string): Promise<BuyerNegotiation>;
  buyerAccept(id: string, idempotencyKey?: string): Promise<BuyerNegotiation>;
  buyerDecline(id: string, idempotencyKey?: string): Promise<BuyerNegotiation>;
  buyerWithdraw(id: string, idempotencyKey?: string): Promise<BuyerNegotiation>;
  listSellerNegotiations(): Promise<SellerNegotiationList>;
  getSellerNegotiation(id: string): Promise<SellerNegotiation>;
  /** On a website listing, send the code or link that gives the agreed price. */
  sellerAccept(id: string, dealAccess?: DealAccessInput | null, idempotencyKey?: string): Promise<SellerNegotiation>;
  sellerCounter(id: string, amount: number, dealAccess?: DealAccessInput | null, idempotencyKey?: string): Promise<SellerNegotiation>;
  sellerDecline(id: string, idempotencyKey?: string): Promise<SellerNegotiation>;

  // ---------- orders (buyer) ----------
  /** Places an order. Prices come from the server; reuse `idempotencyKey` when retrying the same order. */
  placeOrder(input: PlaceOrder, idempotencyKey?: string): Promise<BuyerOrder>;
  listBuyerOrders(): Promise<BuyerOrderList>;
  getBuyerOrder(id: string): Promise<BuyerOrder>;
  putReview(orderId: string, input: PutReview, idempotencyKey?: string): Promise<BuyerOrder>;
  /** The seller's UPI QR for a PLACED order. It needs the bearer token, so this returns what an `<Image source>` takes. */
  getPaymentQrSource(orderId: string): { uri: string; headers: Record<string, string> };
  /** A chat photo is private to its thread (I-19), so it needs the bearer token. Returns what an `<Image source>` takes. */
  getChatPhotoSource(url: string): { uri: string; headers: Record<string, string> };

  // ---------- orders (seller) ----------
  listSellerOrders(): Promise<SellerOrderList>;
  getSellerOrder(id: string): Promise<SellerOrder>;
  confirmOrder(id: string, shipment?: ShipmentBody | null, idempotencyKey?: string): Promise<SellerOrder>;
  shipOrder(id: string, shipment: ShipmentBody, idempotencyKey?: string): Promise<SellerOrder>;
  deliverOrder(id: string, idempotencyKey?: string): Promise<SellerOrder>;
  cancelOrder(id: string, input: CancelOrder, idempotencyKey?: string): Promise<SellerOrder>;
  getSellerRecord(): Promise<SellerRecord>;

  // ---------- chat ----------
  listBuyerThreads(): Promise<ChatThreadList>;
  getBuyerThread(id: string): Promise<ChatThread>;
  /** `clientKey` (8 to 64 characters) is sent in the body so a retried message is not posted twice. */
  sendBuyerMessage(threadId: string, input: SendMessage): Promise<ChatThread>;
  markBuyerThreadRead(threadId: string): Promise<ChatThread>;
  listSellerThreads(): Promise<ChatThreadList>;
  getSellerThread(id: string): Promise<ChatThread>;
  sendSellerMessage(threadId: string, input: SendMessage): Promise<ChatThread>;
  markSellerThreadRead(threadId: string): Promise<ChatThread>;

  // ---------- requests ----------
  createRequest(input: CreateRequest, idempotencyKey?: string): Promise<BuyerRequest>;
  listBuyerRequests(): Promise<BuyerRequestList>;
  getBuyerRequest(id: string): Promise<BuyerRequest>;
  closeRequest(id: string, idempotencyKey?: string): Promise<BuyerRequest>;
  wantResponse(responseId: string, idempotencyKey?: string): Promise<BuyerRequest>;
  declineResponse(responseId: string, idempotencyKey?: string): Promise<BuyerRequest>;
  /** How many sellers a request in this category would reach ("Send to N sellers"). */
  getRequestReach(category: string): Promise<{ count: number }>;
  listSellerRequests(): Promise<SellerRequestList>;
  respondToRequest(requestId: string, input: Respond, idempotencyKey?: string): Promise<SellerRequest>;

  // ---------- reviews and the public record ----------
  listSellerReviews(): Promise<ShopReviewList>;
  getShopReviews(sellerId: string): Promise<ShopReviewList>;
  getShopRecord(sellerId: string): Promise<SellerRecord>;
}

const ReachSchema = { parse: (x: unknown) => x, safeParse: (x: unknown) => (typeof x === 'object' && x && typeof (x as { count?: unknown }).count === 'number' ? { success: true as const, data: x as { count: number } } : { success: false as const }) } as unknown as z.ZodType<{ count: number }>;

export interface DealAccessInput {
  type: 'CODE' | 'LINK';
  value: string;
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface CallOptions {
  method?: Method;
  body?: unknown;
  /** Send the bearer token, and on 401 refresh once and retry. */
  auth?: boolean;
  acceptStatuses?: number[];
  headers?: Record<string, string>;
}

/** What the feed accepts. A value that is empty, null or false is left out, so the address stays short and cacheable. */
export type FeedParams = Partial<FeedQuery>;

/** `?a=b&c=d` for the feed, in a fixed key order (a stable address makes a stable query key and cache entry). */
export function feedQueryString(p: FeedParams = {}): string {
  const q = new URLSearchParams();
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '' || v === false) return;
    q.set(k, String(v));
  };
  put('scope', p.scope);
  put('q', typeof p.q === 'string' ? p.q.trim().replace(/\s+/g, ' ') : p.q);
  put('category', p.category);
  put('minPrice', p.minPrice);
  put('maxPrice', p.maxPrice);
  put('size', p.size);
  put('acceptsOffers', p.acceptsOffers);
  put('sort', p.sort);
  put('limit', p.limit);
  put('cursor', p.cursor);
  const qs = q.toString();
  return qs ? `?${qs}` : '';
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;

  async function once(path: string, o: CallOptions, token: string | null): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const headers: Record<string, string> = { accept: 'application/json' };
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    if (token) headers.authorization = `Bearer ${token}`;
    Object.assign(headers, o.headers);
    try {
      return await doFetch(baseUrl + path, { method: o.method ?? 'GET', headers, signal: ctrl.signal, ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}) });
    } catch (e) {
      const timedOut = ctrl.signal.aborted;
      throw new NetworkError(timedOut ? `No answer from ${baseUrl} after ${timeoutMs / 1000}s` : `Could not reach ${baseUrl}`, { cause: e });
    } finally {
      clearTimeout(timer);
    }
  }

  async function call<T>(path: string, schema: z.ZodType<T>, o: CallOptions = {}): Promise<T> {
    let res = await once(path, o, o.auth ? (opts.getAccessToken?.() ?? null) : null);
    if (res.status === 401 && o.auth && opts.onUnauthorized) {
      const fresh = await opts.onUnauthorized();
      if (fresh) res = await once(path, o, fresh);
    }
    if (res.status === 204) return undefined as T;
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiError(res.status, `Unexpected response (${res.status})`);
    }
    if (res.ok || (o.acceptStatuses ?? []).includes(res.status)) {
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new ApiError(res.status, 'The server sent data in an unexpected shape');
      return parsed.data;
    }
    const problem = ProblemSchema.safeParse(body);
    throw new ApiError(res.status, problem.success ? (problem.data.detail ?? problem.data.title) : `Request failed (${res.status})`, problem.success ? problem.data : undefined);
  }
  const idem = (key?: string): { headers?: Record<string, string> } => (key ? { headers: { 'idempotency-key': key } } : {});
  const NoBody = { parse: () => undefined, safeParse: () => ({ success: true as const, data: undefined }) } as unknown as z.ZodType<void>;

  return {
    baseUrl,
    // 503 still carries a valid Health body ("database down"), which is data to show, not an error.
    getHealth: () => call('/v1/health', HealthSchema, { acceptStatuses: [503] }),
    getMeta: () => call('/v1/meta', MetaSchema),
    requestOtp: (phone, app) => call('/v1/auth/otp/request', OtpRequestedSchema, { method: 'POST', body: { phone, app } }),
    verifyOtp: (phone, code, app) => call('/v1/auth/otp/verify', AuthResultSchema, { method: 'POST', body: { phone, code, app } }),
    refresh: (refreshToken) => call('/v1/auth/refresh', AuthResultSchema, { method: 'POST', body: { refreshToken } }),
    logout: () => call('/v1/auth/logout', NoBody, { method: 'POST', auth: true }),
    me: () => call('/v1/me', MeSchema, { auth: true }),
    getBuyerProfile: () => call('/v1/buyer/profile', BuyerProfileSchema, { auth: true }),
    saveBuyerProfile: (input) => call('/v1/buyer/profile', BuyerProfileSchema, { method: 'PUT', body: input, auth: true }),
    updateBuyerContact: (contact) => call('/v1/buyer/profile/contact', BuyerProfileSchema, { method: 'PATCH', body: { contact }, auth: true }),
    addAddress: (input) => call('/v1/buyer/addresses', BuyerProfileSchema, { method: 'POST', body: input, auth: true }),
    updateAddress: (id, input) => call(`/v1/buyer/addresses/${id}`, BuyerProfileSchema, { method: 'PUT', body: input, auth: true }),
    deleteAddress: (id) => call(`/v1/buyer/addresses/${id}`, BuyerProfileSchema, { method: 'DELETE', auth: true }),
    setDefaultAddress: (id) => call(`/v1/buyer/addresses/${id}/default`, BuyerProfileSchema, { method: 'POST', auth: true }),
    getSellerProfile: () => call('/v1/seller/profile', SellerProfileSchema, { auth: true }),
    saveSellerShop: (input) => call('/v1/seller/profile', SellerProfileSchema, { method: 'PUT', body: input, auth: true }),
    saveSellerPayment: (input) => call('/v1/seller/payment', SellerProfileSchema, { method: 'PUT', body: input, auth: true }),
    resolveUrl: (path) => (path.startsWith('/') ? baseUrl + path : path),
    createMediaIntent: (input, app = 'seller') => call(`/v1/${app}/media/intents`, MediaIntentSchema, { method: 'POST', body: input, auth: true }),
    completeMedia: (mediaId, app = 'seller') => call(`/v1/${app}/media/${mediaId}/complete`, MediaSchema, { method: 'POST', auth: true }),
    listSellerListings: async () => (await call('/v1/seller/listings', SellerListingListSchema, { auth: true })).items,
    getSellerListing: (id) => call(`/v1/seller/listings/${id}`, SellerListingSchema, { auth: true }),
    createListing: (input, key) => call('/v1/seller/listings', SellerListingSchema, { method: 'POST', body: input, auth: true, ...idem(key) }),
    updateListing: (id, input, key) => call(`/v1/seller/listings/${id}`, SellerListingSchema, { method: 'PUT', body: input, auth: true, ...idem(key) }),
    setListingStatus: (id, status, key) => call(`/v1/seller/listings/${id}/status`, SellerListingSchema, { method: 'POST', body: { status }, auth: true, ...idem(key) }),
    deleteListingDraft: (id) => call(`/v1/seller/listings/${id}`, NoBody, { method: 'DELETE', auth: true }),
    getBuyerFeed: (params) => call(`/v1/buyer/feed${feedQueryString(params)}`, BuyerFeedSchema, { auth: true }),
    getFeedFacets: () => call('/v1/buyer/feed/facets', FeedFacetsSchema, { auth: true }),
    getShop: (handle) => call(`/v1/buyer/shops/${encodeURIComponent(handle)}`, ShopViewSchema, { auth: true }),
    getShopListings: (handle, params) => call(`/v1/buyer/shops/${encodeURIComponent(handle)}/listings${feedQueryString(params)}`, BuyerFeedSchema, { auth: true }),
    followSeller: (id) => call(`/v1/buyer/follows/sellers/${id}`, FollowStateSchema, { method: 'PUT', auth: true }),
    unfollowSeller: (id) => call(`/v1/buyer/follows/sellers/${id}`, FollowStateSchema, { method: 'DELETE', auth: true }),
    listFollows: (cursor, limit) => {
      const q = new URLSearchParams();
      if (cursor) q.set('cursor', cursor);
      if (limit) q.set('limit', String(limit));
      return call(`/v1/buyer/follows${q.size ? `?${q}` : ''}`, FollowedShopListSchema, { auth: true });
    },
    getBuyerListing: (id) => call(`/v1/buyer/listings/${id}`, BuyerListingSchema, { auth: true }),
    likeListing: (id) => call(`/v1/buyer/listings/${id}/like`, LikeStateSchema, { method: 'PUT', auth: true }),
    unlikeListing: (id) => call(`/v1/buyer/listings/${id}/like`, LikeStateSchema, { method: 'DELETE', auth: true }),
    saveListing: (id) => call(`/v1/buyer/listings/${id}/save`, SaveStateSchema, { method: 'PUT', auth: true }),
    unsaveListing: (id) => call(`/v1/buyer/listings/${id}/save`, SaveStateSchema, { method: 'DELETE', auth: true }),
    listSaved: (cursor, limit) => {
      const q = new URLSearchParams();
      if (limit) q.set('limit', String(limit));
      if (cursor) q.set('cursor', cursor);
      return call(`/v1/buyer/saved${q.size ? `?${q}` : ''}`, BuyerFeedSchema, { auth: true });
    },
    listComments: (app, listingId, cursor, limit) => {
      const q = new URLSearchParams();
      if (limit) q.set('limit', String(limit));
      if (cursor) q.set('cursor', cursor);
      return call(`/v1/${app}/listings/${listingId}/comments${q.size ? `?${q}` : ''}`, CommentListSchema, { auth: true });
    },
    postComment: (app, listingId, input, key) => call(`/v1/${app}/listings/${listingId}/comments`, CommentSchema, { method: 'POST', body: input, auth: true, ...idem(key) }),
    removeComment: (app, commentId) => call(`/v1/${app}/comments/${commentId}`, NoBody, { method: 'DELETE', auth: true }),
    startOffer: (listingId, variantId, amount, key) => call(`/v1/buyer/listings/${listingId}/offers`, BuyerNegotiationSchema, { method: 'POST', body: { variantId, amount }, auth: true, ...idem(key) }),
    listBuyerNegotiations: () => call('/v1/buyer/negotiations', BuyerNegotiationListSchema, { auth: true }),
    getBuyerNegotiation: (id) => call(`/v1/buyer/negotiations/${id}`, BuyerNegotiationSchema, { auth: true }),
    buyerCounter: (id, amount, key) => call(`/v1/buyer/negotiations/${id}/counter`, BuyerNegotiationSchema, { method: 'POST', body: { amount }, auth: true, ...idem(key) }),
    buyerAccept: (id, key) => call(`/v1/buyer/negotiations/${id}/accept`, BuyerNegotiationSchema, { method: 'POST', auth: true, ...idem(key) }),
    buyerDecline: (id, key) => call(`/v1/buyer/negotiations/${id}/decline`, BuyerNegotiationSchema, { method: 'POST', auth: true, ...idem(key) }),
    buyerWithdraw: (id, key) => call(`/v1/buyer/negotiations/${id}/withdraw`, BuyerNegotiationSchema, { method: 'POST', auth: true, ...idem(key) }),
    listSellerNegotiations: () => call('/v1/seller/negotiations', SellerNegotiationListSchema, { auth: true }),
    getSellerNegotiation: (id) => call(`/v1/seller/negotiations/${id}`, SellerNegotiationSchema, { auth: true }),
    sellerAccept: (id, dealAccess, key) => call(`/v1/seller/negotiations/${id}/accept`, SellerNegotiationSchema, { method: 'POST', body: { dealAccess: dealAccess ?? null }, auth: true, ...idem(key) }),
    sellerCounter: (id, amount, dealAccess, key) => call(`/v1/seller/negotiations/${id}/counter`, SellerNegotiationSchema, { method: 'POST', body: { amount, dealAccess: dealAccess ?? null }, auth: true, ...idem(key) }),
    sellerDecline: (id, key) => call(`/v1/seller/negotiations/${id}/decline`, SellerNegotiationSchema, { method: 'POST', auth: true, ...idem(key) }),

    placeOrder: (input, key) => call('/v1/buyer/orders', BuyerOrderSchema, { method: 'POST', body: input, auth: true, ...idem(key) }),
    listBuyerOrders: () => call('/v1/buyer/orders', BuyerOrderListSchema, { auth: true }),
    getBuyerOrder: (id) => call(`/v1/buyer/orders/${id}`, BuyerOrderSchema, { auth: true }),
    putReview: (orderId, input, key) => call(`/v1/buyer/orders/${orderId}/review`, BuyerOrderSchema, { method: 'PUT', body: input, auth: true, ...idem(key) }),
    getPaymentQrSource: (orderId) => {
      const t = opts.getAccessToken?.() ?? null;
      const headers: Record<string, string> = t ? { authorization: `Bearer ${t}` } : {};
      return { uri: `${baseUrl}/v1/buyer/orders/${orderId}/payment-qr`, headers };
    },

    getChatPhotoSource: (url) => {
      const t = opts.getAccessToken?.() ?? null;
      const headers: Record<string, string> = t ? { authorization: `Bearer ${t}` } : {};
      return { uri: url.startsWith('/') ? baseUrl + url : url, headers };
    },

    listSellerOrders: () => call('/v1/seller/orders', SellerOrderListSchema, { auth: true }),
    getSellerOrder: (id) => call(`/v1/seller/orders/${id}`, SellerOrderSchema, { auth: true }),
    confirmOrder: (id, shipment, key) => call(`/v1/seller/orders/${id}/confirm`, SellerOrderSchema, { method: 'POST', body: { shipment: shipment ?? null }, auth: true, ...idem(key) }),
    shipOrder: (id, shipment, key) => call(`/v1/seller/orders/${id}/ship`, SellerOrderSchema, { method: 'POST', body: shipment, auth: true, ...idem(key) }),
    deliverOrder: (id, key) => call(`/v1/seller/orders/${id}/deliver`, SellerOrderSchema, { method: 'POST', auth: true, ...idem(key) }),
    cancelOrder: (id, input, key) => call(`/v1/seller/orders/${id}/cancel`, SellerOrderSchema, { method: 'POST', body: input, auth: true, ...idem(key) }),
    getSellerRecord: () => call('/v1/seller/record', SellerRecordSchema, { auth: true }),

    listBuyerThreads: () => call('/v1/buyer/threads', ChatThreadListSchema, { auth: true }),
    getBuyerThread: (id) => call(`/v1/buyer/threads/${id}`, ChatThreadSchema, { auth: true }),
    sendBuyerMessage: (id, input) => call(`/v1/buyer/threads/${id}/messages`, ChatThreadSchema, { method: 'POST', body: input, auth: true }),
    markBuyerThreadRead: (id) => call(`/v1/buyer/threads/${id}/read`, ChatThreadSchema, { method: 'POST', auth: true }),
    listSellerThreads: () => call('/v1/seller/threads', ChatThreadListSchema, { auth: true }),
    getSellerThread: (id) => call(`/v1/seller/threads/${id}`, ChatThreadSchema, { auth: true }),
    sendSellerMessage: (id, input) => call(`/v1/seller/threads/${id}/messages`, ChatThreadSchema, { method: 'POST', body: input, auth: true }),
    markSellerThreadRead: (id) => call(`/v1/seller/threads/${id}/read`, ChatThreadSchema, { method: 'POST', auth: true }),

    createRequest: (input, key) => call('/v1/buyer/requests', BuyerRequestSchema, { method: 'POST', body: input, auth: true, ...idem(key) }),
    listBuyerRequests: () => call('/v1/buyer/requests', BuyerRequestListSchema, { auth: true }),
    getBuyerRequest: (id) => call(`/v1/buyer/requests/${id}`, BuyerRequestSchema, { auth: true }),
    closeRequest: (id, key) => call(`/v1/buyer/requests/${id}/close`, BuyerRequestSchema, { method: 'POST', auth: true, ...idem(key) }),
    wantResponse: (id, key) => call(`/v1/buyer/responses/${id}/want`, BuyerRequestSchema, { method: 'POST', auth: true, ...idem(key) }),
    declineResponse: (id, key) => call(`/v1/buyer/responses/${id}/decline`, BuyerRequestSchema, { method: 'POST', auth: true, ...idem(key) }),
    getRequestReach: (category) => call(`/v1/buyer/requests/reach?category=${encodeURIComponent(category)}`, ReachSchema, { auth: true }),
    listSellerRequests: () => call('/v1/seller/requests', SellerRequestListSchema, { auth: true }),
    respondToRequest: (id, input, key) => call(`/v1/seller/requests/${id}/responses`, SellerRequestSchema, { method: 'POST', body: input, auth: true, ...idem(key) }),

    listSellerReviews: () => call('/v1/seller/reviews', ShopReviewListSchema, { auth: true }),
    getShopReviews: (sellerId) => call(`/v1/shops/${sellerId}/reviews`, ShopReviewListSchema),
    getShopRecord: (sellerId) => call(`/v1/shops/${sellerId}/record`, SellerRecordSchema),
  };
}
