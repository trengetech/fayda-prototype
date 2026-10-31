import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ChatMessageView, ChatThread, ChatThreadList, SendMessage } from '@fayda/contracts';
import { formatOrderNumber, mayShareFromResponse, validateMessage, type Clock } from '@fayda/domain';
import { and, count, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { checkOwnedMedia, firstName, listingCovers, mediaRefs } from '../community/shared.js';
import { DbService } from '../db/db.service.js';
import { buyerRequests, chatMessages, chatThreads, listings, notifications, orders, requestResponses, sellers, users } from '../db/schema.js';
import { NegotiationEvents, type RealtimeEvent } from '../negotiations/negotiation-events.js';
import { throwFail } from '../negotiations/negotiations.service.js';

type Db = DbService['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;
type Side = 'BUYER' | 'SELLER';
type ThreadRow = typeof chatThreads.$inferSelect;
/** The most recent messages one chat screen loads. */
export const MAX_THREAD_MESSAGES = 200;
/** Messages written in the same millisecond: the system line ("Order placed") always sorts before a person's reply. */
const NEWEST_FIRST_TIE = sql`(${chatMessages.from} = 'SYSTEM') asc`;

/**
 * Chat. This file holds the part other modules call: creating a thread inside their own transaction, and reading
 * unread counts. Sending, reading and listing messages are added here by the chat work (M3.4, Gate 2).
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(DbService) protected readonly database: DbService,
    @Inject(CLOCK) protected readonly clock: Clock,
    @Inject(NegotiationEvents) protected readonly events: NegotiationEvents,
  ) {}

  protected get db(): Db {
    return this.database.db;
  }

  /** An order's thread is created with the order, starting with a SYSTEM message. Call inside the order's transaction. */
  async createOrderThread(
    tx: Tx,
    o: { orderId: string; buyerUserId: string; sellerId: string; sellerUserId: string; systemText: string; now: number },
  ): Promise<string> {
    const id = randomUUID();
    const at = new Date(o.now);
    await tx.insert(chatThreads).values({
      id,
      kind: 'ORDER',
      orderId: o.orderId,
      buyerUserId: o.buyerUserId,
      sellerId: o.sellerId,
      sellerUserId: o.sellerUserId,
      buyerReadAt: at,
      sellerReadAt: at,
      lastMessageAt: at,
      createdAt: at,
    });
    await tx.insert(chatMessages).values({ threadId: id, from: 'SYSTEM', type: 'TEXT', text: o.systemText, createdAt: at });
    return id;
  }

  /** A request thread opens when the buyer says "I want this" on a response. Call inside that transaction. */
  async createRequestThread(
    tx: Tx,
    o: { requestId: string; responseId: string; buyerUserId: string; sellerId: string; sellerUserId: string; systemText: string; now: number },
  ): Promise<string> {
    const id = randomUUID();
    const at = new Date(o.now);
    await tx.insert(chatThreads).values({
      id,
      kind: 'REQUEST',
      requestId: o.requestId,
      responseId: o.responseId,
      buyerUserId: o.buyerUserId,
      sellerId: o.sellerId,
      sellerUserId: o.sellerUserId,
      buyerReadAt: at,
      sellerReadAt: at,
      lastMessageAt: at,
      createdAt: at,
    });
    await tx.insert(chatMessages).values({ threadId: id, from: 'SYSTEM', type: 'TEXT', text: o.systemText, createdAt: at });
    return id;
  }

  /** Thread id and unread count for each order, as seen by one side. Orders without a thread are simply absent. */
  async orderThreadInfo(q: Q, orderIds: string[], side: 'BUYER' | 'SELLER'): Promise<Map<string, { threadId: string; unread: number }>> {
    const out = new Map<string, { threadId: string; unread: number }>();
    if (!orderIds.length) return out;
    const rows = await q.select({ id: chatThreads.id, orderId: chatThreads.orderId, buyerReadAt: chatThreads.buyerReadAt, sellerReadAt: chatThreads.sellerReadAt }).from(chatThreads).where(sql`${chatThreads.orderId} in ${orderIds}`);
    for (const t of rows) {
      const readAt = side === 'BUYER' ? t.buyerReadAt : t.sellerReadAt;
      const other = side === 'BUYER' ? 'SELLER' : 'BUYER';
      const [u] = await q
        .select({ n: count() })
        .from(chatMessages)
        .where(and(eq(chatMessages.threadId, t.id), eq(chatMessages.from, other), gt(chatMessages.createdAt, readAt), ne(chatMessages.from, 'SYSTEM')));
      out.set(t.orderId as string, { threadId: t.id, unread: u?.n ?? 0 });
    }
    return out;
  }

  // ---------- reading ----------
  /** The thread if this person is part of it, in this app. Anyone else gets "not found", so ids reveal nothing. */
  private async mine(q: Q, userId: string, side: Side, id: string, lock = false): Promise<ThreadRow> {
    const base = q.select().from(chatThreads).where(and(eq(chatThreads.id, id), eq(side === 'BUYER' ? chatThreads.buyerUserId : chatThreads.sellerUserId, userId))).limit(1);
    const [t] = lock ? await base.for('update') : await base;
    if (!t) throw new AppError(404, 'NOT_FOUND', 'Chat not found.');
    return t;
  }

  private async unreadBy(q: Q, rows: ThreadRow[], side: Side): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    for (const t of rows) {
      const readAt = side === 'BUYER' ? t.buyerReadAt : t.sellerReadAt;
      const [u] = await q.select({ n: count() }).from(chatMessages).where(and(eq(chatMessages.threadId, t.id), eq(chatMessages.from, side === 'BUYER' ? 'SELLER' : 'BUYER'), gt(chatMessages.createdAt, readAt)));
      out.set(t.id, u?.n ?? 0);
    }
    return out;
  }

  /** Titles and the other person's name for a set of threads. */
  private async labels(q: Q, rows: ThreadRow[], side: Side): Promise<Map<string, { title: string; otherName: string }>> {
    const out = new Map<string, { title: string; otherName: string }>();
    const orderIds = rows.map((t) => t.orderId).filter((x): x is string => !!x);
    const requestIds = rows.map((t) => t.requestId).filter((x): x is string => !!x);
    const [os, rs, ss, bs] = await Promise.all([
      orderIds.length ? q.select({ id: orders.id, seq: orders.seq, title: orders.listingTitle }).from(orders).where(inArray(orders.id, orderIds)) : [],
      requestIds.length ? q.select({ id: buyerRequests.id, title: buyerRequests.title }).from(buyerRequests).where(inArray(buyerRequests.id, requestIds)) : [],
      q.select({ id: sellers.id, name: sellers.name }).from(sellers).where(inArray(sellers.id, rows.map((t) => t.sellerId))),
      q.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, rows.map((t) => t.buyerUserId))),
    ]);
    for (const t of rows) {
      const o = os.find((x) => x.id === t.orderId);
      const r = rs.find((x) => x.id === t.requestId);
      const title = o ? `${formatOrderNumber(o.seq)} · ${o.title}` : (r?.title ?? 'Chat');
      const otherName = side === 'BUYER' ? (ss.find((x) => x.id === t.sellerId)?.name ?? 'Seller') : firstName(bs.find((x) => x.id === t.buyerUserId)?.name);
      out.set(t.id, { title, otherName });
    }
    return out;
  }

  async list(userId: string, side: Side): Promise<ChatThreadList> {
    const rows = await this.db.select().from(chatThreads).where(eq(side === 'BUYER' ? chatThreads.buyerUserId : chatThreads.sellerUserId, userId)).orderBy(desc(chatThreads.lastMessageAt), desc(chatThreads.id)).limit(200);
    const [unread, labels] = await Promise.all([this.unreadBy(this.db, rows, side), this.labels(this.db, rows, side)]);
    const last = new Map<string, string | null>();
    for (const t of rows) {
      const [m] = await this.db.select({ type: chatMessages.type, text: chatMessages.text }).from(chatMessages).where(eq(chatMessages.threadId, t.id)).orderBy(desc(chatMessages.createdAt), NEWEST_FIRST_TIE, desc(chatMessages.id)).limit(1);
      last.set(t.id, m ? (m.type === 'LISTING' ? 'Shared a listing' : m.type === 'MEDIA' && !m.text ? 'Photo' : m.text) : null);
    }
    const items = rows.map((t) => ({
      id: t.id,
      kind: t.kind,
      title: labels.get(t.id)!.title,
      otherName: labels.get(t.id)!.otherName,
      orderId: t.orderId,
      requestId: t.requestId,
      unread: unread.get(t.id) ?? 0,
      lastMessage: last.get(t.id) ?? null,
      lastAt: t.lastMessageAt.getTime(),
    }));
    return { items, unread: items.reduce((n, x) => n + x.unread, 0) };
  }

  async get(userId: string, side: Side, id: string): Promise<ChatThread> {
    const t = await this.mine(this.db, userId, side, id);
    return this.view(this.db, t, side);
  }

  private async view(q: Q, t: ThreadRow, side: Side): Promise<ChatThread> {
    const rows = (await q.select().from(chatMessages).where(eq(chatMessages.threadId, t.id)).orderBy(desc(chatMessages.createdAt), NEWEST_FIRST_TIE, desc(chatMessages.id)).limit(MAX_THREAD_MESSAGES)).reverse();
    const [labels, unread, refs, covers] = await Promise.all([
      this.labels(q, [t], side),
      this.unreadBy(q, [t], side),
      mediaRefs(q, rows.map((m) => m.mediaId).filter((x): x is string => !!x)),
      listingCovers(q, rows.map((m) => m.listingId).filter((x): x is string => !!x)),
    ]);
    const listingIds = rows.map((m) => m.listingId).filter((x): x is string => !!x);
    const ls = listingIds.length ? await q.select({ id: listings.id, title: listings.title, price: listings.pricePaise }).from(listings).where(inArray(listings.id, listingIds)) : [];
    const messages: ChatMessageView[] = rows.map((m) => {
      const l = m.listingId ? ls.find((x) => x.id === m.listingId) : undefined;
      return {
        id: m.id,
        from: m.from === 'SYSTEM' ? 'SYSTEM' : m.from === side ? 'ME' : 'OTHER',
        type: m.type,
        text: m.text,
        media: m.mediaId ? (refs.get(m.mediaId) ?? null) : null,
        listing: l ? { id: l.id, title: l.title, price: l.price, coverUrl: covers.get(l.id) ?? null } : null,
        at: m.createdAt.getTime(),
      };
    });
    const lab = labels.get(t.id)!;
    const lastText = messages.length ? messages[messages.length - 1]! : null;
    return {
      id: t.id,
      kind: t.kind,
      title: lab.title,
      otherName: lab.otherName,
      orderId: t.orderId,
      requestId: t.requestId,
      unread: unread.get(t.id) ?? 0,
      lastMessage: lastText ? (lastText.type === 'LISTING' ? 'Shared a listing' : (lastText.text ?? 'Photo')) : null,
      lastAt: t.lastMessageAt.getTime(),
      messages,
    };
  }

  // ---------- writing ----------
  /** Posts a message and tells the other person. A retry with the same `clientKey` returns the thread without posting twice. */
  async send(userId: string, side: Side, id: string, input: SendMessage): Promise<ChatThread> {
    const evs: RealtimeEvent[] = [];
    await this.db.transaction(async (tx) => {
      // The thread row is locked, so two sends in the same chat are handled one after the other.
      const t = await this.mine(tx, userId, side, id, true);
      if (input.clientKey) {
        const [dup] = await tx.select({ id: chatMessages.id }).from(chatMessages).where(and(eq(chatMessages.threadId, id), eq(chatMessages.clientKey, input.clientKey))).limit(1);
        if (dup) return;
      }
      let listing: { id: string; sellerId: string; status: string } | null = null;
      if (input.listingId) {
        const [l] = await tx.select({ id: listings.id, sellerId: listings.sellerId, status: listings.status }).from(listings).where(eq(listings.id, input.listingId)).limit(1);
        if (!l) throwFail({ ok: false, code: 'INVALID_LISTING', message: 'Share one of your live listings.' });
        listing = l;
      }
      if (input.mediaId && !listing) {
        const bad = await checkOwnedMedia(tx, userId, [input.mediaId], 'CHAT', { images: true, max: 1 });
        if (bad) throw new AppError(400, 'VALIDATION', 'Check the photo.', { media: bad });
      }
      const v = validateMessage({ buyerUserId: t.buyerUserId, sellerUserId: t.sellerUserId, sellerId: t.sellerId }, userId, { text: input.text ?? null, mediaId: input.mediaId ?? null, listing });
      if (!v.ok) throwFail(v);
      const now = new Date(this.clock.now());
      await tx.insert(chatMessages).values({
        threadId: id,
        from: v.side,
        type: v.message.type,
        text: v.message.type === 'LISTING' ? null : v.message.text,
        mediaId: v.message.type === 'MEDIA' ? v.message.mediaId : null,
        listingId: v.message.type === 'LISTING' ? v.message.listingId : null,
        clientKey: input.clientKey ?? null,
        createdAt: now,
      });
      await this.afterPost(tx, t, v.side, now, evs);
    });
    this.events.publish(evs);
    return this.get(userId, side, id);
  }

  /** Bumps the thread, tells the other side, and queues the real-time event. Call inside the transaction that posted. */
  private async afterPost(tx: Tx, t: ThreadRow, from: Side, now: Date, evs: RealtimeEvent[]): Promise<void> {
    const readCol = from === 'BUYER' ? { buyerReadAt: now } : { sellerReadAt: now };
    // Writing a message means you have read the chat up to now.
    await tx.update(chatThreads).set({ lastMessageAt: now, ...readCol }).where(eq(chatThreads.id, t.id));
    await tx.insert(notifications).values({ userId: from === 'BUYER' ? t.sellerUserId : t.buyerUserId, app: from === 'BUYER' ? 'seller' : 'buyer', code: 'NEW_MESSAGE', threadId: t.id, orderId: t.orderId, requestId: t.requestId, createdAt: now });
    evs.push({ name: 'chat.updated', payload: { threadId: t.id }, buyerUserId: t.buyerUserId, sellerUserId: t.sellerUserId });
  }

  async markRead(userId: string, side: Side, id: string): Promise<ChatThread> {
    const now = new Date(this.clock.now());
    const t = await this.mine(this.db, userId, side, id);
    // Only ever moves forward.
    await this.db
      .update(chatThreads)
      .set(side === 'BUYER' ? { buyerReadAt: sql`greatest(${chatThreads.buyerReadAt}, ${now.toISOString()}::timestamptz)` } : { sellerReadAt: sql`greatest(${chatThreads.sellerReadAt}, ${now.toISOString()}::timestamptz)` })
      .where(eq(chatThreads.id, t.id));
    this.events.publish([{ name: 'chat.updated', payload: { threadId: t.id }, buyerUserId: side === 'BUYER' ? t.buyerUserId : null, sellerUserId: side === 'SELLER' ? t.sellerUserId : null }]);
    return this.get(userId, side, id);
  }

  /**
   * "Create listing from a request": after a listing published from a WANTED response, post it in that chat as the seller and
   * remember it on the response. Does nothing unless the response belongs to this seller, is WANTED and has a chat.
   */
  async shareListingFromResponse(sellerId: string, responseId: string, listingId: string): Promise<boolean> {
    const evs: RealtimeEvent[] = [];
    const done = await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(requestResponses).where(eq(requestResponses.id, responseId)).for('update');
      if (!mayShareFromResponse(r ? { sellerId: r.sellerId, status: r.status, threadId: r.threadId } : undefined, sellerId) || !r) return false;
      if (r.listingId === listingId) return false;
      const [l] = await tx.select({ id: listings.id, sellerId: listings.sellerId, status: listings.status }).from(listings).where(eq(listings.id, listingId)).limit(1);
      if (!l || l.sellerId !== sellerId || l.status !== 'ACTIVE') return false;
      const [t] = await tx.select().from(chatThreads).where(eq(chatThreads.id, r.threadId as string)).for('update');
      if (!t) return false;
      const now = new Date(this.clock.now());
      await tx.insert(chatMessages).values({ threadId: t.id, from: 'SELLER', type: 'LISTING', listingId, createdAt: now });
      await tx.update(requestResponses).set({ listingId }).where(eq(requestResponses.id, responseId));
      await this.afterPost(tx, t, 'SELLER', now, evs);
      return true;
    });
    this.events.publish(evs);
    return done;
  }
}
