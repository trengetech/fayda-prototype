import { Inject, Injectable } from '@nestjs/common';
import type { BlockInput, BlockedList, BlockedPerson, ReportInput, ReportReceipt } from '@fayda/contracts';
import { mayBlock, mayReport, validateReport, type Clock } from '@fayda/domain';
import { and, count, desc, eq, gt, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { firstName } from '../community/shared.js';
import { DbService } from '../db/db.service.js';
import { chatMessages, chatThreads, comments, listings, reports, sellers, userBlocks, users } from '../db/schema.js';

const HOUR = 3_600_000;
type Side = 'BUYER' | 'SELLER';
type Refusal = { code: string; message: string };
const refused = (r: Refusal): AppError => new AppError(r.code === 'RATE_LIMITED' ? 429 : r.code === 'VALIDATION' ? 400 : 403, r.code as never, r.message);

/**
 * Report and block (I-31). A report keeps the words as reported and goes to a moderation list (status OPEN). A block is by
 * person across both apps; what it changes is decided where it is used: comments (`SocialService`) and chat (`ChatService`).
 */
@Injectable()
export class SafetyService {
  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** A comment this person may see: not removed, on a live listing, or on their own listing (not a draft). Otherwise "not found". */
  private async visibleComment(userId: string, commentId: string) {
    const [c] = await this.db
      .select({ id: comments.id, text: comments.text, authorUserId: comments.authorUserId, removedAt: comments.removedAt, status: listings.status, ownerUserId: sellers.userId })
      .from(comments)
      .innerJoin(listings, eq(listings.id, comments.listingId))
      .innerJoin(sellers, eq(sellers.id, listings.sellerId))
      .where(eq(comments.id, commentId))
      .limit(1);
    if (!c || c.removedAt || c.status === 'DRAFT' || (c.ownerUserId !== userId && c.status !== 'ACTIVE')) throw new AppError(404, 'NOT_FOUND', 'Comment not found.');
    return c;
  }

  /** Records a report. One per person per target: sending it again changes nothing and still says it was received. */
  private async record(reporterUserId: string, input: ReportInput, target: { type: 'COMMENT' | 'CHAT_MESSAGE'; id: string; authorUserId: string; snapshot: string | null; mediaId?: string | null }): Promise<ReportReceipt> {
    const v = validateReport(input);
    if (!v.ok) throw refused(v);
    const now = new Date(this.clock.now());
    await this.db.transaction(async (tx) => {
      // One person's reports are handled one at a time, so a burst of parallel reports cannot all pass the hourly limit.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`reports:${reporterUserId}`}, 0))`);
      const [already] = await tx.select({ id: reports.id }).from(reports).where(and(eq(reports.reporterUserId, reporterUserId), eq(reports.targetType, target.type), eq(reports.targetId, target.id))).limit(1);
      if (already) return;
      const [recent] = await tx.select({ n: count() }).from(reports).where(and(eq(reports.reporterUserId, reporterUserId), gt(reports.createdAt, new Date(now.getTime() - HOUR))));
      const ok = mayReport({ reporterUserId, authorUserId: target.authorUserId, reportsInLastHour: recent?.n ?? 0 });
      if (!ok.ok) throw refused(ok);
      await tx.insert(reports).values({ reporterUserId, targetType: target.type, targetId: target.id, targetUserId: target.authorUserId, reason: v.reason, note: v.note, snapshot: target.snapshot, mediaId: target.mediaId ?? null, createdAt: now }).onConflictDoNothing();
    });
    return { received: true };
  }

  async reportComment(userId: string, commentId: string, input: ReportInput): Promise<ReportReceipt> {
    const c = await this.visibleComment(userId, commentId);
    return this.record(userId, input, { type: 'COMMENT', id: c.id, authorUserId: c.authorUserId, snapshot: c.text });
  }

  /** A message or photo from the other person in a chat this person is part of. System messages and your own cannot be reported. */
  async reportMessage(userId: string, side: Side, threadId: string, messageId: string, input: ReportInput): Promise<ReportReceipt> {
    const [m] = await this.db
      .select({ id: chatMessages.id, from: chatMessages.from, text: chatMessages.text, mediaId: chatMessages.mediaId, buyer: chatThreads.buyerUserId, seller: chatThreads.sellerUserId })
      .from(chatMessages)
      .innerJoin(chatThreads, eq(chatThreads.id, chatMessages.threadId))
      .where(and(eq(chatMessages.id, messageId), eq(chatMessages.threadId, threadId), eq(side === 'BUYER' ? chatThreads.buyerUserId : chatThreads.sellerUserId, userId)))
      .limit(1);
    if (!m || m.from === 'SYSTEM') throw new AppError(404, 'NOT_FOUND', 'Message not found.');
    const authorUserId = m.from === 'BUYER' ? m.buyer : m.seller;
    return this.record(userId, input, { type: 'CHAT_MESSAGE', id: m.id, authorUserId, snapshot: m.text, mediaId: m.mediaId });
  }

  // ---------- blocking ----------
  private async personOf(userId: string, side: Side, input: BlockInput): Promise<string> {
    if (input.source === 'COMMENT') return (await this.visibleComment(userId, input.id)).authorUserId;
    const [t] = await this.db
      .select({ buyer: chatThreads.buyerUserId, seller: chatThreads.sellerUserId })
      .from(chatThreads)
      .where(and(eq(chatThreads.id, input.id), eq(side === 'BUYER' ? chatThreads.buyerUserId : chatThreads.sellerUserId, userId)))
      .limit(1);
    if (!t) throw new AppError(404, 'NOT_FOUND', 'Chat not found.');
    return side === 'BUYER' ? t.seller : t.buyer;
  }

  private async nameOf(userId: string): Promise<string> {
    const [row] = await this.db.select({ name: users.name, shop: sellers.name }).from(users).leftJoin(sellers, eq(sellers.userId, users.id)).where(eq(users.id, userId)).limit(1);
    return row?.shop ?? firstName(row?.name, 'Someone');
  }

  /** Blocks the person behind a comment or the other person in a chat. Repeating it changes nothing. */
  async block(userId: string, side: Side, input: BlockInput): Promise<BlockedPerson> {
    const target = await this.personOf(userId, side, input);
    const ok = mayBlock({ blockerUserId: userId, targetUserId: target });
    if (!ok.ok) throw refused(ok);
    await this.db.insert(userBlocks).values({ blockerUserId: userId, blockedUserId: target, createdAt: new Date(this.clock.now()) }).onConflictDoNothing();
    const [row] = await this.db.select().from(userBlocks).where(and(eq(userBlocks.blockerUserId, userId), eq(userBlocks.blockedUserId, target))).limit(1);
    return { id: row!.id, name: await this.nameOf(target), since: row!.createdAt.getTime() };
  }

  async list(userId: string): Promise<BlockedList> {
    const rows = await this.db
      .select({ id: userBlocks.id, at: userBlocks.createdAt, name: users.name, shop: sellers.name })
      .from(userBlocks)
      .innerJoin(users, eq(users.id, userBlocks.blockedUserId))
      .leftJoin(sellers, eq(sellers.userId, users.id))
      .where(eq(userBlocks.blockerUserId, userId))
      .orderBy(desc(userBlocks.createdAt), desc(userBlocks.id));
    return { items: rows.map((r) => ({ id: r.id, name: r.shop ?? firstName(r.name, 'Someone'), since: r.at.getTime() })) };
  }

  /** Only your own blocks. Anyone else's id, or one already gone, changes nothing. */
  async unblock(userId: string, blockId: string): Promise<void> {
    await this.db.delete(userBlocks).where(and(eq(userBlocks.id, blockId), eq(userBlocks.blockerUserId, userId)));
  }
}
