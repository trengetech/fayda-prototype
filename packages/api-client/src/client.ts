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
  BuyerListingSchema,
  BuyerNegotiationListSchema,
  BuyerNegotiationSchema,
  SellerNegotiationListSchema,
  SellerNegotiationSchema,
  SellerListingListSchema,
  SellerListingSchema,
  SellerProfileSchema,
  type AppAudience,
  type AuthResult,
  type BuyerProfile,
  type BuyerProfileInput,
  type Health,
  type Me,
  type BuyerFeed,
  type BuyerListing,
  type BuyerNegotiation,
  type BuyerNegotiationList,
  type SellerNegotiation,
  type SellerNegotiationList,
  type ListingInput,
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
  getSellerProfile(): Promise<SellerProfile>;
  saveSellerShop(input: SellerShopInput): Promise<SellerProfile>;
  saveSellerPayment(input: PaymentInput): Promise<SellerProfile>;
  /** Turns an address from the API (`/v1/media/…` or a full URL) into one a player or uploader can use. */
  resolveUrl(path: string): string;
  createMediaIntent(input: MediaIntentInput): Promise<MediaIntent>;
  completeMedia(mediaId: string): Promise<Media>;
  listSellerListings(): Promise<SellerListing[]>;
  getSellerListing(id: string): Promise<SellerListing>;
  /** `idempotencyKey` makes a retry after a lost reply safe: reuse the same key for the same save. */
  createListing(input: ListingInput, idempotencyKey?: string): Promise<SellerListing>;
  updateListing(id: string, input: ListingInput, idempotencyKey?: string): Promise<SellerListing>;
  setListingStatus(id: string, status: 'ACTIVE' | 'PAUSED', idempotencyKey?: string): Promise<SellerListing>;
  deleteListingDraft(id: string): Promise<void>;
  /** One page of the buyer feed. Pass the previous page's `nextCursor` to get the next one. */
  getBuyerFeed(cursor?: string | null, limit?: number): Promise<BuyerFeed>;
  getBuyerListing(id: string): Promise<BuyerListing>;
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
}

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
    getSellerProfile: () => call('/v1/seller/profile', SellerProfileSchema, { auth: true }),
    saveSellerShop: (input) => call('/v1/seller/profile', SellerProfileSchema, { method: 'PUT', body: input, auth: true }),
    saveSellerPayment: (input) => call('/v1/seller/payment', SellerProfileSchema, { method: 'PUT', body: input, auth: true }),
    resolveUrl: (path) => (path.startsWith('/') ? baseUrl + path : path),
    createMediaIntent: (input) => call('/v1/seller/media/intents', MediaIntentSchema, { method: 'POST', body: input, auth: true }),
    completeMedia: (mediaId) => call(`/v1/seller/media/${mediaId}/complete`, MediaSchema, { method: 'POST', auth: true }),
    listSellerListings: async () => (await call('/v1/seller/listings', SellerListingListSchema, { auth: true })).items,
    getSellerListing: (id) => call(`/v1/seller/listings/${id}`, SellerListingSchema, { auth: true }),
    createListing: (input, key) => call('/v1/seller/listings', SellerListingSchema, { method: 'POST', body: input, auth: true, ...idem(key) }),
    updateListing: (id, input, key) => call(`/v1/seller/listings/${id}`, SellerListingSchema, { method: 'PUT', body: input, auth: true, ...idem(key) }),
    setListingStatus: (id, status, key) => call(`/v1/seller/listings/${id}/status`, SellerListingSchema, { method: 'POST', body: { status }, auth: true, ...idem(key) }),
    deleteListingDraft: (id) => call(`/v1/seller/listings/${id}`, NoBody, { method: 'DELETE', auth: true }),
    getBuyerFeed: (cursor, limit) => {
      const q = new URLSearchParams();
      if (cursor) q.set('cursor', cursor);
      if (limit) q.set('limit', String(limit));
      const qs = q.toString();
      return call(`/v1/buyer/feed${qs ? `?${qs}` : ''}`, BuyerFeedSchema, { auth: true });
    },
    getBuyerListing: (id) => call(`/v1/buyer/listings/${id}`, BuyerListingSchema, { auth: true }),
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
  };
}
