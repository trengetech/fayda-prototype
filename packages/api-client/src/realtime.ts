import { io } from 'socket.io-client';
import type { ChatEventPayload, NegotiationEventPayload, OrderEventPayload, RequestEventPayload } from '@fayda/contracts/schemas';

/** Everything the socket can say. Each carries ids only. */
export type RealtimeEvent =
  | ({ name: 'negotiation.updated' } & NegotiationEventPayload)
  | ({ name: 'order.updated' } & OrderEventPayload)
  | ({ name: 'chat.updated' } & ChatEventPayload)
  | ({ name: 'request.updated' } & RequestEventPayload);

export interface RealtimeOptions {
  baseUrl: string;
  /** The current access token, or null when signed out. Read again on every (re)connect. */
  getAccessToken: () => string | null;
  /** Get a fresh access token (the old one expired). Return null to give up until the next sign-in. */
  refreshAccessToken: () => Promise<string | null>;
  /** A negotiation this person is part of changed. Refetch it. */
  onUpdate: (e: NegotiationEventPayload) => void;
  /** Any event, including orders, chat and requests (negotiation events arrive here too). */
  onEvent?: (e: RealtimeEvent) => void;
  /** The socket (re)connected. Updates may have been missed while it was down, so refetch what is on screen. */
  onConnect?: () => void;
}

/**
 * Keeps one Socket.IO connection to the API. Events carry ids only: the app refetches through the normal client, so the
 * socket can never show something the HTTP API would not. The connection reconnects by itself; if the server refuses
 * the token, one refresh is tried before giving up.
 */
export function startRealtime(opts: RealtimeOptions): { close(): void } {
  const socket = io(opts.baseUrl, {
    transports: ['websocket'],
    auth: (cb) => cb({ token: opts.getAccessToken() }),
    reconnection: true,
    reconnectionDelayMax: 10_000,
  });
  let refusedOnce = false;
  socket.on('connect', () => {
    refusedOnce = false;
    opts.onConnect?.();
  });
  socket.on('negotiation.updated', (e: NegotiationEventPayload) => {
    opts.onUpdate(e);
    opts.onEvent?.({ name: 'negotiation.updated', ...e });
  });
  socket.on('order.updated', (e: OrderEventPayload) => opts.onEvent?.({ name: 'order.updated', ...e }));
  socket.on('chat.updated', (e: ChatEventPayload) => opts.onEvent?.({ name: 'chat.updated', ...e }));
  socket.on('request.updated', (e: RequestEventPayload) => opts.onEvent?.({ name: 'request.updated', ...e }));
  socket.on('connect_error', (err) => {
    // A refused token ends automatic retries (the server said no), so refresh once and connect again by hand.
    if (err.message !== 'UNAUTHENTICATED' || refusedOnce) return;
    refusedOnce = true;
    void opts.refreshAccessToken().then((t) => t && socket.connect());
  });
  return { close: () => void socket.close() };
}
