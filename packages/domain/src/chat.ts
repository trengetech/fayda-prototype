import type { Contact } from './profiles.js';
import { RULES } from './rules.js';
import { fail, type Result } from './types.js';
import type { OrderStatus } from './orders.js';

export type ThreadKind = 'ORDER' | 'REQUEST';
export type MessageFrom = 'BUYER' | 'SELLER' | 'SYSTEM';
export type MessageType = 'TEXT' | 'MEDIA' | 'LISTING';

export interface ThreadParties {
  buyerUserId: string;
  sellerUserId: string;
}
export interface ChatMessage {
  from: MessageFrom;
  at: number;
}

/** Which side of the thread this user is, or null if they are not part of it. */
export function threadSide(t: ThreadParties, userId: string): 'BUYER' | 'SELLER' | null {
  return userId === t.buyerUserId ? 'BUYER' : userId === t.sellerUserId ? 'SELLER' : null;
}

export interface MessageInput {
  text?: string | null;
  mediaId?: string | null;
  listing?: { id: string; sellerId: string; status: string } | null;
}
export type ValidMessage = { type: 'TEXT'; text: string } | { type: 'MEDIA'; mediaId: string; text: string } | { type: 'LISTING'; listingId: string };

/**
 * Checks a message before it is stored. Only the thread's two people may write; only the seller may share a listing,
 * and only one of their own live listings.
 */
export function validateMessage(t: ThreadParties & { sellerId: string }, userId: string, i: MessageInput): Result<{ side: 'BUYER' | 'SELLER'; message: ValidMessage }> {
  const side = threadSide(t, userId);
  if (!side) return fail('FORBIDDEN', 'You’re not part of this chat.');
  if (i.listing) {
    if (side !== 'SELLER' || i.listing.sellerId !== t.sellerId || i.listing.status !== 'ACTIVE') return fail('INVALID_LISTING', 'Share one of your live listings.');
    return { ok: true, side, message: { type: 'LISTING', listingId: i.listing.id } };
  }
  if (i.mediaId) return { ok: true, side, message: { type: 'MEDIA', mediaId: i.mediaId, text: String(i.text ?? '').trim().slice(0, 500) } };
  const text = String(i.text ?? '').trim();
  if (!text) return fail('EMPTY', 'Write a message first.');
  if (text.length > RULES.MAX_MESSAGE_CHARS) return fail('TOO_LONG', 'Keep messages under 1,000 characters.');
  return { ok: true, side, message: { type: 'TEXT', text } };
}

/** Messages from the other person after this side last read the thread. System messages never count. */
export function unreadCount(messages: readonly ChatMessage[], readAt: number, viewer: 'BUYER' | 'SELLER'): number {
  return messages.filter((m) => m.from !== viewer && m.from !== 'SYSTEM' && m.at > readAt).length;
}

// ---------- contact visibility ----------
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = ['PLACED', 'CONFIRMED', 'SHIPPED'];
export const isOpenOrder = (status: OrderStatus): boolean => OPEN_ORDER_STATUSES.includes(status);

/** The other party's phone and WhatsApp, only while the order is open. After that only the chat remains. */
export function contactForOrder(status: OrderStatus, otherParty: Contact | null | undefined): Contact | null {
  return isOpenOrder(status) ? { phone: otherParty?.phone ?? null, whatsapp: otherParty?.whatsapp ?? null } : null;
}
