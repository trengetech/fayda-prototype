import { Inject, Injectable } from '@nestjs/common';
import type { BuyerFeed, Comment, CommentList, LikeState, SaveState, PostComment } from '@fayda/contracts';
import { mayComment, mayCommentOn, mayLike, maySave, removalBy, validateComment, type Clock } from '@fayda/domain';
import { and, count, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { firstName } from '../community/shared.js';
import { DbService } from '../db/db.service.js';
import { comments, likes, listings, notifications, saves, sellers, userBlocks, users } from '../db/schema.js';
import { blockedBy } from '../safety/blocks.js';
import { ListingsService } from '../listings/listings.service.js';
import { NegotiationEvents } from '../negotiations/negotiation-events.js';

const PAGE = 20;
const MAX_PAGE = 50;
const HOUR = 3_600_000;

type Refusal = { code: string; message: string };
/** Domain refusals as HTTP answers. */
function refused(r: Refusal): AppError {
  const status = r.code === 'OWN_LISTING' ? 422 : r.code === 'RATE_LIMITED' ? 429 : 409;
  return new AppError(status, r.code as never, r.message);
}

const encode = (at: Date, id: string): string => Buffer.from(`${at.getTime()}:${id}`).toString('base64url');
function decode(cursor: string): { at: Date; id: string } {
  const [ms, id] = Buffer.from(cursor, 'base64url').toString().split(':');
  const at = new Date(Number(ms));
  if (!id || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) throw new AppError(400, 'VALIDATION', 'That page marker is not valid.');
  return { at, id };
}

/**
 * Likes, saves and comments. Likes and saves are rows keyed by (person, kind, thing), so liking twice or unliking twice
 * changes nothing and both calls return the real state. A comment is public text on a live listing; it is hidden, never
 * erased, when its author or the listing's owner removes it.
 */
@Injectable()
export class SocialService {
  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NegotiationEvents) private readonly events: NegotiationEvents,
    @Inject(ListingsService) private readonly listingsService: ListingsService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** A listing that exists and is not a draft, with who owns it. A draft is invisible to everyone but its owner, and the owner has no social side to it. */
  private async listing(id: string) {
    const [l] = await this.db.select({ id: listings.id, status: listings.status, title: listings.title, ownerUserId: sellers.userId }).from(listings).innerJoin(sellers, eq(sellers.id, listings.sellerId)).where(eq(listings.id, id)).limit(1);
    if (!l || l.status === 'DRAFT') throw new AppError(404, 'NOT_FOUND', 'Listing not found.');
    return l;
  }

  private async likeState(userId: string, listingId: string): Promise<LikeState> {
    const [[total], [mine]] = await Promise.all([
      this.db.select({ n: count() }).from(likes).where(and(eq(likes.targetType, 'LISTING'), eq(likes.targetId, listingId))),
      this.db.select({ id: likes.id }).from(likes).where(and(eq(likes.userId, userId), eq(likes.targetType, 'LISTING'), eq(likes.targetId, listingId))).limit(1),
    ]);
    return { liked: !!mine, likeCount: total?.n ?? 0 };
  }

  async like(userId: string, listingId: string): Promise<LikeState> {
    const l = await this.listing(listingId);
    const ok = mayLike({ actorUserId: userId, listingOwnerUserId: l.ownerUserId, listingStatus: l.status });
    if (!ok.ok) throw refused(ok);
    await this.db.insert(likes).values({ userId, targetType: 'LISTING', targetId: listingId, createdAt: new Date(this.clock.now()) }).onConflictDoNothing();
    return this.likeState(userId, listingId);
  }

  /** Always allowed: a person can take a like back even if the listing is paused or sold. */
  async unlike(userId: string, listingId: string): Promise<LikeState> {
    await this.db.delete(likes).where(and(eq(likes.userId, userId), eq(likes.targetType, 'LISTING'), eq(likes.targetId, listingId)));
    return this.likeState(userId, listingId);
  }

  async save(userId: string, listingId: string): Promise<SaveState> {
    const l = await this.listing(listingId);
    await this.db.transaction(async (tx) => {
      // One person's saves are handled one at a time, so two taps at once cannot both pass the limit.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`saves:${userId}`}, 0))`);
      const [already] = await tx.select({ id: saves.id }).from(saves).where(and(eq(saves.userId, userId), eq(saves.targetType, 'LISTING'), eq(saves.targetId, listingId))).limit(1);
      if (already) return;
      const [n] = await tx.select({ n: count() }).from(saves).where(and(eq(saves.userId, userId), eq(saves.targetType, 'LISTING')));
      const ok = maySave({ actorUserId: userId, listingOwnerUserId: l.ownerUserId, listingStatus: l.status, currentCount: n?.n ?? 0 });
      if (!ok.ok) throw refused(ok);
      await tx.insert(saves).values({ userId, targetType: 'LISTING', targetId: listingId, createdAt: new Date(this.clock.now()) }).onConflictDoNothing();
    });
    return { saved: true };
  }

  async unsave(userId: string, listingId: string): Promise<SaveState> {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`saves:${userId}`}, 0))`);
      await tx.delete(saves).where(and(eq(saves.userId, userId), eq(saves.targetType, 'LISTING'), eq(saves.targetId, listingId)));
    });
    return { saved: false };
  }

  /** What this person saved, newest save first. Listings that are no longer live are left out. */
  async listSaved(userId: string, cursor?: string, limit = PAGE): Promise<BuyerFeed> {
    const take = Math.min(Math.max(limit, 1), MAX_PAGE);
    const after = cursor ? decode(cursor) : null;
    const rows = await this.db
      .select({ listingId: saves.targetId, at: saves.createdAt, id: saves.id })
      .from(saves)
      .innerJoin(listings, and(eq(listings.id, saves.targetId), eq(listings.status, 'ACTIVE'))) // the page is made of live listings only, so a page is never empty while more exist
      .where(and(eq(saves.userId, userId), eq(saves.targetType, 'LISTING'), after ? or(lt(saves.createdAt, after.at), and(eq(saves.createdAt, after.at), lt(saves.id, after.id))) : undefined))
      .orderBy(desc(saves.createdAt), desc(saves.id))
      .limit(take + 1);
    const page = rows.slice(0, take);
    const last = page[page.length - 1];
    return { items: await this.listingsService.cardsFor(userId, page.map((r) => r.listingId)), nextCursor: rows.length > take && last ? encode(last.at, last.id) : null };
  }

  // ---------- comments ----------
  /**
   * Comments on a listing, newest first. Buyers see them on live listings; the owner sees them on any listing that is not a draft.
   * `viewerIsOwner` decides which of those it is, so a buyer cannot read a paused listing's comments by id.
   */
  async comments(userId: string, listingId: string, viewerIsOwner: boolean, cursor?: string, limit = PAGE): Promise<CommentList> {
    const l = await this.listing(listingId);
    if (viewerIsOwner ? l.ownerUserId !== userId : l.status !== 'ACTIVE') throw new AppError(404, 'NOT_FOUND', 'Listing not found.');
    const take = Math.min(Math.max(limit, 1), MAX_PAGE);
    const after = cursor ? decode(cursor) : null;
    // A person's blocked people never show up for them (I-31), in the page or in the total.
    const where = and(eq(comments.listingId, listingId), isNull(comments.removedAt), sql`not exists (select 1 from ${userBlocks} where ${userBlocks.blockerUserId} = ${userId} and ${userBlocks.blockedUserId} = ${comments.authorUserId})`);
    const [rows, [total]] = await Promise.all([
      this.db
        .select({ id: comments.id, text: comments.text, at: comments.createdAt, authorUserId: comments.authorUserId, authorName: users.name })
        .from(comments)
        .innerJoin(users, eq(users.id, comments.authorUserId))
        .where(and(where, after ? or(lt(comments.createdAt, after.at), and(eq(comments.createdAt, after.at), lt(comments.id, after.id))) : undefined))
        .orderBy(desc(comments.createdAt), desc(comments.id))
        .limit(take + 1),
      this.db.select({ n: count() }).from(comments).where(where),
    ]);
    const shopName = viewerIsOwner || rows.some((r) => r.authorUserId === l.ownerUserId) ? (await this.shopName(l.ownerUserId)) : '';
    const page = rows.slice(0, take);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.view(r, userId, l.ownerUserId, shopName)),
      nextCursor: rows.length > take && last ? encode(last.at, last.id) : null,
      total: total?.n ?? 0,
    };
  }

  private async shopName(ownerUserId: string): Promise<string> {
    const [s] = await this.db.select({ name: sellers.name }).from(sellers).where(eq(sellers.userId, ownerUserId)).limit(1);
    return s?.name ?? '';
  }

  private view(r: { id: string; text: string; at: Date; authorUserId: string; authorName: string | null }, viewerUserId: string, ownerUserId: string, shopName: string): Comment {
    const shop = r.authorUserId === ownerUserId;
    return {
      id: r.id,
      text: r.text,
      at: r.at.getTime(),
      author: { name: shop ? shopName : firstName(r.authorName), shop },
      mine: r.authorUserId === viewerUserId,
      canRemove: removalBy({ actorUserId: viewerUserId, authorUserId: r.authorUserId, listingOwnerUserId: ownerUserId }) !== null,
    };
  }

  /**
   * Posts a comment. The owner may post on their own listing (a reply, shown as the shop); a buyer on a live one. A retried
   * post with the same `clientKey` returns the comment already made. The owner is told about someone else's comment.
   */
  async post(userId: string, listingId: string, input: PostComment, asOwner: boolean): Promise<Comment> {
    const l = await this.listing(listingId);
    if (asOwner && l.ownerUserId !== userId) throw new AppError(404, 'NOT_FOUND', 'Listing not found.');
    // A shop that blocked someone stops them commenting on its listings (I-31). Buyers' blocks never stop anyone posting.
    const allowed = mayCommentOn({ commenterUserId: userId, listingOwnerUserId: l.ownerUserId, ownerBlocked: await blockedBy(this.db, l.ownerUserId) });
    if (!allowed.ok) throw new AppError(403, 'BLOCKED', allowed.message);
    const checked = validateComment(input.text);
    if (!checked.ok) throw new AppError(400, 'VALIDATION', 'Check the comment.', { text: checked.message });
    const now = new Date(this.clock.now());

    // A client key belongs to one comment. The same key again on the same listing is a retry and gets the first answer;
    // on another listing it is a mistake in the caller and is refused, never answered with a different listing's comment.
    const byKey = async (): Promise<Comment | null> => {
      if (!input.clientKey) return null;
      const [dup] = await this.db
        .select({ id: comments.id, text: comments.text, at: comments.createdAt, authorUserId: comments.authorUserId, authorName: users.name, listingId: comments.listingId })
        .from(comments)
        .innerJoin(users, eq(users.id, comments.authorUserId))
        .where(and(eq(comments.authorUserId, userId), eq(comments.clientKey, input.clientKey)))
        .limit(1);
      if (!dup) return null;
      if (dup.listingId !== listingId) throw new AppError(409, 'INVALID_STATE', 'That comment key was already used on another listing.');
      return this.view(dup, userId, l.ownerUserId, await this.shopName(l.ownerUserId));
    };
    const earlier = await byKey();
    if (earlier) return earlier;

    const row = await this.db.transaction(async (tx) => {
      // One person's comments are handled one at a time, so a burst of parallel posts cannot all pass the hourly limit.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`comments:${userId}`}, 0))`);
      const [recent] = await tx.select({ n: count() }).from(comments).where(and(eq(comments.authorUserId, userId), gt(comments.createdAt, new Date(now.getTime() - HOUR))));
      const ok = mayComment({ listingStatus: l.status, commentsInLastHour: recent?.n ?? 0, asOwner });
      if (!ok.ok) throw refused(ok);
      const [r] = await tx.insert(comments).values({ listingId, authorUserId: userId, text: checked.text, clientKey: input.clientKey ?? null, createdAt: now }).onConflictDoNothing().returning({ id: comments.id });
      return r ?? null;
    });
    if (!row) {
      // Lost a race with the same key from the same person: the other request made it.
      const lost = await byKey();
      if (!lost) throw new AppError(409, 'INVALID_STATE', 'Could not post that comment. Try again.');
      return lost;
    }
    if (userId !== l.ownerUserId) {
      await this.db.insert(notifications).values({ userId: l.ownerUserId, app: 'seller', code: 'NEW_COMMENT', listingId, params: { title: l.title, snippet: [...checked.text].slice(0, 80).join('') }, createdAt: now });
      this.events.publish([{ name: 'comment.created', payload: { listingId, commentId: row.id }, sellerUserId: l.ownerUserId }]);
    }
    const [self] = await this.db.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    return this.view({ id: row.id, text: checked.text, at: now, authorUserId: userId, authorName: self?.name ?? null }, userId, l.ownerUserId, await this.shopName(l.ownerUserId));
  }

  /** Hides a comment. The author may, and so may the owner of the listing it is on; anyone else sees "not found". */
  async remove(userId: string, commentId: string): Promise<void> {
    const [c] = await this.db.select({ id: comments.id, authorUserId: comments.authorUserId, removedAt: comments.removedAt, ownerUserId: sellers.userId }).from(comments).innerJoin(listings, eq(listings.id, comments.listingId)).innerJoin(sellers, eq(sellers.id, listings.sellerId)).where(eq(comments.id, commentId)).limit(1);
    const by = c ? removalBy({ actorUserId: userId, authorUserId: c.authorUserId, listingOwnerUserId: c.ownerUserId }) : null;
    if (!c || !by) throw new AppError(404, 'NOT_FOUND', 'Comment not found.');
    if (c.removedAt) return;
    await this.db.update(comments).set({ removedAt: new Date(this.clock.now()), removedBy: by }).where(and(eq(comments.id, commentId), isNull(comments.removedAt)));
  }
}
