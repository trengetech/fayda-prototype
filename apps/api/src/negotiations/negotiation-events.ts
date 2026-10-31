import { Injectable } from '@nestjs/common';

/** Someone's view of a negotiation changed. Carries ids only: clients refetch what they need. */
export interface NegotiationTouch {
  negotiationId: string;
  listingId: string;
  /** Who to tell: the buyer (in the buyer app) and the seller's user (in the seller app). */
  buyerUserId: string;
  sellerUserId: string;
}

/** Any other real-time change (an order, a chat message, a request). Carries ids only; the people it names refetch. */
export interface RealtimeEvent {
  /** `order.updated`, `chat.updated`, `request.updated`. */
  name: string;
  payload: Record<string, string>;
  buyerUserId?: string | null;
  sellerUserId?: string | null;
}

type Listener = (touches: NegotiationTouch[]) => void;
type EventListener = (events: RealtimeEvent[]) => void;

/**
 * A tiny in-process bus between the negotiation service and the Socket.IO gateway. The service calls `emit` only after a
 * transaction has committed, so a client that refetches always sees the new state.
 */
@Injectable()
export class NegotiationEvents {
  private readonly listeners = new Set<Listener>();
  private readonly eventListeners = new Set<EventListener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeEvents(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  /** Orders, chat and requests publish here, after their transaction has committed. */
  publish(events: RealtimeEvent[]): void {
    if (!events.length) return;
    for (const l of this.eventListeners) {
      try {
        l(events);
      } catch {
        // a broken listener must never undo a committed change
      }
    }
  }

  emit(touches: NegotiationTouch[]): void {
    if (!touches.length) return;
    for (const l of this.listeners) {
      try {
        l(touches);
      } catch {
        // a broken listener must never undo a committed change
      }
    }
  }
}
