import {
  AuthResultSchema,
  BuyerProfileSchema,
  HealthSchema,
  MeSchema,
  MetaSchema,
  OtpRequestedSchema,
  ProblemSchema,
  SellerProfileSchema,
  type AppAudience,
  type AuthResult,
  type BuyerProfile,
  type BuyerProfileInput,
  type Health,
  type Me,
  type Meta,
  type OtpRequested,
  type PaymentInput,
  type Problem,
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
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
interface CallOptions {
  method?: Method;
  body?: unknown;
  /** Send the bearer token, and on 401 refresh once and retry. */
  auth?: boolean;
  acceptStatuses?: number[];
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
  };
}
