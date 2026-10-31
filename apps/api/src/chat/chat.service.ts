import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@fayda/domain';
import { and, count, eq, gt, ne, sql } from 'drizzle-orm';
import { CLOCK } from '../common/clock.js';
import { DbService } from '../db/db.service.js';
import { chatMessages, chatThreads } from '../db/schema.js';

type Db = DbService['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;

/**
 * Chat. This file holds the part other modules call: creating a thread inside their own transaction, and reading
 * unread counts. Sending, reading and listing messages are added here by the chat work (M3.4, Gate 2).
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(DbService) protected readonly database: DbService,
    @Inject(CLOCK) protected readonly clock: Clock,
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
}
