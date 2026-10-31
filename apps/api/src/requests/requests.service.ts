import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { BuyerRequest, BuyerRequestList, CreateRequest, Respond, SellerRequest, SellerRequestList } from '@fayda/contracts';
import { answerResponse, closeRequest, isRequestDue, requestExpiry, sellersReached, validateRequest, validateResponse, type Clock, type ResponseStatus } from '@fayda/domain';
import { and, desc, eq, inArray, lte, ne, or, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { ChatService } from '../chat/chat.service.js';
import { checkOwnedMedia, firstName, mediaRefs, sellerRatings, sellerRow, type Q } from '../community/shared.js';
import { DbService } from '../db/db.service.js';
import { buyerProfiles, buyerRequests, notifications, requestMedia, requestResponses, responseMedia, sellers, users } from '../db/schema.js';
import { NegotiationEvents, type RealtimeEvent } from '../negotiations/negotiation-events.js';
import { throwFail } from '../negotiations/negotiations.service.js';
import { SweepRunner, type SweepTask } from '../scheduler/sweep-runner.js';

type RequestRow = typeof buyerRequests.$inferSelect;
type ResponseRow = typeof requestResponses.$inferSelect;

const SWEEP_BATCH = 100;
/** Sellers listed in one inbox page. */
const SELLER_LIST_LIMIT = 100;

/**
 * Buyer requests ("can't find it? ask sellers"): a buyer posts a photo and a need, sellers in that category answer with a
 * photo, the buyer says "I want this" (which opens a chat) or "Not for me". Open requests expire after 7 days.
 */
@Injectable()
export class RequestsService implements SweepTask {
  readonly name = 'requests';

  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NegotiationEvents) private readonly events: NegotiationEvents,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(SweepRunner) sweep: SweepRunner,
  ) {
    sweep.register(this);
  }

  private get db() {
    return this.database.db;
  }

  // ---------- expiry (sweep plus lazy check on read) ----------
  /** Expires due OPEN requests, oldest first. A second instance skips rows the first has locked. */
  async run(now: number): Promise<number> {
    return this.expireWhere(now, undefined);
  }

  private async expireWhere(now: number, ids: string[] | undefined): Promise<number> {
    const evs: RealtimeEvent[] = [];
    const n = await this.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(buyerRequests)
        .where(and(eq(buyerRequests.status, 'OPEN'), lte(buyerRequests.expiresAt, new Date(now)), ids ? inArray(buyerRequests.id, ids) : undefined))
        .orderBy(buyerRequests.expiresAt)
        .limit(SWEEP_BATCH)
        .for('update', { skipLocked: true });
      for (const r of due) {
        if (!isRequestDue({ status: r.status, expiresAt: r.expiresAt.getTime() }, now)) continue;
        await tx.update(buyerRequests).set({ status: 'EXPIRED' }).where(eq(buyerRequests.id, r.id));
        await tx.insert(notifications).values({ userId: r.buyerUserId, app: 'buyer', code: 'REQUEST_EXPIRED', requestId: r.id, createdAt: new Date(now) });
        evs.push({ name: 'request.updated', payload: { requestId: r.id }, buyerUserId: r.buyerUserId });
      }
      return due.length;
    });
    this.events.publish(evs);
    return n;
  }

  // ---------- shared reads ----------
  private async requestMediaOf(q: Q, ids: string[]) {
    const out = new Map<string, Awaited<ReturnType<typeof mediaRefs>> extends Map<string, infer V> ? V[] : never>();
    if (!ids.length) return out;
    const links = await q.select().from(requestMedia).where(inArray(requestMedia.requestId, ids)).orderBy(requestMedia.requestId, requestMedia.position);
    const refs = await mediaRefs(q, links.map((l) => l.mediaId));
    for (const l of links) {
      const r = refs.get(l.mediaId);
      if (r) out.set(l.requestId, [...(out.get(l.requestId) ?? []), r]);
    }
    return out;
  }

  private async responseMediaOf(q: Q, ids: string[]) {
    const out = new Map<string, Awaited<ReturnType<typeof mediaRefs>> extends Map<string, infer V> ? V[] : never>();
    if (!ids.length) return out;
    const links = await q.select().from(responseMedia).where(inArray(responseMedia.responseId, ids)).orderBy(responseMedia.responseId, responseMedia.position);
    const refs = await mediaRefs(q, links.map((l) => l.mediaId));
    for (const l of links) {
      const r = refs.get(l.mediaId);
      if (r) out.set(l.responseId, [...(out.get(l.responseId) ?? []), r]);
    }
    return out;
  }

  // ---------- buyer ----------
  /** How many sellers a request in this category would reach (the "Send to N sellers" button). The buyer's own shop is excluded. */
  async reach(userId: string, category: string): Promise<{ count: number }> {
    const all = await this.db.select({ userId: sellers.userId, categories: sellers.categories }).from(sellers).where(sql`${category} = any(${sellers.categories})`);
    return { count: sellersReached(all, category, userId).length };
  }

  async create(userId: string, input: CreateRequest): Promise<BuyerRequest> {
    const [profile] = await this.db.select({ id: buyerProfiles.userId }).from(buyerProfiles).where(eq(buyerProfiles.userId, userId)).limit(1);
    if (!profile) throw new AppError(403, 'NO_PROFILE', 'Finish your profile first.');
    const errors = validateRequest({ category: input.category, title: input.title, description: input.description ?? null, size: input.size ?? null, budget: input.budget ?? null, mediaCount: input.mediaIds.length });
    if (Object.keys(errors).length) throw new AppError(400, 'VALIDATION', 'Check the highlighted fields.', errors);
    const evs: RealtimeEvent[] = [];
    const id = await this.db.transaction(async (tx) => {
      const bad = await checkOwnedMedia(tx, userId, input.mediaIds, 'REQUEST', { images: true, max: 4, min: 1 });
      if (bad) throw new AppError(400, 'VALIDATION', 'Check the photos.', { media: bad });
      const now = this.clock.now();
      const reqId = randomUUID();
      const candidates = await tx.select({ id: sellers.id, userId: sellers.userId, categories: sellers.categories }).from(sellers).where(sql`${input.category} = any(${sellers.categories})`);
      const reached = sellersReached(candidates, input.category, userId);
      await tx.insert(buyerRequests).values({
        id: reqId,
        buyerUserId: userId,
        category: input.category,
        title: input.title.trim(),
        description: input.description?.trim() || null,
        size: input.size?.trim() || null,
        budgetPaise: input.budget ?? null,
        status: 'OPEN',
        expiresAt: new Date(requestExpiry(now)),
        reachedCount: reached.length,
        createdAt: new Date(now),
      });
      await tx.insert(requestMedia).values(input.mediaIds.map((mediaId, position) => ({ requestId: reqId, position, mediaId })));
      if (reached.length) {
        await tx.insert(notifications).values(reached.map((s) => ({ userId: s.userId, app: 'seller' as const, code: 'NEW_REQUEST', requestId: reqId, createdAt: new Date(now) })));
        for (const s of reached) evs.push({ name: 'request.updated', payload: { requestId: reqId }, sellerUserId: s.userId });
      }
      return reqId;
    });
    this.events.publish(evs);
    return this.getForBuyer(userId, id);
  }

  async listForBuyer(userId: string): Promise<BuyerRequestList> {
    const due = await this.db.select({ id: buyerRequests.id }).from(buyerRequests).where(and(eq(buyerRequests.buyerUserId, userId), eq(buyerRequests.status, 'OPEN'), lte(buyerRequests.expiresAt, new Date(this.clock.now()))));
    if (due.length) await this.expireWhere(this.clock.now(), due.map((d) => d.id));
    const rows = await this.db.select().from(buyerRequests).where(eq(buyerRequests.buyerUserId, userId)).orderBy(desc(buyerRequests.createdAt), desc(buyerRequests.id)).limit(100);
    return { items: await this.buyerViews(this.db, rows) };
  }

  async getForBuyer(userId: string, id: string): Promise<BuyerRequest> {
    await this.expireWhere(this.clock.now(), [id]);
    const [row] = await this.db.select().from(buyerRequests).where(and(eq(buyerRequests.id, id), eq(buyerRequests.buyerUserId, userId))).limit(1);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Request not found.');
    return (await this.buyerViews(this.db, [row]))[0]!;
  }

  private async buyerViews(q: Q, rows: RequestRow[]): Promise<BuyerRequest[]> {
    const ids = rows.map((r) => r.id);
    const [media, resp] = await Promise.all([
      this.requestMediaOf(q, ids),
      ids.length ? q.select().from(requestResponses).where(inArray(requestResponses.requestId, ids)).orderBy(requestResponses.createdAt, requestResponses.id) : Promise.resolve([] as ResponseRow[]),
    ]);
    const sellerIds = [...new Set(resp.map((r) => r.sellerId))];
    const [rmedia, ss, ratings] = await Promise.all([
      this.responseMediaOf(q, resp.map((r) => r.id)),
      sellerIds.length ? q.select({ id: sellers.id, name: sellers.name, area: sellers.area }).from(sellers).where(inArray(sellers.id, sellerIds)) : Promise.resolve([]),
      sellerRatings(q, sellerIds),
    ]);
    return rows.map((r) => ({
      id: r.id,
      category: r.category,
      title: r.title,
      description: r.description,
      size: r.size,
      budget: r.budgetPaise,
      media: media.get(r.id) ?? [],
      status: r.status,
      expiresAt: r.expiresAt.getTime(),
      reachedCount: r.reachedCount,
      createdAt: r.createdAt.getTime(),
      responses: resp
        .filter((x) => x.requestId === r.id)
        .map((x) => {
          const s = ss.find((y) => y.id === x.sellerId);
          const rt = ratings.get(x.sellerId);
          return {
            id: x.id,
            status: x.status,
            seller: { id: x.sellerId, name: s?.name ?? 'Seller', area: s?.area ?? '', rating: rt?.rating ?? null, reviewCount: rt?.reviewCount ?? 0 },
            text: x.text,
            price: x.pricePaise,
            media: rmedia.get(x.id) ?? [],
            threadId: x.threadId,
            listingId: x.listingId,
          };
        }),
    }));
  }

  async close(userId: string, id: string): Promise<BuyerRequest> {
    await this.expireWhere(this.clock.now(), [id]);
    const evs: RealtimeEvent[] = [];
    await this.db.transaction(async (tx) => {
      const [r] = await tx.select().from(buyerRequests).where(eq(buyerRequests.id, id)).for('update');
      const ok = closeRequest({ status: r?.status ?? 'CLOSED', buyerId: r?.buyerUserId ?? '' }, userId);
      if (!r || !ok.ok) throwFail(ok.ok ? { ok: false, code: 'NOT_FOUND', message: 'Request not found.' } : ok);
      await tx.update(buyerRequests).set({ status: 'CLOSED' }).where(eq(buyerRequests.id, id));
      const resp = await tx.select({ sellerId: requestResponses.sellerId }).from(requestResponses).where(eq(requestResponses.requestId, id));
      const owners = resp.length ? await tx.select({ userId: sellers.userId }).from(sellers).where(inArray(sellers.id, resp.map((x) => x.sellerId))) : [];
      for (const o of owners) evs.push({ name: 'request.updated', payload: { requestId: id }, sellerUserId: o.userId });
      evs.push({ name: 'request.updated', payload: { requestId: id }, buyerUserId: userId });
    });
    this.events.publish(evs);
    return this.getForBuyer(userId, id);
  }

  /** "I want this" opens a chat with that seller; "Not for me" tells the seller. Each response can be answered once. */
  async answer(userId: string, responseId: string, answer: 'WANTED' | 'DECLINED'): Promise<BuyerRequest> {
    const evs: RealtimeEvent[] = [];
    const requestId = await this.db.transaction(async (tx) => {
      const [resp] = await tx.select().from(requestResponses).where(eq(requestResponses.id, responseId)).for('update');
      const [req] = resp ? await tx.select().from(buyerRequests).where(eq(buyerRequests.id, resp.requestId)).limit(1) : [];
      if (!resp || !req) throw new AppError(404, 'NOT_FOUND', 'Response not found.');
      const r = answerResponse({ status: resp.status }, { buyerId: req.buyerUserId }, userId, answer);
      if (!r.ok) throwFail(r);
      if (req.status !== 'OPEN' && answer === 'WANTED') throw new AppError(422, 'CLOSED', 'This request is closed.');
      const [s] = await tx.select({ id: sellers.id, userId: sellers.userId, name: sellers.name }).from(sellers).where(eq(sellers.id, resp.sellerId)).limit(1);
      if (!s) throw new AppError(404, 'NOT_FOUND', 'Response not found.');
      const now = this.clock.now();
      let threadId: string | null = null;
      if (r.opensThread) {
        threadId = await this.chat.createRequestThread(tx, { requestId: req.id, responseId, buyerUserId: userId, sellerId: s.id, sellerUserId: s.userId, systemText: `You asked for “${req.title}”. ${s.name} has one to show you.`, now });
      }
      await tx.update(requestResponses).set({ status: r.status, threadId }).where(eq(requestResponses.id, responseId));
      await tx.insert(notifications).values({ userId: s.userId, app: 'seller', code: answer === 'WANTED' ? 'RESPONSE_WANTED' : 'RESPONSE_DECLINED', requestId: req.id, threadId, createdAt: new Date(now) });
      evs.push({ name: 'request.updated', payload: { requestId: req.id }, buyerUserId: userId, sellerUserId: s.userId });
      if (threadId) evs.push({ name: 'chat.updated', payload: { threadId }, buyerUserId: userId, sellerUserId: s.userId });
      return req.id;
    });
    this.events.publish(evs);
    return this.getForBuyer(userId, requestId);
  }

  // ---------- seller ----------
  async listForSeller(userId: string): Promise<SellerRequestList> {
    const seller = await sellerRow(this.db, userId);
    if (!seller) throw new AppError(403, 'NO_SELLER', 'Set up your shop first.');
    const now = this.clock.now();
    const due = await this.db.select({ id: buyerRequests.id }).from(buyerRequests).where(and(eq(buyerRequests.status, 'OPEN'), lte(buyerRequests.expiresAt, new Date(now)), inArray(buyerRequests.category, seller.categories)));
    if (due.length) await this.expireWhere(now, due.map((d) => d.id));
    const mineResponses = await this.db.select().from(requestResponses).where(eq(requestResponses.sellerId, seller.id));
    const answered = mineResponses.map((r) => r.requestId);
    const inMyCategories = seller.categories.length ? inArray(buyerRequests.category, seller.categories) : undefined;
    const answeredHere = answered.length ? inArray(buyerRequests.id, answered) : undefined;
    // What I may see: open requests in my categories, plus any request I already answered (so "Responded" keeps its history).
    const visible = or(inMyCategories && eq(buyerRequests.status, 'OPEN') ? and(inMyCategories, eq(buyerRequests.status, 'OPEN')) : undefined, answeredHere);
    const rows = visible
      ? await this.db.select().from(buyerRequests).where(and(ne(buyerRequests.buyerUserId, userId), visible)).orderBy(desc(buyerRequests.createdAt), desc(buyerRequests.id)).limit(SELLER_LIST_LIMIT)
      : [];
    const items = await this.sellerViews(this.db, rows, mineResponses);
    return { items, newCount: items.filter((i) => i.status === 'OPEN' && !i.response).length };
  }

  private async sellerViews(q: Q, rows: RequestRow[], mine: ResponseRow[]): Promise<SellerRequest[]> {
    const [media, rmedia, buyers] = await Promise.all([
      this.requestMediaOf(q, rows.map((r) => r.id)),
      this.responseMediaOf(q, mine.map((r) => r.id)),
      rows.length ? q.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, rows.map((r) => r.buyerUserId))) : Promise.resolve([]),
    ]);
    return rows.map((r) => {
      const x = mine.find((m) => m.requestId === r.id);
      return {
        id: r.id,
        category: r.category,
        title: r.title,
        description: r.description,
        size: r.size,
        budget: r.budgetPaise,
        media: media.get(r.id) ?? [],
        buyerFirstName: firstName(buyers.find((b) => b.id === r.buyerUserId)?.name),
        status: r.status,
        expiresAt: r.expiresAt.getTime(),
        createdAt: r.createdAt.getTime(),
        response: x ? { id: x.id, status: x.status as ResponseStatus, text: x.text, price: x.pricePaise, media: rmedia.get(x.id) ?? [], threadId: x.threadId, listingId: x.listingId } : null,
      };
    });
  }

  async respond(userId: string, requestId: string, input: Respond): Promise<SellerRequest> {
    const seller = await sellerRow(this.db, userId);
    if (!seller) throw new AppError(403, 'NO_SELLER', 'Set up your shop first.');
    await this.expireWhere(this.clock.now(), [requestId]);
    const evs: RealtimeEvent[] = [];
    await this.db.transaction(async (tx) => {
      const [req] = await tx.select().from(buyerRequests).where(eq(buyerRequests.id, requestId)).for('share');
      if (!req) throw new AppError(404, 'NOT_FOUND', 'Request not found.');
      const [dup] = await tx.select({ id: requestResponses.id }).from(requestResponses).where(and(eq(requestResponses.requestId, requestId), eq(requestResponses.sellerId, seller.id))).limit(1);
      const ok = validateResponse({ request: { status: req.status, category: req.category, buyerId: req.buyerUserId }, seller: { userId, categories: seller.categories }, alreadyResponded: !!dup, text: input.text ?? null, price: input.price ?? null, mediaCount: input.mediaIds.length });
      if (!ok.ok) throwFail(ok);
      const bad = await checkOwnedMedia(tx, userId, input.mediaIds, 'REQUEST', { images: true, max: 4, min: 1 });
      if (bad) throw new AppError(400, 'VALIDATION', 'Check the photos.', { media: bad });
      const now = new Date(this.clock.now());
      let responseId: string;
      try {
        // A savepoint, so a lost race on the unique (request, seller) index becomes a clean refusal instead of aborting the transaction.
        responseId = await tx.transaction(async (sp) => {
          const [created] = await sp.insert(requestResponses).values({ requestId, sellerId: seller.id, text: input.text?.trim() || null, pricePaise: input.price ?? null, status: 'SENT', createdAt: now }).returning({ id: requestResponses.id });
          return created!.id;
        });
      } catch {
        throw new AppError(422, 'ALREADY_RESPONDED', 'You’ve already responded to this request.');
      }
      await tx.insert(responseMedia).values(input.mediaIds.map((mediaId, position) => ({ responseId, position, mediaId })));
      await tx.insert(notifications).values({ userId: req.buyerUserId, app: 'buyer', code: 'NEW_RESPONSE', requestId, createdAt: now });
      evs.push({ name: 'request.updated', payload: { requestId }, buyerUserId: req.buyerUserId, sellerUserId: userId });
    });
    this.events.publish(evs);
    const [row] = await this.db.select().from(buyerRequests).where(eq(buyerRequests.id, requestId)).limit(1);
    const mine = await this.db.select().from(requestResponses).where(and(eq(requestResponses.requestId, requestId), eq(requestResponses.sellerId, seller.id)));
    return (await this.sellerViews(this.db, [row!], mine))[0]!;
  }
}
