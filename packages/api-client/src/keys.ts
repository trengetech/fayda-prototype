import type { RealtimeEvent } from './realtime';

/** Prefix of every query of a kind, so one call refreshes them all (a socket event or a finished action). */
export const NEGOTIATIONS_KEY = 'negotiations';
export const ORDERS_KEY = 'orders';
export const THREADS_KEY = 'threads';
export const REQUESTS_KEY = 'requests';
export const REVIEWS_KEY = 'reviews';
export const RECORD_KEY = 'record';
export const FEED_KEY = 'buyer-feed';
export const SHOP_KEY = 'shop';
export const FOLLOWS_KEY = 'follows';
export const SAVED_KEY = 'saved';
export const COMMENTS_KEY = 'comments';
export const NOTIFICATIONS_KEY = 'notifications';
export const BLOCKS_KEY = 'blocks';
export const DASHBOARD_KEY = 'dashboard';
/** The buyer's own profile (addresses, contact). */
export const PROFILE_KEY = 'buyer-profile';

type Side = 'buyer' | 'seller';

/** Typed query keys. Each list key is a prefix of its detail key, so invalidating the list refreshes the details too. */
export const queryKeys = {
  buyerProfile: (baseUrl: string) => [PROFILE_KEY, baseUrl] as const,
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
  feed: (baseUrl: string, params: unknown) => [FEED_KEY, baseUrl, params] as const,
  shop: (baseUrl: string, handle: string | null) => [SHOP_KEY, baseUrl, handle] as const,
  shopListings: (baseUrl: string, handle: string | null, params: unknown) => [SHOP_KEY, baseUrl, handle, 'listings', params] as const,
  follows: (baseUrl: string) => [FOLLOWS_KEY, baseUrl] as const,
  saved: (baseUrl: string) => [SAVED_KEY, baseUrl] as const,
  notifications: (side: Side, baseUrl: string) => [NOTIFICATIONS_KEY, side, baseUrl] as const,
  blocks: (side: Side, baseUrl: string) => [BLOCKS_KEY, side, baseUrl] as const,
  dashboard: (baseUrl: string) => [DASHBOARD_KEY, baseUrl] as const,
  comments: (side: Side, baseUrl: string, listingId: string | null) => [COMMENTS_KEY, side, baseUrl, listingId] as const,
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
    case 'comment.created':
      return [COMMENTS_KEY, 'seller-listings', 'seller-listing', DASHBOARD_KEY];
    case 'notification.created':
      return [NOTIFICATIONS_KEY];
  }
}

/** Everything a reconnect refreshes: updates may have been missed while the socket was down. */
export const ALL_LIVE_KEYS: readonly string[] = [NEGOTIATIONS_KEY, 'buyer-listing', ORDERS_KEY, THREADS_KEY, REQUESTS_KEY, RECORD_KEY, REVIEWS_KEY, COMMENTS_KEY, NOTIFICATIONS_KEY, BLOCKS_KEY, DASHBOARD_KEY];

/**
 * The screen a notification opens, per app. Orders and chats open in both apps; a negotiation is `negotiation/:id` for the
 * buyer and `offer/:id` for the seller; a seller's listing notice (a comment) opens that listing's comments.
 */
export function notificationHref(side: Side, target: { kind: 'ORDER' | 'THREAD' | 'NEGOTIATION' | 'REQUEST' | 'LISTING'; id: string }): string {
  switch (target.kind) {
    case 'ORDER':
      return `/order/${target.id}`;
    case 'THREAD':
      return `/chat/${target.id}`;
    case 'NEGOTIATION':
      return side === 'buyer' ? `/negotiation/${target.id}` : `/offer/${target.id}`;
    case 'REQUEST':
      return side === 'buyer' ? `/request/${target.id}` : '/requests';
    case 'LISTING':
      return side === 'buyer' ? `/listing/${target.id}` : `/comments/${target.id}`;
  }
}
