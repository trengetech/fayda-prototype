import { HealthSchema, MetaSchema, ProblemSchema, type Health, type Meta, type Problem, type z } from '@fayda/contracts/schemas';

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
}

export interface ApiClient {
  readonly baseUrl: string;
  getHealth(): Promise<Health>;
  getMeta(): Promise<Meta>;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;

  async function get<T>(path: string, schema: z.ZodType<T>, acceptStatuses: number[] = []): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(baseUrl + path, { headers: { accept: 'application/json' }, signal: ctrl.signal });
    } catch (e) {
      const timedOut = ctrl.signal.aborted;
      throw new NetworkError(timedOut ? `No answer from ${baseUrl} after ${timeoutMs / 1000}s` : `Could not reach ${baseUrl}`, { cause: e });
    } finally {
      clearTimeout(timer);
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new ApiError(res.status, `Unexpected response (${res.status})`);
    }
    if (res.ok || acceptStatuses.includes(res.status)) {
      const parsed = schema.safeParse(body);
      if (!parsed.success) throw new ApiError(res.status, 'The server sent data in an unexpected shape');
      return parsed.data;
    }
    const problem = ProblemSchema.safeParse(body);
    throw new ApiError(res.status, problem.success ? (problem.data.detail ?? problem.data.title) : `Request failed (${res.status})`, problem.success ? problem.data : undefined);
  }

  return {
    baseUrl,
    // 503 still carries a valid Health body ("database down"), which is data to show, not an error.
    getHealth: () => get('/v1/health', HealthSchema, [503]),
    getMeta: () => get('/v1/meta', MetaSchema),
  };
}
