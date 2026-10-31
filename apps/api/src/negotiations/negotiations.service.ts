import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiErrorCode, BuyerNegotiation, SellerNegotiation, SellerNegotiationList, BuyerNegotiationList } from '@fayda/contracts';
import {
  RULES,
  acceptLatest,
  appendOffer,
  buyerNegotiationView,
  cleanDeal,
  decideAutomation,
  declineLatest,
  invalidate,
  invalidationsForListingChange,
  lastBySide,
  markPurchased,
  latest,
  scheduleAutomation,
  startNegotiation,
  sweepNegotiation,
  validateCounter,
  validateDealAccess,
  validateNewOffer,
  withdraw,
  DAY,
  type AutomationDecision,
  type BargainMode,
  type Channel,
  type Clock,
  type DealAccess,
  type DealCodes,
  type Fail,
  type Negotiation,
  type Notice,
  type Paise,
  type PrivateRules,
  type Side,
} from '@fayda/domain';
import { and, count, desc, eq, gt, inArray, lte } from 'drizzle-orm';
import { AppError, statusForCode } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { DbService } from '../db/db.service.js';
import { listingMedia, listingVariants, listings, media, negotiations, notifications, orders, reservations, sellers, users } from '../db/schema.js';
import { publicMediaUrl } from '../media/media.service.js';
import { SweepRunner, type SweepTask } from '../scheduler/sweep-runner.js';
import { NegotiationEvents, type NegotiationTouch } from './negotiation-events.js';

type Db = DbService['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;
type ListingRow = typeof listings.$inferSelect;
type NegRow = typeof negotiations.$inferSelect;

/** How many negotiations one sweep tick handles. A backlog is cleared over the next ticks. */
const SWEEP_BATCH = 50;
/** One sweep can fire several steps in a row (counter, then expiry) if the server was down for a while. */
const MAX_STEPS = 4;

/** Everything needed to run the rules on one locked negotiation. */
interface Loaded {
  row: NegRow;
  n: Negotiation;
  listing: ListingRow;
  sellerUserId: string;
  rules: PrivateRules;
  codes: DealCodes;
  channel: Channel;
}

/** Turns a domain refusal into the problem+json the client sees. */
export function throwFail(f: Fail): never {
  throw new AppError(statusForCode(f.code), f.code as ApiErrorCode, f.message, f.fields);
}

const rulesOf = (l: ListingRow): PrivateRules => ({ autoAcceptAt: l.autoAcceptAt, autoDeclineBelow: l.autoDeclineBelow, autoCounterAt: l.autoCounterAt });
const codesOf = (l: ListingRow): DealCodes => ({ accept: l.dealAccept ?? null, counter: l.dealCounter ?? null });

/** The earliest moment something about this negotiation is due. The sweep and the lazy check on read look at this column. */
export function nextDueAt(n: Negotiation): number | null {
  if (n.status === 'AGREED') return n.agreement?.deadline ?? null;
  if (n.status !== 'OPEN' || !n.offers.length) return null;
  const last = latest(n);
  if (last.status !== 'PENDING') return null;
  return Math.min(...[last.autoCounterDueAt, last.autoDeclineAt, last.expiresAt].filter((x): x is number => typeof x === 'number'));
}

@Injectable()
export class NegotiationsService implements SweepTask {
  readonly name = 'negotiations';

  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NegotiationEvents) private readonly events: NegotiationEvents,
    @Inject(SweepRunner) sweep: SweepRunner,
  ) {
    sweep.register(this);
  }

  private get db(): Db {
    return this.database.db;
  }

  // ---------- loading and saving ----------
  private toDomain(r: NegRow): Negotiation {
    return {
      id: r.id,
      listingId: r.listingId,
      variantId: r.variantId,
      buyerId: r.buyerUserId,
      status: r.status,
      closeReason: (r.closeReason as Negotiation['closeReason']) ?? null,
      offers: r.offers,
      events: r.events,
      agreement: r.agreement ?? null,
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
    };
  }

  private async context(q: Q, row: NegRow, listing?: ListingRow): Promise<Loaded> {
    const l = listing ?? (await q.select().from(listings).where(eq(listings.id, row.listingId)).limit(1))[0];
    const [s] = await q.select({ userId: sellers.userId }).from(sellers).where(eq(sellers.id, row.sellerId)).limit(1);
    if (!l || !s) throw new AppError(404, 'NOT_FOUND', 'Negotiation not found.');
    return { row, n: this.toDomain(row), listing: l, sellerUserId: s.userId, rules: rulesOf(l), codes: codesOf(l), channel: l.channel };
  }

  private async persist(tx: Tx, c: Loaded, n: Negotiation): Promise<void> {
    const due = nextDueAt(n);
    await tx
      .update(negotiations)
      .set({
        status: n.status,
        closeReason: n.closeReason,
        offers: n.offers,
        events: n.events,
        agreement: n.agreement,
        nextDueAt: due == null ? null : new Date(due),
        updatedAt: new Date(n.updatedAt),
      })
      .where(eq(negotiations.id, n.id));
    c.n = n;
  }

  private async notify(tx: Tx, c: Pick<Loaded, 'n' | 'sellerUserId'>, notices: Notice[]): Promise<void> {
    if (!notices.length) return;
    await tx.insert(notifications).values(
      notices.map((x) => ({
        userId: x.audience === 'buyer' ? c.n.buyerId : c.sellerUserId,
        app: x.audience,
        code: x.code,
        params: x.params ?? null,
        negotiationId: c.n.id,
        createdAt: new Date(x.at),
      })),
    );
  }

  private touch(c: Pick<Loaded, 'n' | 'sellerUserId'>): NegotiationTouch {
    return { negotiationId: c.n.id, listingId: c.n.listingId, buyerUserId: c.n.buyerId, sellerUserId: c.sellerUserId };
  }

  /** Locks the size row (so two people cannot take the last unit), then reads how many units are still free. */
  private async lockVariant(tx: Tx, variantId: string): Promise<{ stock: number; label: string } | null> {
    const [v] = await tx.select({ stock: listingVariants.stock, label: listingVariants.label }).from(listingVariants).where(eq(listingVariants.id, variantId)).for('update');
    return v ?? null;
  }

  private async availableUnits(q: Q, variantId: string, stock: number, now: number): Promise<number> {
    const [held] = await q
      .select({ n: count() })
      .from(reservations)
      .where(and(eq(reservations.variantId, variantId), eq(reservations.status, 'ACTIVE'), gt(reservations.expiresAt, new Date(now))));
    return Math.max(0, stock - (held?.n ?? 0));
  }

  private async reserve(tx: Tx, negotiationId: string, variantId: string, until: number): Promise<void> {
    await tx.insert(reservations).values({ negotiationId, variantId, status: 'ACTIVE', expiresAt: new Date(until) });
  }

  private async release(tx: Tx, negotiationId: string): Promise<void> {
    await tx.update(reservations).set({ status: 'RELEASED' }).where(and(eq(reservations.negotiationId, negotiationId), eq(reservations.status, 'ACTIVE')));
  }

  // ---------- time-driven steps (shared by the sweep and the lazy check on read) ----------
  /** Fires whatever is due at `now` on a locked negotiation: automatic counter or decline, offer expiry, agreement lapse. */
  private async stepDue(tx: Tx, c: Loaded, now: number, touched: NegotiationTouch[]): Promise<boolean> {
    let changed = false;
    for (let i = 0; i < MAX_STEPS; i++) {
      const out = sweepNegotiation(c.n, now, {
        listPrice: c.listing.pricePaise,
        expiryMinutes: c.listing.expiryMinutes,
        channel: c.channel,
        rules: c.rules,
        codes: c.codes,
        newOfferId: randomUUID,
      });
      if (!out.changed) break;
      changed = true;
      await this.persist(tx, c, out.negotiation);
      await this.notify(tx, c, out.notices);
      if (out.releaseReservation) await this.release(tx, c.n.id);
    }
    if (changed) touched.push(this.touch(c));
    else if (c.row.nextDueAt && c.row.nextDueAt.getTime() <= now) {
      // Nothing to do although the column said so: bring the column back in line so the sweep does not revisit it every second.
      await this.persist(tx, c, c.n);
    }
    return changed;
  }

  /** Scheduled sweep: handles negotiations that are due, oldest first. Safe to run on two instances at once. */
  async run(now: number): Promise<number> {
    let total = 0;
    const touched: NegotiationTouch[] = [];
    await this.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(negotiations)
        .where(and(lte(negotiations.nextDueAt, new Date(now))))
        .orderBy(negotiations.nextDueAt)
        .limit(SWEEP_BATCH)
        .for('update', { skipLocked: true });
      for (const row of due) {
        const c = await this.context(tx, row);
        if (await this.stepDue(tx, c, now, touched)) total++;
      }
      // Holds whose time has passed no longer count against stock; mark them so the table stays tidy.
      await tx.update(reservations).set({ status: 'RELEASED' }).where(and(eq(reservations.status, 'ACTIVE'), lte(reservations.expiresAt, new Date(now))));
    });
    this.events.emit(touched);
    return total;
  }

  /** Lazy check: before a read, fire anything already due for these negotiations so a slow sweep is never visible. */
  private async catchUp(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const now = this.clock.now();
    const touched: NegotiationTouch[] = [];
    await this.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(negotiations)
        .where(and(inArray(negotiations.id, ids), lte(negotiations.nextDueAt, new Date(now))))
        .for('update', { skipLocked: true });
      for (const row of due) await this.stepDue(tx, await this.context(tx, row), now, touched);
    });
    this.events.emit(touched);
  }

  // ---------- mutation wrapper ----------
  /**
   * Runs one change on a negotiation, as one transaction. Lock order is always size row first, then the negotiation, so two
   * people acting on the same size cannot deadlock. Anything already due is applied before the change, as the prototype does.
   */
  private async mutate<T>(
    negotiationId: string,
    who: { side: Side; userId: string },
    fn: (tx: Tx, c: Loaded, now: number, touched: NegotiationTouch[], variant: { stock: number; label: string } | null) => Promise<T>,
  ): Promise<T> {
    const touched: NegotiationTouch[] = [];
    const result = await this.db.transaction(async (tx) => {
      const [pre] = await tx.select({ variantId: negotiations.variantId }).from(negotiations).where(eq(negotiations.id, negotiationId)).limit(1);
      if (!pre) throw new AppError(404, 'NOT_FOUND', 'Negotiation not found.');
      const variant = await this.lockVariant(tx, pre.variantId);
      const [row] = await tx.select().from(negotiations).where(eq(negotiations.id, negotiationId)).for('update');
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Negotiation not found.');
      const c = await this.context(tx, row);
      const mine = who.side === 'BUYER' ? c.n.buyerId === who.userId : c.sellerUserId === who.userId;
      if (!mine) throw new AppError(404, 'NOT_FOUND', 'Negotiation not found.');
      const now = this.clock.now();
      await this.stepDue(tx, c, now, touched);
      const out = await fn(tx, c, now, touched, variant);
      touched.push(this.touch(c));
      return out;
    });
    this.events.emit(touched);
    return result;
  }

  // ---------- automation (the seller's private rules) ----------
  private async applyDecision(tx: Tx, c: Loaded, d: AutomationDecision | null, now: number, variantStock: number): Promise<Negotiation> {
    if (!d) return c.n;
    if (d.kind === 'ACCEPT') {
      const free = await this.availableUnits(tx, c.n.variantId, variantStock, now);
      const r = acceptLatest(c.n, 'SYSTEM', now, { channel: c.channel, availableUnits: free, price: d.price, dealAccess: d.dealAccess });
      if (r.ok) {
        await this.reserve(tx, c.n.id, c.n.variantId, r.reserveUntil);
        await this.notify(tx, c, r.notices);
        return r.negotiation;
      }
      // No stock left for an automatic accept: fall back to the decline and counter rules.
      return this.applyDecision(tx, c, decideAutomation(c.n, c.rules, { channel: c.channel, listPrice: c.listing.pricePaise, now, codes: c.codes, skipAccept: true }), now, variantStock);
    }
    if (d.kind === 'NOTIFY_SELLER') {
      await this.notify(tx, c, [{ audience: 'seller', code: 'NEW_OFFER', at: now, params: { amount: c.n.offers.length ? latest(c.n).amount : 0 } }]);
      return c.n;
    }
    return scheduleAutomation(c.n, d);
  }

  private async runAutomation(tx: Tx, c: Loaded, now: number, variantStock: number): Promise<void> {
    const d = decideAutomation(c.n, c.rules, { channel: c.channel, listPrice: c.listing.pricePaise, now, codes: c.codes });
    const next = await this.applyDecision(tx, c, d, now, variantStock);
    await this.persist(tx, c, next);
  }

  /** After a unit is taken, other open offers on the same size can no longer be honoured. */
  private async closeIfSoldOut(tx: Tx, variantId: string, stock: number, exceptId: string | null, now: number, touched: NegotiationTouch[]): Promise<void> {
    if ((await this.availableUnits(tx, variantId, stock, now)) > 0) return;
    const rows = await tx
      .select()
      .from(negotiations)
      .where(and(eq(negotiations.variantId, variantId), eq(negotiations.status, 'OPEN')))
      .orderBy(negotiations.id)
      .for('update');
    for (const row of rows) {
      if (row.id === exceptId) continue;
      const c = await this.context(tx, row);
      const r = invalidate(c.n, 'SOLD_OUT', now);
      await this.persist(tx, c, r.negotiation);
      await this.notify(tx, c, r.notices);
      touched.push(this.touch(c));
    }
  }

  // ---------- buyer: start and respond ----------
  async startOffer(buyerUserId: string, listingId: string, input: { variantId: string; amount: Paise }): Promise<BuyerNegotiation> {
    const touched: NegotiationTouch[] = [];
    const id = await this.db.transaction(async (tx) => {
      // A shared lock on the listing stops the seller pausing or editing it between this check and the insert.
      const [listing] = await tx.select().from(listings).where(eq(listings.id, listingId)).for('share');
      if (!listing) throw new AppError(404, 'NOT_AVAILABLE', 'This listing isn’t available.');
      const [seller] = await tx.select({ id: sellers.id, userId: sellers.userId }).from(sellers).where(eq(sellers.id, listing.sellerId)).limit(1);
      if (!seller) throw new AppError(404, 'NOT_AVAILABLE', 'This listing isn’t available.');
      // The size must belong to this listing; an id from another listing is treated as "no such size".
      const [own] = await tx.select({ id: listingVariants.id }).from(listingVariants).where(and(eq(listingVariants.id, input.variantId), eq(listingVariants.listingId, listingId))).limit(1);
      const variant = own ? await this.lockVariant(tx, own.id) : null;
      const now = this.clock.now();
      const mine = await tx.select({ variantId: negotiations.variantId, status: negotiations.status, createdAt: negotiations.createdAt }).from(negotiations).where(and(eq(negotiations.buyerUserId, buyerUserId), eq(negotiations.listingId, listingId)));
      const check = validateNewOffer({
        listingActive: listing.status === 'ACTIVE',
        isOwnListing: seller.userId === buyerUserId,
        mode: listing.bargainMode as BargainMode,
        variantExists: !!variant,
        availableUnits: variant ? await this.availableUnits(tx, input.variantId, variant.stock, now) : 0,
        listPrice: listing.pricePaise,
        amount: input.amount,
        hasOpenForVariant: mine.some((m) => m.variantId === input.variantId && (m.status === 'OPEN' || m.status === 'AGREED')),
        startedLast24h: mine.filter((m) => m.createdAt.getTime() > now - DAY).length,
      });
      if (!check.ok) throwFail(check);
      const negId = randomUUID();
      let n = startNegotiation({ id: negId, listingId, variantId: input.variantId, buyerId: buyerUserId }, now);
      n = appendOffer(n, { id: randomUUID(), by: 'BUYER', amount: input.amount }, now, listing.expiryMinutes);
      await tx.insert(negotiations).values({
        id: negId,
        listingId,
        variantId: input.variantId,
        buyerUserId,
        sellerId: seller.id,
        status: n.status,
        closeReason: null,
        offers: n.offers,
        events: n.events,
        agreement: null,
        nextDueAt: null,
        createdAt: new Date(now),
        updatedAt: new Date(now),
      });
      const [row] = await tx.select().from(negotiations).where(eq(negotiations.id, negId)).limit(1);
      const c = await this.context(tx, row!, listing);
      c.n = n;
      await this.runAutomation(tx, c, now, variant!.stock);
      if (c.n.status === 'AGREED') await this.closeIfSoldOut(tx, input.variantId, variant!.stock, negId, now, touched);
      touched.push(this.touch(c));
      return negId;
    });
    this.events.emit(touched);
    return this.getForBuyer(buyerUserId, id);
  }

  async buyerCounter(buyerUserId: string, id: string, amount: Paise): Promise<BuyerNegotiation> {
    await this.mutate(id, { side: 'BUYER', userId: buyerUserId }, async (tx, c, now, t, variant) => {
      const ok = validateCounter(c.n, 'BUYER', amount, c.listing.pricePaise);
      if (!ok.ok) throwFail(ok);
      const next = appendOffer(c.n, { id: randomUUID(), by: 'BUYER', amount }, now, c.listing.expiryMinutes);
      await this.persist(tx, c, next);
      await this.runAutomation(tx, c, now, variant?.stock ?? 0);
      if (c.n.status === 'AGREED') await this.closeIfSoldOut(tx, c.n.variantId, variant?.stock ?? 0, c.n.id, now, t);
    });
    return this.getForBuyer(buyerUserId, id);
  }

  async buyerAccept(buyerUserId: string, id: string): Promise<BuyerNegotiation> {
    await this.mutate(id, { side: 'BUYER', userId: buyerUserId }, (tx, c, now, t, variant) => this.accept(tx, c, 'BUYER', null, now, t, variant));
    return this.getForBuyer(buyerUserId, id);
  }

  async buyerDecline(buyerUserId: string, id: string): Promise<BuyerNegotiation> {
    await this.mutate(id, { side: 'BUYER', userId: buyerUserId }, (tx, c, now) => this.decline(tx, c, 'BUYER', now));
    return this.getForBuyer(buyerUserId, id);
  }

  async buyerWithdraw(buyerUserId: string, id: string): Promise<BuyerNegotiation> {
    await this.mutate(id, { side: 'BUYER', userId: buyerUserId }, async (tx, c, now) => {
      const r = withdraw(c.n, now);
      if (!r.ok) throwFail(r);
      await this.persist(tx, c, r.negotiation);
      await this.notify(tx, c, [r.notice]);
    });
    return this.getForBuyer(buyerUserId, id);
  }

  // ---------- seller: respond ----------
  async sellerAccept(sellerUserId: string, id: string, dealAccess: DealAccess | null | undefined): Promise<SellerNegotiation> {
    await this.mutate(id, { side: 'SELLER', userId: sellerUserId }, (tx, c, now, t, variant) => {
      const access = this.sellerDealAccess(c, dealAccess, 'Code or link');
      return this.accept(tx, c, 'SELLER', access, now, t, variant);
    });
    return this.getForSeller(sellerUserId, id);
  }

  async sellerCounter(sellerUserId: string, id: string, amount: Paise, dealAccess: DealAccess | null | undefined): Promise<SellerNegotiation> {
    await this.mutate(id, { side: 'SELLER', userId: sellerUserId }, async (tx, c, now) => {
      const ok = validateCounter(c.n, 'SELLER', amount, c.listing.pricePaise);
      if (!ok.ok) throwFail(ok);
      const access = this.sellerDealAccess(c, dealAccess, 'Code or link for your counter');
      const next = appendOffer(c.n, { id: randomUUID(), by: 'SELLER', amount, dealAccess: access }, now, c.listing.expiryMinutes);
      await this.persist(tx, c, next);
      await this.notify(tx, c, [{ audience: 'buyer', code: 'SELLER_COUNTERED', at: now, params: { amount } }]);
    });
    return this.getForSeller(sellerUserId, id);
  }

  async sellerDecline(sellerUserId: string, id: string): Promise<SellerNegotiation> {
    await this.mutate(id, { side: 'SELLER', userId: sellerUserId }, (tx, c, now) => this.decline(tx, c, 'SELLER', now));
    return this.getForSeller(sellerUserId, id);
  }

  /** On a website listing the seller must give the code or link that produces the agreed or countered price. */
  private sellerDealAccess(c: Loaded, given: DealAccess | null | undefined, label: string): DealAccess | null {
    if (c.channel !== 'WEBSITE') return null;
    const m = validateDealAccess(given, label);
    if (m) throw new AppError(400, 'DEAL_ACCESS_REQUIRED', m, { dealAccess: m });
    return cleanDeal(given as DealAccess);
  }

  private async accept(tx: Tx, c: Loaded, side: Side, dealAccess: DealAccess | null, now: number, touched: NegotiationTouch[], variant: { stock: number } | null): Promise<void> {
    const free = variant ? await this.availableUnits(tx, c.n.variantId, variant.stock, now) : 0;
    const r = acceptLatest(c.n, side, now, { channel: c.channel, availableUnits: free, dealAccess });
    if (!r.ok) throwFail(r);
    await this.persist(tx, c, r.negotiation);
    await this.reserve(tx, c.n.id, c.n.variantId, r.reserveUntil);
    await this.notify(tx, c, r.notices);
    await this.closeIfSoldOut(tx, c.n.variantId, variant?.stock ?? 0, c.n.id, now, touched);
  }

  private async decline(tx: Tx, c: Loaded, side: Side, now: number): Promise<void> {
    const r = declineLatest(c.n, side, now);
    if (!r.ok) throwFail(r);
    await this.persist(tx, c, r.negotiation);
    await this.notify(tx, c, [r.notice]);
  }

  // ---------- reacting to listing edits (called by ListingsService inside its transaction) ----------
  /** Closes open negotiations that a listing edit makes invalid: paused, switched to Buy now, price dropped, size removed. */
  async onListingChanged(
    tx: Tx,
    listingId: string,
    change: { oldPrice: Paise | null; newPrice: Paise; oldMode: BargainMode | null; newMode: BargainMode; removedVariantIds: string[]; paused?: boolean },
    now: number,
    touched: NegotiationTouch[],
  ): Promise<void> {
    const rows = await tx.select().from(negotiations).where(and(eq(negotiations.listingId, listingId), eq(negotiations.status, 'OPEN'))).orderBy(negotiations.id).for('update');
    if (!rows.length) return;
    const loaded = await Promise.all(rows.map((r) => this.context(tx, r)));
    const closes = invalidationsForListingChange(
      change,
      loaded.map((c) => ({ id: c.n.id, variantId: c.n.variantId, latestAmount: latest(c.n).amount })),
    );
    for (const { id, reason } of closes) {
      const c = loaded.find((x) => x.n.id === id)!;
      const r = invalidate(c.n, reason, now);
      await this.persist(tx, c, r.negotiation);
      await this.notify(tx, c, r.notices);
      touched.push(this.touch(c));
    }
  }

  /** After stock edits: any size with no free unit left closes its open offers. */
  async closeSoldOutSizes(tx: Tx, listingId: string, now: number, touched: NegotiationTouch[]): Promise<void> {
    const vs = await tx.select({ id: listingVariants.id, stock: listingVariants.stock }).from(listingVariants).where(eq(listingVariants.listingId, listingId));
    for (const v of vs) await this.closeIfSoldOut(tx, v.id, v.stock, null, now, touched);
  }

  // ---------- used by OrdersService, inside its own transaction ----------
  /**
   * Locks the negotiation (the caller has already locked the size row, I-15), fires anything already due so a lapsed
   * agreement is seen as lapsed, and reports what an order may be placed against.
   */
  async lockAgreementForPurchase(
    tx: Tx,
    id: string,
    now: number,
    touched: NegotiationTouch[],
  ): Promise<{ buyerUserId: string; listingId: string; variantId: string; status: Negotiation['status']; price: Paise | null; dealAccess: DealAccess | null } | null> {
    const [row] = await tx.select().from(negotiations).where(eq(negotiations.id, id)).for('update');
    if (!row) return null;
    const c = await this.context(tx, row);
    await this.stepDue(tx, c, now, touched);
    return {
      buyerUserId: c.n.buyerId,
      listingId: c.n.listingId,
      variantId: c.n.variantId,
      status: c.n.status,
      price: c.n.agreement?.price ?? null,
      dealAccess: c.n.agreement?.dealAccess ?? null,
    };
  }

  /** The agreement is used up by an order: the negotiation becomes PURCHASED and its held unit is consumed. */
  async completePurchase(tx: Tx, id: string, now: number, touched: NegotiationTouch[]): Promise<void> {
    const [row] = await tx.select().from(negotiations).where(eq(negotiations.id, id)).for('update');
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Negotiation not found.');
    const c = await this.context(tx, row);
    await this.persist(tx, c, markPurchased(c.n, now));
    await tx.update(reservations).set({ status: 'CONSUMED' }).where(and(eq(reservations.negotiationId, id), eq(reservations.status, 'ACTIVE')));
    touched.push(this.touch(c));
  }

  /** After an order takes a unit: if the size has no free unit left, the other open offers on it close (SOLD_OUT). */
  async closeOffersIfSoldOut(tx: Tx, variantId: string, stock: number, exceptId: string | null, now: number, touched: NegotiationTouch[]): Promise<void> {
    await this.closeIfSoldOut(tx, variantId, stock, exceptId, now, touched);
  }

  publish(touched: NegotiationTouch[]): void {
    this.events.emit(touched);
  }

  // ---------- reads ----------
  private async covers(ids: string[]): Promise<Map<string, string | null>> {
    const out = new Map<string, string | null>();
    if (!ids.length) return out;
    const rows = await this.db
      .select({ listingId: listingMedia.listingId, mediaId: listingMedia.mediaId, poster: listingMedia.posterMediaId, kind: media.kind, position: listingMedia.position })
      .from(listingMedia)
      .innerJoin(media, eq(media.id, listingMedia.mediaId))
      .where(and(inArray(listingMedia.listingId, ids), eq(listingMedia.position, 0)));
    for (const r of rows) out.set(r.listingId, r.kind === 'image' ? publicMediaUrl(r.mediaId) : r.poster ? publicMediaUrl(r.poster) : null);
    return out;
  }

  private async cards(rows: { n: NegRow; sellerName: string; buyerName: string | null }[]) {
    const listingIds = [...new Set(rows.map((r) => r.n.listingId))];
    const variantIds = [...new Set(rows.map((r) => r.n.variantId))];
    const [ls, vs, covers] = await Promise.all([
      listingIds.length ? this.db.select().from(listings).where(inArray(listings.id, listingIds)) : [],
      variantIds.length ? this.db.select({ id: listingVariants.id, label: listingVariants.label }).from(listingVariants).where(inArray(listingVariants.id, variantIds)) : [],
      this.covers(listingIds),
    ]);
    const lBy = new Map(ls.map((l) => [l.id, l]));
    const vBy = new Map(vs.map((v) => [v.id, v.label]));
    const negIds = rows.map((r) => r.n.id);
    const placed = negIds.length ? await this.db.select({ id: orders.id, negotiationId: orders.negotiationId }).from(orders).where(inArray(orders.negotiationId, negIds)) : [];
    const orderBy = new Map(placed.map((o) => [o.negotiationId as string, o.id]));
    return rows.map((r) => {
      const l = lBy.get(r.n.listingId)!;
      return { ...r, orderId: orderBy.get(r.n.id) ?? null, listing: l, variantLabel: vBy.get(r.n.variantId) ?? 'Removed size', coverUrl: covers.get(l.id) ?? null };
    });
  }

  private buyerShape(x: Awaited<ReturnType<NegotiationsService['cards']>>[number]): BuyerNegotiation {
    const n = this.toDomain(x.n);
    const view = buyerNegotiationView(n, x.listing.channel);
    return {
      ...view,
      orderId: x.orderId,
      listing: { id: x.listing.id, title: x.listing.title, price: x.listing.pricePaise, coverUrl: x.coverUrl, variantLabel: x.variantLabel, sellerName: x.sellerName },
    };
  }

  private sellerShape(x: Awaited<ReturnType<NegotiationsService['cards']>>[number]): SellerNegotiation {
    const n = this.toDomain(x.n);
    const last = n.offers.length ? latest(n) : null;
    const needsReply = n.status === 'OPEN' && !!last && last.status === 'PENDING' && last.by === 'BUYER';
    const mine = lastBySide(n, 'SELLER');
    return {
      id: n.id,
      listing: { id: x.listing.id, title: x.listing.title, price: x.listing.pricePaise, coverUrl: x.coverUrl, variantLabel: x.variantLabel, sellerName: x.sellerName, channel: x.listing.channel },
      buyerName: x.buyerName?.trim() || 'Buyer',
      status: n.status,
      closeReason: n.closeReason,
      offers: n.offers.map((o) => ({ id: o.id, by: o.by, amount: o.amount, status: o.status, at: o.at, expiresAt: o.expiresAt, dealAccess: o.dealAccess ?? null })),
      agreement: n.agreement ? { price: n.agreement.price, deadline: n.agreement.deadline, acceptedBy: n.agreement.acceptedBy, dealAccess: n.agreement.dealAccess } : null,
      needsReply,
      canCounter: needsReply && n.offers.length < RULES.MAX_OFFERS_PER_NEGOTIATION,
      counterBounds: needsReply && last ? { minExclusive: last.amount, maxExclusive: Math.min(x.listing.pricePaise, mine?.amount ?? x.listing.pricePaise) } : null,
      pendingExpiresAt: n.status === 'OPEN' && last ? last.expiresAt : null,
      updatedAt: n.updatedAt,
    };
  }

  private async rowsFor(where: ReturnType<typeof and>, limit?: number) {
    const q = this.db
      .select({ n: negotiations, sellerName: sellers.name, buyerName: users.name })
      .from(negotiations)
      .innerJoin(sellers, eq(sellers.id, negotiations.sellerId))
      .innerJoin(users, eq(users.id, negotiations.buyerUserId))
      .where(where)
      .orderBy(desc(negotiations.updatedAt), desc(negotiations.id));
    return limit ? q.limit(limit) : q;
  }

  async listForBuyer(userId: string): Promise<BuyerNegotiationList> {
    const ids = (await this.db.select({ id: negotiations.id }).from(negotiations).where(and(eq(negotiations.buyerUserId, userId), lte(negotiations.nextDueAt, new Date(this.clock.now()))))).map((r) => r.id);
    await this.catchUp(ids);
    const rows = await this.rowsFor(and(eq(negotiations.buyerUserId, userId)), 100);
    return { items: (await this.cards(rows)).map((x) => this.buyerShape(x)) };
  }

  async getForBuyer(userId: string, id: string): Promise<BuyerNegotiation> {
    await this.catchUp([id]);
    const rows = await this.rowsFor(and(eq(negotiations.id, id), eq(negotiations.buyerUserId, userId)));
    if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Negotiation not found.');
    return this.buyerShape((await this.cards(rows))[0]!);
  }

  private async sellerIdOf(userId: string): Promise<string> {
    const [s] = await this.db.select({ id: sellers.id }).from(sellers).where(eq(sellers.userId, userId)).limit(1);
    if (!s) throw new AppError(403, 'NO_SELLER', 'Set up your shop first.');
    return s.id;
  }

  async listForSeller(userId: string): Promise<SellerNegotiationList> {
    const sellerId = await this.sellerIdOf(userId);
    const ids = (await this.db.select({ id: negotiations.id }).from(negotiations).where(and(eq(negotiations.sellerId, sellerId), lte(negotiations.nextDueAt, new Date(this.clock.now()))))).map((r) => r.id);
    await this.catchUp(ids);
    const rows = await this.rowsFor(and(eq(negotiations.sellerId, sellerId)), 200);
    const items = (await this.cards(rows)).map((x) => this.sellerShape(x));
    return { items, needsReply: items.filter((i) => i.needsReply).length };
  }

  async getForSeller(userId: string, id: string): Promise<SellerNegotiation> {
    const sellerId = await this.sellerIdOf(userId);
    await this.catchUp([id]);
    const rows = await this.rowsFor(and(eq(negotiations.id, id), eq(negotiations.sellerId, sellerId)));
    if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Negotiation not found.');
    return this.sellerShape((await this.cards(rows))[0]!);
  }
}
