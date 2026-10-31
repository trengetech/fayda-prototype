import { Inject, Injectable } from '@nestjs/common';
import type { FollowState, FollowedShopList } from '@fayda/contracts';
import { mayFollow, type Clock } from '@fayda/domain';
import { and, count, desc, eq, lt, or, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { DbService } from '../db/db.service.js';
import { follows, sellers } from '../db/schema.js';

const PAGE = 30;
export const MAX_FOLLOW_PAGE = 100;

const encode = (at: Date, id: string): string => Buffer.from(`${at.getTime()}:${id}`).toString('base64url');
function decode(cursor: string): { at: Date; id: string } {
  const [ms, id] = Buffer.from(cursor, 'base64url').toString().split(':');
  const at = new Date(Number(ms));
  if (!id || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) throw new AppError(400, 'VALIDATION', 'That page marker is not valid.');
  return { at, id };
}

/**
 * Follows. A follow is a row in `follows` keyed by (follower, kind, target), so following and unfollowing are
 * naturally idempotent: repeating either call changes nothing and returns the same state. Only shops can be followed
 * today (`target_type = 'SELLER'`); the service is where a new kind would get its own existence check.
 */
@Injectable()
export class FollowsService {
  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async lockPerson(tx: { execute: (q: ReturnType<typeof sql>) => Promise<unknown> }, userId: string): Promise<void> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`follows:${userId}`}, 0))`);
  }

  async followerCount(sellerId: string): Promise<number> {
    // Joined to sellers so a follow of a shop that no longer exists (the target has no foreign key, I-23) is never counted.
    const [r] = await this.db.select({ n: count() }).from(follows).innerJoin(sellers, eq(sellers.id, follows.targetId)).where(and(eq(follows.targetType, 'SELLER'), eq(follows.targetId, sellerId)));
    return r?.n ?? 0;
  }

  async state(userId: string, sellerId: string): Promise<FollowState> {
    const [mine] = await this.db.select({ id: follows.id }).from(follows).where(and(eq(follows.followerUserId, userId), eq(follows.targetType, 'SELLER'), eq(follows.targetId, sellerId))).limit(1);
    return { following: !!mine, followerCount: await this.followerCount(sellerId) };
  }

  async follow(userId: string, sellerId: string): Promise<FollowState> {
    const [seller] = await this.db.select({ id: sellers.id, userId: sellers.userId }).from(sellers).where(eq(sellers.id, sellerId)).limit(1);
    if (!seller) throw new AppError(404, 'NOT_FOUND', 'Shop not found.');
    // Serialise one person's follows so two taps at once cannot both pass the cap check.
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`follows:${userId}`}, 0))`);
      const [already] = await tx.select({ id: follows.id }).from(follows).where(and(eq(follows.followerUserId, userId), eq(follows.targetType, 'SELLER'), eq(follows.targetId, sellerId))).limit(1);
      if (already) return;
      const [n] = await tx.select({ n: count() }).from(follows).where(and(eq(follows.followerUserId, userId), eq(follows.targetType, 'SELLER')));
      const ok = mayFollow({ followerUserId: userId, sellerUserId: seller.userId, currentCount: n?.n ?? 0 });
      if (!ok.ok) throw new AppError(ok.code === 'OWN_SHOP' ? 422 : 409, ok.code === 'OWN_SHOP' ? 'OWN_SHOP' : 'FOLLOW_LIMIT', ok.message);
      await tx.insert(follows).values({ followerUserId: userId, targetType: 'SELLER', targetId: sellerId, createdAt: new Date(this.clock.now()) }).onConflictDoNothing();
    });
    return this.state(userId, sellerId);
  }

  async unfollow(userId: string, sellerId: string): Promise<FollowState> {
    await this.db.transaction(async (tx) => {
      await this.lockPerson(tx, userId);
      await tx.delete(follows).where(and(eq(follows.followerUserId, userId), eq(follows.targetType, 'SELLER'), eq(follows.targetId, sellerId)));
    });
    return this.state(userId, sellerId);
  }

  /** The shops this person follows, newest follow first. */
  async list(userId: string, cursor?: string, limit = PAGE): Promise<FollowedShopList> {
    const take = Math.min(Math.max(limit, 1), MAX_FOLLOW_PAGE);
    const after = cursor ? decode(cursor) : null;
    const rows = await this.db
      .select({ id: sellers.id, name: sellers.name, handle: sellers.handle, area: sellers.area, city: sellers.city, at: follows.createdAt, followId: follows.id })
      .from(follows)
      .innerJoin(sellers, eq(sellers.id, follows.targetId))
      .where(and(eq(follows.followerUserId, userId), eq(follows.targetType, 'SELLER'), after ? or(lt(follows.createdAt, after.at), and(eq(follows.createdAt, after.at), lt(follows.id, after.id))) : undefined))
      .orderBy(desc(follows.createdAt), desc(follows.id))
      .limit(take + 1);
    const page = rows.slice(0, take);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({ id: r.id, name: r.name, handle: r.handle, area: r.area, city: r.city, followedAt: r.at.getTime() })),
      nextCursor: rows.length > take && last ? encode(last.at, last.followId) : null,
    };
  }
}
