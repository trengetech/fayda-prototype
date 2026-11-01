import { Inject, Injectable, Logger } from '@nestjs/common';
import { ALWAYS_ON_CATEGORIES, type NotificationCategory, type NotificationList, type NotificationSettingInput, type NotificationSettings, type PushTokenInput, type UnreadCount } from '@fayda/contracts';
import type { Clock } from '@fayda/domain';
import { and, count, desc, eq, inArray, isNotNull, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { DbService } from '../db/db.service.js';
import { notificationSettings, notifications, pushTickets, pushTokens } from '../db/schema.js';
import { NegotiationEvents } from '../negotiations/negotiation-events.js';
import { SweepRunner, type SweepTask } from '../scheduler/sweep-runner.js';
import { CATEGORIES, CATEGORY_CODES, CATEGORY_LABELS, categoryOf, isAlwaysOn } from './categories.js';
import { PUSH_PROVIDER, type PushMessage, type PushProvider } from './push-provider.js';
import { renderNotification, targetOf } from './render.js';

type App = 'buyer' | 'seller';
const PAGE = 20;
const MAX_PAGE = 50;
const BATCH = 200;
/** A push that could not be handed over (a temporary failure) is tried again for this long, then dropped. */
const RETRY_WINDOW_MS = 120_000;
const MAX_TOKENS_PER_APP = 5;
/** Expo makes receipts a few minutes after accepting a push and keeps them a day. Ask after the delay, give up after the day. */
export const RECEIPT_DELAY_MS = 10 * 60_000;
export const RECEIPT_MAX_AGE_MS = 24 * 3_600_000;
/** How often the sweep looks for receipts to read (it ticks every second; this is far cheaper). */
const RECEIPT_CHECK_EVERY_MS = 30_000;
const RECEIPT_BATCH = 1000;
/** Housekeeping: read notifications are deleted after 90 days, unread ones after 180. Checked hourly, at most PRUNE_BATCH rows a time. */
export const READ_RETENTION_MS = 90 * 24 * 3_600_000;
export const UNREAD_RETENTION_MS = 180 * 24 * 3_600_000;
const PRUNE_EVERY_MS = 3_600_000;
const PRUNE_BATCH = 1000;

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
  private lastReceiptCheck = 0;
  private lastPrune = 0;

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

  /** The codes this person has switched off, for the centre (`inApp`) or for push. Orders can never be among them. */
  private async mutedCodes(userId: string, app: App, flag: 'inApp' | 'push'): Promise<string[]> {
    const rows = await this.db.select().from(notificationSettings).where(and(eq(notificationSettings.userId, userId), eq(notificationSettings.app, app)));
    return rows.filter((r) => !r[flag] && !isAlwaysOn(r.category as NotificationCategory)).flatMap((r) => CATEGORY_CODES[r.category as NotificationCategory] ?? []);
  }

  async unread(userId: string, app: App): Promise<UnreadCount> {
    const muted = await this.mutedCodes(userId, app, 'inApp');
    const [r] = await this.db.select({ n: count() }).from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.app, app), isNull(notifications.readAt), muted.length ? notInArray(notifications.code, muted) : undefined));
    return { unread: r?.n ?? 0 };
  }

  /** The person's notifications in this app, newest first. Only their own rows are ever read. */
  async list(userId: string, app: App, cursor?: string, limit = PAGE): Promise<NotificationList> {
    const take = Math.min(Math.max(limit, 1), MAX_PAGE);
    const after = cursor ? decode(cursor) : null;
    const muted = await this.mutedCodes(userId, app, 'inApp');
    const rows = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.app, app), muted.length ? notInArray(notifications.code, muted) : undefined, after ? or(lt(notifications.createdAt, after.at), and(eq(notifications.createdAt, after.at), lt(notifications.id, after.id))) : undefined))
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
    const muted = await this.mutedCodes(userId, app, 'inApp');
    await this.db.update(notifications).set({ readAt: new Date(this.clock.now()) }).where(and(eq(notifications.userId, userId), eq(notifications.app, app), isNull(notifications.readAt), muted.length ? notInArray(notifications.code, muted) : undefined));
    return { unread: 0 };
  }

  /** Deletes one of the person's own notifications. Someone else's id, or none, is "not found". */
  async remove(userId: string, app: App, id: string): Promise<UnreadCount> {
    const gone = await this.db.delete(notifications).where(and(eq(notifications.id, id), eq(notifications.userId, userId), eq(notifications.app, app))).returning({ id: notifications.id });
    if (!gone.length) throw new AppError(404, 'NOT_FOUND', 'Notification not found.');
    return this.unread(userId, app);
  }

  /** Clears the person's centre in this app: every notification they can see. Ones hidden by a switched-off kind stay. */
  async removeAll(userId: string, app: App): Promise<UnreadCount> {
    const muted = await this.mutedCodes(userId, app, 'inApp');
    await this.db.delete(notifications).where(and(eq(notifications.userId, userId), eq(notifications.app, app), muted.length ? notInArray(notifications.code, muted) : undefined));
    return this.unread(userId, app);
  }

  // ---------- settings ----------
  async settings(userId: string, app: App): Promise<NotificationSettings> {
    const rows = await this.db.select().from(notificationSettings).where(and(eq(notificationSettings.userId, userId), eq(notificationSettings.app, app)));
    const by = new Map(rows.map((r) => [r.category, r]));
    return { items: CATEGORIES.map((category) => ({ category, label: CATEGORY_LABELS[category], push: by.get(category)?.push ?? true, inApp: by.get(category)?.inApp ?? true, alwaysOn: isAlwaysOn(category) })) };
  }

  async setSetting(userId: string, app: App, category: NotificationCategory, input: NotificationSettingInput): Promise<NotificationSettings> {
    if (ALWAYS_ON_CATEGORIES.includes(category) && !(input.push && input.inApp)) throw new AppError(400, 'ALWAYS_ON', 'Order notifications cannot be switched off.');
    const now = new Date(this.clock.now());
    await this.db
      .insert(notificationSettings)
      .values({ userId, app, category, push: input.push, inApp: input.inApp, updatedAt: now })
      .onConflictDoUpdate({ target: [notificationSettings.userId, notificationSettings.app, notificationSettings.category], set: { push: input.push, inApp: input.inApp, updatedAt: now } });
    return this.settings(userId, app);
  }

  // ---------- housekeeping ----------
  /** Deletes old notifications: read ones after 90 days, unread after 180 (by when they were created). Hourly, in small batches. */
  async prune(now: number): Promise<number> {
    if (now - this.lastPrune < PRUNE_EVERY_MS) return 0;
    this.lastPrune = now;
    const old = or(and(isNotNull(notifications.readAt), lt(notifications.createdAt, new Date(now - READ_RETENTION_MS))), lt(notifications.createdAt, new Date(now - UNREAD_RETENTION_MS)));
    const rows = await this.db.select({ id: notifications.id }).from(notifications).where(old).limit(PRUNE_BATCH);
    if (!rows.length) return 0;
    const gone = await this.db.delete(notifications).where(and(inArray(notifications.id, rows.map((r) => r.id)), old)).returning({ id: notifications.id });
    if (rows.length === PRUNE_BATCH) this.lastPrune = 0; // more may be waiting: do not wait an hour
    return gone.length;
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

  // ---------- receipts: find phones that are gone ----------
  /**
   * Reads the receipts of pushes accepted RECEIPT_DELAY ago or more. An answered ticket is deleted; if its receipt says the phone is
   * not registered, that token is deleted too (for whoever holds it: the phone is gone). A receipt not made yet is asked again
   * later; one still missing after a day is dropped. Runs at most every 30 seconds, and is safe on two servers at once.
   */
  async readReceipts(now: number): Promise<number> {
    if (this.push.simulated || now - this.lastReceiptCheck < RECEIPT_CHECK_EVERY_MS) return 0;
    this.lastReceiptCheck = now;
    return this.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(pushTickets)
        .where(lt(pushTickets.createdAt, new Date(now - RECEIPT_DELAY_MS)))
        .orderBy(pushTickets.createdAt)
        .limit(RECEIPT_BATCH)
        .for('update', { skipLocked: true });
      if (!due.length) return 0;
      const answers = await this.push.receipts(due.map((t) => t.ticketId));
      const expired = (t: (typeof due)[number]) => now - t.createdAt.getTime() > RECEIPT_MAX_AGE_MS;
      const answered = due.filter((t) => (answers.get(t.ticketId) ?? 'pending') !== 'pending' || expired(t));
      const deadTokens = [...new Set(due.filter((t) => answers.get(t.ticketId) === 'gone').map((t) => t.token))];
      if (deadTokens.length) await tx.delete(pushTokens).where(inArray(pushTokens.token, deadTokens));
      if (answered.length) await tx.delete(pushTickets).where(inArray(pushTickets.id, answered.map((t) => t.id)));
      const failed = due.filter((t) => answers.get(t.ticketId) === 'failed').length;
      if (failed) this.log.warn(`${failed} push receipt(s) reported a delivery error`);
      return deadTokens.length;
    });
  }

  // ---------- the sweep: tell the open apps, then push ----------
  async run(now: number): Promise<number> {
    const at = new Date(now);
    await this.readReceipts(now);
    await this.prune(now);
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

    // Each person's switches: a kind switched off for the centre is not announced to the open app; off for push sends no push.
    const prefs = await this.db.select().from(notificationSettings).where(inArray(notificationSettings.userId, [...new Set(claimed.map((r) => r.userId))]));
    const off = (r: (typeof claimed)[number], flag: 'inApp' | 'push'): boolean => {
      const c = categoryOf(r.code);
      return !isAlwaysOn(c) && prefs.some((p) => p.userId === r.userId && p.app === r.app && p.category === c && !p[flag]);
    };

    // The open apps hear about it at once (ids only; they refetch).
    this.events.publish(claimed.filter((r) => !off(r, 'inApp')).map((r) => ({ name: 'notification.created', payload: { notificationId: r.id }, buyerUserId: r.app === 'buyer' ? r.userId : null, sellerUserId: r.app === 'seller' ? r.userId : null })));

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
    for (const r of claimed.filter((x) => !off(x, 'push'))) {
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
    const outcomes = await this.push.send(msgs.map((m) => m.msg));
    const results = outcomes.map((o) => o.result);
    const gone = msgs.filter((_, i) => results[i] === 'gone').map((m) => m.tokenId);
    if (gone.length) await this.db.delete(pushTokens).where(inArray(pushTokens.id, gone));
    // Remember the accepted pushes: their receipts, a few minutes from now, tell us about phones that are gone.
    const tickets = msgs.flatMap((m, i) => (outcomes[i]?.ticketId ? [{ ticketId: outcomes[i]!.ticketId!, token: m.msg.to, createdAt: at }] : []));
    if (tickets.length) await this.db.insert(pushTickets).values(tickets).onConflictDoNothing();
    // A temporary failure is tried again for a short while.
    const retry = [...new Set(msgs.filter((m, i) => results[i] === 'retry' && now - m.createdAt.getTime() < RETRY_WINDOW_MS).map((m) => m.notificationId))];
    if (retry.length) await this.db.update(notifications).set({ pushedAt: null }).where(inArray(notifications.id, retry));
    const failed = results.filter((r) => r === 'failed').length;
    if (failed) this.log.warn(`${failed} push message(s) were refused by the push service`);
    return claimed.length;
  }
}
