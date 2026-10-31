import { Injectable } from '@nestjs/common';

/** Someone's view of a negotiation changed. Carries ids only: clients refetch what they need. */
export interface NegotiationTouch {
  negotiationId: string;
  listingId: string;
  /** Users to tell: the buyer and the seller's user. */
  userIds: string[];
}

type Listener = (touches: NegotiationTouch[]) => void;

/**
 * A tiny in-process bus between the negotiation service and the Socket.IO gateway. The service calls `emit` only after a
 * transaction has committed, so a client that refetches always sees the new state.
 */
@Injectable()
export class NegotiationEvents {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
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
