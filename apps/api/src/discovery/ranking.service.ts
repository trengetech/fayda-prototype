import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ImpressionsBody } from '@fayda/contracts';
import { rankScore, type Clock } from '@fayda/domain';
import { and, count, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import { CLOCK } from '../common/clock.js';
import { loadSellerStats } from '../community/shared.js';
import { DbService } from '../db/db.service.js';
import { feedImpressions, likes, listingRankScores, listingVariants, listingViews, listings, sellers } from '../db/schema.js';
import { SweepRunner, type SweepTask } from '../scheduler/sweep-runner.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** The stored For You scores are refreshed this often (DECISIONS I-39). Listings read in between keep the previous score. */
export const RANK_REFRESH_MS = 5 * 60_000;
const BATCH = 200;
const VIEW_WINDOW_MS = 30 * DAY_MS;
/** A score generation is kept this long, so a person scrolling for half an hour keeps one consistent order. */
export const GENERATION_KEEP_MS = 30 * 60_000;
/** Impressions are kept 90 days, pruned hourly; one buyer can report at most this many an hour (a runaway app, not a real person). */
export const IMPRESSION_RETENTION_MS = 90 * DAY_MS;
export const MAX_IMPRESSIONS_PER_HOUR = 1000;
const PRUNE_EVERY_MS = HOUR_MS;
const PRUNE_BATCH = 5000;

/**
 * Keeps each live listing's For You score fresh and records what the feed showed (I-39). The score itself is the pure
 * `rankScore` in the domain package; this class only gathers its inputs and stores the result.
 */
@Injectable()
export class RankingService implements SweepTask {
  readonly name = 'ranking';
  private readonly log = new Logger('Ranking');
  private lastRefresh = 0;
  private lastPrune = 0;

  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(SweepRunner) sweep: SweepRunner,
  ) {
    sweep.register(this);
  }

  private get db() {
    return this.database.db;
  }

  async run(now: number): Promise<number> {
    let changed = 0;
    if (now - this.lastRefresh >= RANK_REFRESH_MS) {
      this.lastRefresh = now;
      changed += await this.refreshScores(now);
    }
    if (now - this.lastPrune >= PRUNE_EVERY_MS) {
      this.lastPrune = now;
      changed += await this.pruneImpressions(now);
    }
    return changed;
  }

  /**
   * Recomputes every live listing's score and stores it as a new generation (the time in whole seconds), 200 listings at a time,
   * then deletes generations older than GENERATION_KEEP_MS. Returns how many listings were scored. Two instances refreshing in
   * the same second write the same rows (the insert ignores a row that exists), so that is safe.
   */
  async refreshScores(now: number = this.clock.now()): Promise<number> {
    const generation = Math.floor(now / 1000);
    let scored = 0;
    let after = '00000000-0000-0000-0000-000000000000';
    const since = new Date(now - VIEW_WINDOW_MS);
    for (;;) {
      const batch = await this.db
        .select({ id: listings.id, sellerId: listings.sellerId, publishedAt: listings.publishedAt, sellerCreatedAt: sellers.createdAt })
        .from(listings)
        .innerJoin(sellers, eq(sellers.id, listings.sellerId))
        .where(and(eq(listings.status, 'ACTIVE'), gt(listings.id, after)))
        .orderBy(listings.id)
        .limit(BATCH);
      if (!batch.length) break;
      after = batch[batch.length - 1]!.id;
      const ids = batch.map((b) => b.id);
      const sellerIds = [...new Set(batch.map((b) => b.sellerId))];
      const [likeRows, viewRows, stockRows, stats] = await Promise.all([
        this.db.select({ id: likes.targetId, n: count() }).from(likes).where(and(eq(likes.targetType, 'LISTING'), inArray(likes.targetId, ids))).groupBy(likes.targetId),
        this.db.select({ id: listingViews.listingId, n: count() }).from(listingViews).where(and(inArray(listingViews.listingId, ids), gte(listingViews.createdAt, since))).groupBy(listingViews.listingId),
        this.db.select({ id: listingVariants.listingId, n: sql<number>`coalesce(sum(${listingVariants.stock}), 0)::int` }).from(listingVariants).where(inArray(listingVariants.listingId, ids)).groupBy(listingVariants.listingId),
        loadSellerStats(this.db, sellerIds),
      ]);
      const likeBy = new Map(likeRows.map((r) => [r.id, r.n]));
      const viewBy = new Map(viewRows.map((r) => [r.id, r.n]));
      const stockBy = new Map(stockRows.map((r) => [r.id, r.n]));
      const rows = batch.map((l) => {
        const st = stats.get(l.sellerId);
        const score = rankScore({
          ageHours: Math.max(0, (now - (l.publishedAt?.getTime() ?? now)) / HOUR_MS),
          likes: likeBy.get(l.id) ?? 0,
          views30d: viewBy.get(l.id) ?? 0,
          stockUnits: stockBy.get(l.id) ?? 0,
          sellerAgeDays: Math.max(0, (now - l.sellerCreatedAt.getTime()) / DAY_MS),
          sellerOrders: st?.orders ?? 0,
          sellerCompleted: st?.completed ?? 0,
          sellerMedianConfirmHours: st?.medianConfirmMs != null ? st.medianConfirmMs / HOUR_MS : null,
        });
        return { generation, listingId: l.id, score };
      });
      await this.db.insert(listingRankScores).values(rows).onConflictDoNothing();
      scored += rows.length;
    }
    await this.db.delete(listingRankScores).where(sql`${listingRankScores.generation} < ${generation - Math.floor(GENERATION_KEEP_MS / 1000)}`);
    return scored;
  }

  /** Stores what the feed showed. Listings that are not live are skipped; a buyer over the hourly cap is quietly ignored. */
  async recordImpressions(userId: string, body: ImpressionsBody): Promise<void> {
    const now = new Date(this.clock.now());
    const [{ n } = { n: 0 }] = await this.db.select({ n: count() }).from(feedImpressions).where(and(eq(feedImpressions.userId, userId), gte(feedImpressions.createdAt, new Date(now.getTime() - HOUR_MS))));
    const room = MAX_IMPRESSIONS_PER_HOUR - n;
    if (room <= 0) return;
    const ids = [...new Set(body.items.map((i) => i.listingId))];
    const live = new Set((await this.db.select({ id: listings.id }).from(listings).where(and(eq(listings.status, 'ACTIVE'), inArray(listings.id, ids)))).map((r) => r.id));
    const rows = body.items
      .filter((i) => live.has(i.listingId))
      .slice(0, room)
      .map((i) => ({ userId, listingId: i.listingId, position: i.position, scope: body.scope, ranker: body.ranker, createdAt: now }));
    if (rows.length) await this.db.insert(feedImpressions).values(rows);
  }

  private async pruneImpressions(now: number): Promise<number> {
    const cutoff = new Date(now - IMPRESSION_RETENTION_MS);
    const old = await this.db.select({ id: feedImpressions.id }).from(feedImpressions).where(sql`${feedImpressions.createdAt} < ${cutoff.toISOString()}::timestamptz`).limit(PRUNE_BATCH);
    if (!old.length) return 0;
    await this.db.delete(feedImpressions).where(inArray(feedImpressions.id, old.map((o) => o.id)));
    this.log.log(`pruned ${old.length} impressions`);
    return old.length;
  }
}
