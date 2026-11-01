import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationList, PushTokenInput, UnreadCount } from '@fayda/contracts';
import type { Clock } from '@fayda/domain';
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { DbService } from '../db/db.service.js';
import { notifications, pushTokens } from '../db/schema.js';
import { NegotiationEvents } from '../negotiations/negotiation-events.js';
import { SweepRunner, type SweepTask } from '../scheduler/sweep-runner.js';
import { PUSH_PROVIDER, type PushMessage, type PushProvider } from './push-provider.js';
import { renderNotification, targetOf } from './render.js';

type App = 'buyer' | 'seller';
const PAGE = 20;
const MAX_PAGE = 50;
const BATCH = 200;
/** A push that could not be handed over (a temporary failure) is tried again for this long, then dropped. */
const RETRY_WINDOW_MS = 120_000;
const MAX_TOKENS_PER_APP = 5;

const encode = (at: Date, id: string): string => Buffer.from(`${at.getTime()}:${id}`).toString('base64url');
function decode(cursor: string): { at: Date; id: string } {
  const [ms, id] = Buffer.from(cursor, 'base64url').toString().split(':');
  const at = new Date(Number(ms));
  if (!id || Number.isNaN(at.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) throw new AppError(400, 'VALIDATION', 'That page marker is not valid.');
  return { at, id };
}

/**
 * The notification centre and push. Notifications are written by the services that cause them (one row each, per person and
 * app). This service reads them for the person, marks them read, keeps the phone's push tokens, and, once a second, tells
 * the open apps (a `notification.created` event with the id only) and sends the push for rows not yet told.
 */
@Injectable()
export class NotificationsService implements SweepTask {
  readonly name = 'notifications';
  private readonly log = new Logger('Notifications');

  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NegotiationEvents) private readonly events: NegotiationEvents,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
    @Inject(SweepRunner) sweep: SweepRunner,
  ) {
    sweep.register(this);
  }

  private get db() {
    return this.database.db;
  }

  async unread(userId: string, app: App): Promise<UnreadCount> {
    const [r] = await this.db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.app, app), isNull(notifications.readAt)));
    return { unread: r?.n ?? 0 };
  }

  /** The person's notifications in this app, newest first. Only their own rows are ever read. */
  async list(userId: string, app: App, cursor?: string, limit = PAGE): Promise<NotificationList> {
    const take = Math.min(Math.max(limit, 1), MAX_PAGE);
    const after = cursor ? decode(cursor) : null;
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.app, app), after ? or(lt(notifications.createdAt, after.at), and(eq(notifications.createdAt, after.at), lt(notifications.id, after.id))) : undefined))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(take + 1);
    const page = rows.slice(0, take);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => ({ id: r.id, code: r.code, ...renderNotification(app, r.code, r.params), at: r.createdAt.getTime(), read: !!r.readAt, target: targetOf(r) })),
      nextCursor: rows.length > take && last ? encode(last.createdAt, last.id) : null,
      unread: (await this.unread(userId, app)).unread,
    };
  }

  /** Marks one read. Someone else's id, or none, is "not found". Repeating it changes nothing. */
  async markRead(userId: string, app: App, id: string): Promise<UnreadCount> {
    const [row] = await this.db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId), eq(notifications.app, app))).limit(1);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Notification not found.');
    await this.db.update(notifications).set({ readAt: new Date(this.clock.now()) }).where(and(eq(notifications.id, id), isNull(notifications.readAt)));
    return this.unread(userId, app);
  }

  async markAllRead(userId: string, app: App): Promise<UnreadCount> {
    await this.db.update(notifications).set({ readAt: new Date(this.clock.now()) }).where(and(eq(notifications.userId, userId), eq(notifications.app, app), isNull(notifications.readAt)));
    return { unread: 0 };
  }

  // ---------- push tokens ----------
  /** A phone's token belongs to whoever signed in last on that phone: the same token for another person moves to them. */
  async registerToken(userId: string, app: App, input: PushTokenInput): Promise<void> {
    const now = new Date(this.clock.now());
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`push:${userId}:${app}`}, 0))`);
      await tx
        .insert(pushTokens)
        .values({ userId, app, token: input.token, platform: input.platform, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({ target: [pushTokens.token, pushTokens.app], set: { userId, platform: input.platform, updatedAt: now } });
      const mine = await tx.select({ id: pushTokens.id }).from(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.app, app))).orderBy(desc(pushTokens.updatedAt));
      const extra = mine.slice(MAX_TOKENS_PER_APP).map((r) => r.id);
      if (extra.length) await tx.delete(pushTokens).where(inArray(pushTokens.id, extra));
    });
  }

  async removeToken(userId: string, app: App, token: string): Promise<void> {
    await this.db.delete(pushTokens).where(and(eq(pushTokens.userId, userId), eq(pushTokens.app, app), eq(pushTokens.token, token)));
  }

  // ---------- the sweep: tell the open apps, then push ----------
  async run(now: number): Promise<number> {
    const at = new Date(now);
    const claimed = await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(notifications)
        .where(isNull(notifications.pushedAt))
        .orderBy(notifications.createdAt)
        .limit(BATCH)
        .for('update', { skipLocked: true });
      if (rows.length) await tx.update(notifications).set({ pushedAt: at }).where(inArray(notifications.id, rows.map((r) => r.id)));
      return rows;
    });
    if (!claimed.length) return 0;

    // The open apps hear about it at once (ids only; they refetch).
    this.events.publish(claimed.map((r) => ({ name: 'notification.created', payload: { notificationId: r.id }, buyerUserId: r.app === 'buyer' ? r.userId : null, sellerUserId: r.app === 'seller' ? r.userId : null })));

    // Then the phones. Push text is the same text the notification centre shows.
    const pairs = [...new Set(claimed.map((r) => `${r.userId}|${r.app}`))];
    const tokens = await this.db
      .select()
      .from(pushTokens)
      .where(inArray(pushTokens.userId, [...new Set(claimed.map((r) => r.userId))]));
    const byPair = new Map<string, typeof tokens>();
    for (const t of tokens) {
      const k = `${t.userId}|${t.app}`;
      if (pairs.includes(k)) byPair.set(k, [...(byPair.get(k) ?? []), t]);
    }
    const msgs: { msg: PushMessage; tokenId: string; notificationId: string; createdAt: Date }[] = [];
    for (const r of claimed) {
      const target = targetOf(r);
      const text = renderNotification(r.app, r.code, r.params);
      for (const t of byPair.get(`${r.userId}|${r.app}`) ?? []) {
        msgs.push({
          msg: { to: t.token, title: text.title, body: text.body, data: { notificationId: r.id, app: r.app, ...(target ? { kind: target.kind, id: target.id } : {}) } },
          tokenId: t.id,
          notificationId: r.id,
          createdAt: r.createdAt,
        });
      }
    }
    if (!msgs.length) return claimed.length;
    const results = await this.push.send(msgs.map((m) => m.msg));
    const gone = msgs.filter((_, i) => results[i] === 'gone').map((m) => m.tokenId);
    if (gone.length) await this.db.delete(pushTokens).where(inArray(pushTokens.id, gone));
    // A temporary failure is tried again for a short while.
    const retry = [...new Set(msgs.filter((m, i) => results[i] === 'retry' && now - m.createdAt.getTime() < RETRY_WINDOW_MS).map((m) => m.notificationId))];
    if (retry.length) await this.db.update(notifications).set({ pushedAt: null }).where(inArray(notifications.id, retry));
    const failed = results.filter((r) => r === 'failed').length;
    if (failed) this.log.warn(`${failed} push message(s) were refused by the push service`);
    return claimed.length;
  }
}
