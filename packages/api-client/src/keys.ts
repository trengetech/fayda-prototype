import type { RealtimeEvent } from './realtime';

/** Prefix of every query of a kind, so one call refreshes them all (a socket event or a finished action). */
export const NEGOTIATIONS_KEY = 'negotiations';
export const ORDERS_KEY = 'orders';
export const THREADS_KEY = 'threads';
export const REQUESTS_KEY = 'requests';
export const REVIEWS_KEY = 'reviews';
export const RECORD_KEY = 'record';

type Side = 'buyer' | 'seller';

/** Typed query keys. Each list key is a prefix of its detail key, so invalidating the list refreshes the details too. */
export const queryKeys = {
  orders: (side: Side, baseUrl: string) => [ORDERS_KEY, side, baseUrl] as const,
  order: (side: Side, baseUrl: string, id: string | null) => [ORDERS_KEY, side, baseUrl, id] as const,
  threads: (side: Side, baseUrl: string) => [THREADS_KEY, side, baseUrl] as const,
  thread: (side: Side, baseUrl: string, id: string | null) => [THREADS_KEY, side, baseUrl, id] as const,
  requests: (side: Side, baseUrl: string) => [REQUESTS_KEY, side, baseUrl] as const,
  request: (side: Side, baseUrl: string, id: string | null) => [REQUESTS_KEY, side, baseUrl, id] as const,
  requestReach: (baseUrl: string, category: string | null) => [REQUESTS_KEY, 'reach', baseUrl, category] as const,
  sellerReviews: (baseUrl: string) => [REVIEWS_KEY, 'seller', baseUrl] as const,
  shopReviews: (baseUrl: string, sellerId: string | null) => [REVIEWS_KEY, 'shop', baseUrl, sellerId] as const,
  shopRecord: (baseUrl: string, sellerId: string | null) => [RECORD_KEY, 'shop', baseUrl, sellerId] as const,
  sellerRecord: (baseUrl: string) => [RECORD_KEY, 'seller', baseUrl] as const,
} as const;

/**
 * Which query prefixes a socket event makes stale. An order change also moves the seller record and the buyer-listing stock;
 * a chat message changes unread badges on the order lists; a request change can add a thread.
 */
export function invalidationFor(e: RealtimeEvent): string[] {
  switch (e.name) {
    case 'negotiation.updated':
      return [NEGOTIATIONS_KEY, 'buyer-listing'];
    case 'order.updated':
      return [ORDERS_KEY, THREADS_KEY, RECORD_KEY, 'buyer-listing', REVIEWS_KEY];
    case 'chat.updated':
      return [THREADS_KEY, ORDERS_KEY];
    case 'request.updated':
      return [REQUESTS_KEY, THREADS_KEY];
  }
}

/** Everything a reconnect refreshes: updates may have been missed while the socket was down. */
export const ALL_LIVE_KEYS: readonly string[] = [NEGOTIATIONS_KEY, 'buyer-listing', ORDERS_KEY, THREADS_KEY, REQUESTS_KEY, RECORD_KEY, REVIEWS_KEY];
