import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import type { ApiErrorCode, BuyerOrder, BuyerOrderList, CancelOrder, ConfirmOrder, PlaceOrder, SellerOrder, SellerOrderList, SellerRecord, ShipmentBody } from '@fayda/contracts';
import {
  CANCEL_REASONS,
  buyAgain,
  buyerMaySeePayment,
  canReviewOrder,
  cancelOrder,
  confirmOrder,
  contactForOrder,
  deliverOrder,
  expireOrderIfDue,
  formatOrderNumber,
  newOrder,
  sellerStats,
  shipOrder,
  upiPayUri,
  validatePlacement,
  type Clock,
  type Contact,
  type Fail,
  type Order,
  type OrderStatus,
  type PaymentProfile,
  type Result,
  type ShipmentInput,
  type Transition,
} from '@fayda/domain';
import { and, count, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm';
import { AppError, statusForCode } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { DbService } from '../db/db.service.js';
import {
  buyerAddresses,
  buyerProfiles,
  listingMedia,
  listingVariants,
  listings,
  media,
  notifications,
  orders,
  reservations,
  reviewMedia,
  reviews,
  sellerPaymentProfiles,
  sellers,
  users,
} from '../db/schema.js';
import { ChatService } from '../chat/chat.service.js';
import { MediaService, publicMediaUrl } from '../media/media.service.js';
import { NegotiationEvents, type NegotiationTouch, type RealtimeEvent } from '../negotiations/negotiation-events.js';
import { NegotiationsService } from '../negotiations/negotiations.service.js';
import { SweepRunner, type SweepTask } from '../scheduler/sweep-runner.js';

type Db = DbService['db'];
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Q = Db | Tx;
type OrderRow = typeof orders.$inferSelect;
type SellerRow = typeof sellers.$inferSelect;
type Joined = { o: OrderRow; seller: SellerRow; buyerName: string | null };

/** How many orders one sweep tick expires. A backlog is cleared over the next ticks. */
const SWEEP_BATCH = 50;
const LIST_LIMIT = 200;

function throwFail(f: Fail): never {
  throw new AppError(statusForCode(f.code), f.code as ApiErrorCode, f.message, f.fields);
}

const BUYER_LABEL: Record<OrderStatus, (channel: 'DIRECT' | 'WEBSITE') => string> = {
  PLACED: (c) => (c === 'DIRECT' ? 'Waiting for the seller to confirm your payment' : 'Waiting for the seller to confirm'),
  CONFIRMED: (c) => (c === 'DIRECT' ? 'Payment received' : 'Order received'),
  SHIPPED: () => 'Shipped',
  DELIVERED: () => 'Delivered',
  CANCELLED: () => 'Cancelled',
  EXPIRED: () => 'Expired: not confirmed in time',
};
const SELLER_LABEL: Record<OrderStatus, (channel: 'DIRECT' | 'WEBSITE') => string> = {
  PLACED: (c) => (c === 'DIRECT' ? 'Waiting for payment to be confirmed' : 'Waiting for you to confirm'),
  CONFIRMED: (c) => (c === 'DIRECT' ? 'Payment received' : 'Order received'),
  SHIPPED: () => 'Shipped',
  DELIVERED: () => 'Delivered',
  CANCELLED: () => 'Cancelled',
  EXPIRED: () => 'Expired: not confirmed in time',
};

const toMs = (d: Date | null): number | null => (d ? d.getTime() : null);

/** Domain shipment (carrier, trackingId) to the wire (courier, trackingNo). */
const shipmentView = (s: OrderRow['shipment']) =>
  s ? { courier: s.carrier, trackingNo: s.trackingId, trackingUrl: s.trackingUrl, expectedDate: s.expectedDate, note: s.note } : null;
const shipmentInput = (b: ShipmentBody): ShipmentInput => ({ carrier: b.courier, trackingId: b.trackingNo, trackingUrl: b.trackingUrl, expectedDate: b.expectedDate, note: b.note });

function cancelText(o: OrderRow): string | null {
  if (o.status === 'EXPIRED') return 'The seller did not confirm in time, so the order expired.';
  if (o.status !== 'CANCELLED' || !o.cancelReason) return null;
  const why = CANCEL_REASONS[o.cancelReason as keyof typeof CANCEL_REASONS] ?? 'Cancelled';
  return o.cancelNote ? `${why}: ${o.cancelNote}` : why;
}

@Injectable()
export class OrdersService implements SweepTask {
  readonly name = 'orders';

  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NegotiationEvents) private readonly events: NegotiationEvents,
    @Inject(NegotiationsService) private readonly negotiations: NegotiationsService,
    @Inject(ChatService) private readonly chat: ChatService,
    @Inject(MediaService) private readonly mediaService: MediaService,
    @Inject(SweepRunner) sweep: SweepRunner,
  ) {
    sweep.register(this);
  }

  private get db(): Db {
    return this.database.db;
  }

  private toDomain(r: OrderRow): Order {
    return {
      id: r.id,
      number: formatOrderNumber(r.seq),
      buyerId: r.buyerUserId,
      sellerId: r.sellerId,
      listingId: r.listingId,
      variantId: r.variantId,
      price: r.pricePaise,
      listPrice: r.listPricePaise,
      priceSource: r.priceSource,
      negotiationId: r.negotiationId,
      channel: r.channel,
      paymentMethod: r.paymentMethod,
      dealAccess: r.dealAccess ?? null,
      status: r.status,
      createdAt: r.createdAt.getTime(),
      confirmBy: r.confirmBy.getTime(),
      confirmedAt: toMs(r.confirmedAt),
      shipment: r.shipment ?? null,
      cancelReason: (r.cancelReason as Order['cancelReason']) ?? null,
      cancelNote: r.cancelNote,
      restocked: r.restocked,
    };
  }

  private publishOrder(rows: { orderId: string; buyerUserId: string; sellerUserId: string }[]): void {
    const events: RealtimeEvent[] = rows.map((r) => ({ name: 'order.updated', payload: { orderId: r.orderId }, buyerUserId: r.buyerUserId, sellerUserId: r.sellerUserId }));
    this.events.publish(events);
  }

  private async lockVariant(tx: Tx, variantId: string): Promise<{ stock: number; label: string } | null> {
    const [v] = await tx.select({ stock: listingVariants.stock, label: listingVariants.label }).from(listingVariants).where(eq(listingVariants.id, variantId)).for('update');
    return v ?? null;
  }

  private async freeUnits(q: Q, variantId: string, stock: number, now: number): Promise<number> {
    const [held] = await q.select({ n: count() }).from(reservations).where(and(eq(reservations.variantId, variantId), eq(reservations.status, 'ACTIVE'), gt(reservations.expiresAt, new Date(now))));
    return Math.max(0, stock - (held?.n ?? 0));
  }

  /** The cover shown on an order: the first photo, or the poster of a first video. Taken when the order is placed. */
  private async coverOf(q: Q, listingId: string): Promise<string | null> {
    const [r] = await q
      .select({ mediaId: listingMedia.mediaId, poster: listingMedia.posterMediaId, kind: media.kind })
      .from(listingMedia)
      .innerJoin(media, eq(media.id, listingMedia.mediaId))
      .where(and(eq(listingMedia.listingId, listingId), eq(listingMedia.position, 0)))
      .limit(1);
    if (!r) return null;
    return r.kind === 'image' ? r.mediaId : r.poster;
  }

  // ---------- placement ----------
  async place(buyerUserId: string, input: PlaceOrder): Promise<BuyerOrder> {
    if (!input.negotiationId && !(input.listingId && input.variantId)) {
      throw new AppError(400, 'VALIDATION', 'Choose a size to buy.', { variantId: 'Choose a size.' });
    }
    // Which size row to lock first. For an agreement it comes from the negotiation, which the caller must own.
    let listingId = input.listingId ?? null;
    let variantId = input.variantId ?? null;
    if (input.negotiationId) {
      const pre = await this.negotiations.getForBuyer(buyerUserId, input.negotiationId).catch(() => null);
      if (!pre) throw new AppError(404, 'NOT_FOUND', 'Agreement not found.');
      listingId = pre.listing.id;
      variantId = pre.variantId;
    }
    const now0 = this.clock.now();
    const touched: NegotiationTouch[] = [];
    const created: { id: string; sellerUserId: string } = await this.db.transaction(async (tx) => {
      const now = Math.max(now0, this.clock.now());
      // A shared lock on the listing stops the seller pausing it between the checks and the insert (as when an offer starts).
      const [listing] = await tx.select().from(listings).where(eq(listings.id, listingId!)).for('share');
      if (!listing) throw new AppError(404, 'NOT_AVAILABLE', 'This listing isn’t available.');
      const [seller] = await tx.select().from(sellers).where(eq(sellers.id, listing.sellerId)).limit(1);
      if (!seller) throw new AppError(404, 'NOT_AVAILABLE', 'This listing isn’t available.');
      const [own] = await tx.select({ id: listingVariants.id }).from(listingVariants).where(and(eq(listingVariants.id, variantId!), eq(listingVariants.listingId, listing.id))).limit(1);
      // Lock order (I-15): the size row first, then the negotiation.
      const variant = own ? await this.lockVariant(tx, own.id) : null;
      const [profile] = await tx.select().from(buyerProfiles).where(eq(buyerProfiles.userId, buyerUserId)).limit(1);
      if (!profile) throw new AppError(403, 'NO_PROFILE', 'Complete your profile first.');

      let agreement: { status: string; belongsToBuyer: boolean } | null = null;
      let price = listing.pricePaise;
      let dealAccess: Order['dealAccess'] = null;
      if (input.negotiationId) {
        const a = await this.negotiations.lockAgreementForPurchase(tx, input.negotiationId, now, touched);
        if (!a) throw new AppError(404, 'NOT_FOUND', 'Agreement not found.');
        agreement = { status: a.status, belongsToBuyer: a.buyerUserId === buyerUserId };
        if (a.price != null) price = a.price;
        dealAccess = a.dealAccess;
      }
      if (listing.status !== 'ACTIVE') throw new AppError(404, 'NOT_AVAILABLE', 'This listing is paused.');

      let address: OrderRow['address'] = null;
      if (listing.channel === 'DIRECT') {
        const addressId = input.addressId ?? profile.defaultAddressId;
        if (addressId) {
          const [a] = await tx.select().from(buyerAddresses).where(and(eq(buyerAddresses.id, addressId), eq(buyerAddresses.userId, buyerUserId))).limit(1);
          if (a) address = { name: a.name, line1: a.line1, line2: a.line2, pin: a.pin, city: a.city, state: a.state };
        }
      }
      const [pay] = await tx.select().from(sellerPaymentProfiles).where(eq(sellerPaymentProfiles.sellerId, seller.id)).limit(1);
      const sellerPayment: PaymentProfile | null = pay
        ? { upiId: pay.upiId, upiQrMediaId: pay.upiQrMediaId, bankHolder: pay.bankHolder, bankAccount: pay.bankAccount, bankIfsc: pay.bankIfsc, bankName: pay.bankName, paymentLink: pay.paymentLink, website: pay.website }
        : null;
      // For an agreement the held unit is already out of the free count; a plain buy needs one free unit.
      const available = variant ? (agreement ? (variant.stock >= 1 ? 1 : 0) : await this.freeUnits(tx, own!.id, variant.stock, now)) : 0;
      const check = validatePlacement({
        agreement,
        listingActive: listing.status === 'ACTIVE',
        isOwnListing: seller.userId === buyerUserId,
        channel: listing.channel,
        variantExists: !!variant,
        availableUnits: available,
        addressOk: !!address,
        paymentMethod: input.paymentMethod ?? undefined,
        sellerPayment,
      });
      if (!check.ok) throwFail(check);
      if (!variant) throw new AppError(404, 'NOT_AVAILABLE', 'This size is no longer available.');
      // An agreement's held unit is already out of the free count, but the stock itself must still have a unit to give.
      if (agreement && variant.stock < 1) throw new AppError(409, 'OUT_OF_STOCK', 'This size just sold out.');
      if (agreement && seller.userId === buyerUserId) throw new AppError(403, 'OWN_LISTING', 'You can’t buy your own listing.');

      const id = randomUUID();
      const o = newOrder({
        id,
        number: '',
        buyerId: buyerUserId,
        sellerId: seller.id,
        listingId: listing.id,
        variantId: own!.id,
        price,
        listPrice: listing.pricePaise,
        priceSource: check.priceSource,
        negotiationId: input.negotiationId ?? null,
        channel: listing.channel,
        paymentMethod: listing.channel === 'DIRECT' ? (input.paymentMethod ?? null) : null,
        dealAccess,
        now,
      });
      const [row] = await tx
        .insert(orders)
        .values({
          id,
          buyerUserId,
          sellerId: seller.id,
          listingId: listing.id,
          variantId: own!.id,
          variantLabel: variant!.label,
          listingTitle: listing.title,
          coverMediaId: await this.coverOf(tx, listing.id),
          pricePaise: price,
          listPricePaise: listing.pricePaise,
          priceSource: check.priceSource,
          negotiationId: input.negotiationId ?? null,
          channel: listing.channel,
          paymentMethod: o.paymentMethod,
          dealAccess,
          address: listing.channel === 'DIRECT' ? address : null,
          status: 'PLACED',
          confirmBy: new Date(o.confirmBy),
          restocked: false,
          createdAt: new Date(now),
          updatedAt: new Date(now),
        })
        .returning();
      const number = formatOrderNumber(row!.seq);
      await tx.update(listingVariants).set({ stock: sql`${listingVariants.stock} - 1` }).where(eq(listingVariants.id, own!.id));
      if (input.negotiationId) await this.negotiations.completePurchase(tx, input.negotiationId, now, touched);
      await this.negotiations.closeOffersIfSoldOut(tx, own!.id, variant!.stock - 1, input.negotiationId ?? null, now, touched);
      await this.chat.createOrderThread(tx, { orderId: id, buyerUserId, sellerId: seller.id, sellerUserId: seller.userId, systemText: `Order ${number} placed. Chat here about this order.`, now });
      await tx.insert(notifications).values({ userId: seller.userId, app: 'seller', code: 'ORDER_PLACED', params: { number }, orderId: id, createdAt: new Date(now) });
      return { id, sellerUserId: seller.userId };
    });
    this.negotiations.publish(touched);
    this.publishOrder([{ orderId: created.id, buyerUserId, sellerUserId: created.sellerUserId }]);
    return this.getForBuyer(buyerUserId, created.id);
  }

  // ---------- seller actions ----------
  private async sellerOf(userId: string): Promise<SellerRow> {
    const [s] = await this.db.select().from(sellers).where(eq(sellers.userId, userId)).limit(1);
    if (!s) throw new AppError(403, 'NO_SELLER', 'Set up your shop first.');
    return s;
  }

  /** Writes a domain transition: the order row, the restock (at most once), and the notices. Runs inside the caller's transaction. */
  private async apply(tx: Tx, row: OrderRow, t: Transition, sellerUserId: string, now: number): Promise<void> {
    const o = t.order;
    await tx
      .update(orders)
      .set({ status: o.status, confirmedAt: o.confirmedAt == null ? null : new Date(o.confirmedAt), shipment: o.shipment, cancelReason: o.cancelReason, cancelNote: o.cancelNote, restocked: o.restocked, updatedAt: new Date(now) })
      .where(eq(orders.id, row.id));
    if (t.restock) await tx.update(listingVariants).set({ stock: sql`${listingVariants.stock} + 1` }).where(eq(listingVariants.id, row.variantId));
    if (t.notices.length) {
      await tx.insert(notifications).values(
        t.notices.map((n) => ({
          userId: n.audience === 'buyer' ? row.buyerUserId : sellerUserId,
          app: n.audience,
          code: n.code,
          params: { ...(n.params ?? {}), number: formatOrderNumber(row.seq) },
          orderId: row.id,
          createdAt: new Date(n.at),
        })),
      );
    }
  }

  /** Runs one seller action on a locked order. Cancelling restocks, so it takes the size row first (same order as placement). */
  private async act(sellerUserId: string, id: string, takesVariant: boolean, fn: (o: Order, now: number) => Result<Transition>): Promise<void> {
    const seller = await this.sellerOf(sellerUserId);
    await this.catchUp(and(eq(orders.id, id), eq(orders.sellerId, seller.id)));
    await this.db.transaction(async (tx) => {
      const [pre] = await tx.select({ variantId: orders.variantId }).from(orders).where(and(eq(orders.id, id), eq(orders.sellerId, seller.id))).limit(1);
      if (!pre) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
      if (takesVariant) await this.lockVariant(tx, pre.variantId);
      const [row] = await tx.select().from(orders).where(eq(orders.id, id)).for('update');
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
      const now = this.clock.now();
      const r = fn(this.toDomain(row), now);
      if (!r.ok) throwFail(r);
      await this.apply(tx, row, r, sellerUserId, now);
    });
    const [row] = await this.db.select({ b: orders.buyerUserId }).from(orders).where(eq(orders.id, id)).limit(1);
    this.publishOrder([{ orderId: id, buyerUserId: row!.b, sellerUserId }]);
  }

  async confirm(sellerUserId: string, id: string, body: ConfirmOrder): Promise<SellerOrder> {
    await this.act(sellerUserId, id, false, (o, now) => confirmOrder(o, body.shipment ? shipmentInput(body.shipment) : undefined, now));
    return this.getForSeller(sellerUserId, id);
  }
  async ship(sellerUserId: string, id: string, body: ShipmentBody): Promise<SellerOrder> {
    await this.act(sellerUserId, id, false, (o, now) => shipOrder(o, shipmentInput(body), now));
    return this.getForSeller(sellerUserId, id);
  }
  async deliver(sellerUserId: string, id: string): Promise<SellerOrder> {
    await this.act(sellerUserId, id, false, (o, now) => deliverOrder(o, now));
    return this.getForSeller(sellerUserId, id);
  }
  async cancel(sellerUserId: string, id: string, body: CancelOrder): Promise<SellerOrder> {
    await this.act(sellerUserId, id, true, (o, now) => cancelOrder(o, body.reason, body.note ?? undefined, now));
    return this.getForSeller(sellerUserId, id);
  }

  // ---------- expiry (48 h) ----------
  /** Expires one order if it is still PLACED and past its confirm-by time. Returns whether it changed. */
  private async expireOne(id: string, now: number): Promise<boolean> {
    let ev: { orderId: string; buyerUserId: string; sellerUserId: string } | null = null;
    await this.db.transaction(async (tx) => {
      const [pre] = await tx.select({ variantId: orders.variantId }).from(orders).where(eq(orders.id, id)).limit(1);
      if (!pre) return;
      // Size row first, then the order, exactly as a cancel does, so the two can never wait on each other.
      await this.lockVariant(tx, pre.variantId);
      const [row] = await tx.select().from(orders).where(and(eq(orders.id, id), eq(orders.status, 'PLACED'), lte(orders.confirmBy, new Date(now)))).for('update', { skipLocked: true });
      if (!row) return;
      const t = expireOrderIfDue(this.toDomain(row), now);
      if (!t) return;
      const [s] = await tx.select({ userId: sellers.userId }).from(sellers).where(eq(sellers.id, row.sellerId)).limit(1);
      await this.apply(tx, row, t, s!.userId, now);
      ev = { orderId: id, buyerUserId: row.buyerUserId, sellerUserId: s!.userId };
    });
    if (ev) this.publishOrder([ev]);
    return ev !== null;
  }

  /** Scheduled sweep: expires unconfirmed orders, oldest first. Safe to run on two instances at once. */
  async run(now: number): Promise<number> {
    const due = await this.db.select({ id: orders.id }).from(orders).where(and(eq(orders.status, 'PLACED'), lte(orders.confirmBy, new Date(now)))).orderBy(orders.confirmBy).limit(SWEEP_BATCH);
    let n = 0;
    for (const r of due) if (await this.expireOne(r.id, now)) n++;
    return n;
  }

  /** Lazy check: before a read, expire anything already due among these orders, so a slow sweep is never visible. */
  private async catchUp(where: ReturnType<typeof and>): Promise<void> {
    const now = this.clock.now();
    const due = await this.db.select({ id: orders.id }).from(orders).where(and(where, eq(orders.status, 'PLACED'), lte(orders.confirmBy, new Date(now)))).limit(SWEEP_BATCH);
    for (const r of due) await this.expireOne(r.id, now);
  }

  // ---------- reading ----------
  private async joined(where: ReturnType<typeof and>, limit?: number): Promise<Joined[]> {
    const q = this.db
      .select({ o: orders, seller: sellers, buyerName: users.name })
      .from(orders)
      .innerJoin(sellers, eq(sellers.id, orders.sellerId))
      .innerJoin(users, eq(users.id, orders.buyerUserId))
      .where(where)
      .orderBy(desc(orders.createdAt), desc(orders.id));
    return limit ? q.limit(limit) : q;
  }

  /** The public record of each seller (O-7) with the average rating, from compact queries. */
  async recordsFor(sellerIds: string[]): Promise<Map<string, SellerRecord>> {
    const out = new Map<string, SellerRecord>();
    if (!sellerIds.length) return out;
    const [rows, ratings] = await Promise.all([
      this.db.select({ sellerId: orders.sellerId, status: orders.status, createdAt: orders.createdAt, confirmedAt: orders.confirmedAt }).from(orders).where(inArray(orders.sellerId, sellerIds)),
      this.db.select({ sellerId: reviews.sellerId, rating: reviews.rating }).from(reviews).where(inArray(reviews.sellerId, sellerIds)),
    ]);
    for (const id of sellerIds) {
      const os = rows.filter((r) => r.sellerId === id).map((r) => ({ status: r.status, createdAt: r.createdAt.getTime(), confirmedAt: toMs(r.confirmedAt) }));
      out.set(id, sellerStats(os as unknown as Order[], ratings.filter((r) => r.sellerId === id).map((r) => r.rating)));
    }
    return out;
  }

  async recordOfSeller(sellerId: string): Promise<SellerRecord> {
    const [s] = await this.db.select({ id: sellers.id }).from(sellers).where(eq(sellers.id, sellerId)).limit(1);
    if (!s) throw new AppError(404, 'NOT_FOUND', 'Shop not found.');
    return (await this.recordsFor([sellerId])).get(sellerId)!;
  }

  async recordOfUser(userId: string): Promise<SellerRecord> {
    return this.recordOfSeller((await this.sellerOf(userId)).id);
  }

  private async reviewViews(orderIds: string[]): Promise<Map<string, NonNullable<BuyerOrder['review']>>> {
    const out = new Map<string, NonNullable<BuyerOrder['review']>>();
    if (!orderIds.length) return out;
    const rs = await this.db.select().from(reviews).where(inArray(reviews.orderId, orderIds));
    if (!rs.length) return out;
    const ms = await this.db
      .select({ reviewId: reviewMedia.reviewId, position: reviewMedia.position, id: media.id, kind: media.kind })
      .from(reviewMedia)
      .innerJoin(media, eq(media.id, reviewMedia.mediaId))
      .where(inArray(reviewMedia.reviewId, rs.map((r) => r.id)))
      .orderBy(reviewMedia.position);
    for (const r of rs) {
      out.set(r.orderId, {
        id: r.id,
        rating: r.rating,
        text: r.text,
        media: ms.filter((m) => m.reviewId === r.id).map((m) => ({ id: m.id, kind: m.kind, url: publicMediaUrl(m.id) })),
        createdAt: r.createdAt.getTime(),
        editedAt: toMs(r.editedAt),
      });
    }
    return out;
  }

  /** Units free per size and the listing's status, for "Buy again". */
  private async availability(listingIds: string[]) {
    const now = new Date(this.clock.now());
    const [ls, vs] = await Promise.all([
      listingIds.length ? this.db.select({ id: listings.id, status: listings.status, channel: listings.channel }).from(listings).where(inArray(listings.id, listingIds)) : [],
      listingIds.length ? this.db.select({ id: listingVariants.id, listingId: listingVariants.listingId, stock: listingVariants.stock }).from(listingVariants).where(inArray(listingVariants.listingId, listingIds)) : [],
    ]);
    const held = vs.length
      ? await this.db.select({ variantId: reservations.variantId, n: count() }).from(reservations).where(and(inArray(reservations.variantId, vs.map((v) => v.id)), eq(reservations.status, 'ACTIVE'), gt(reservations.expiresAt, now))).groupBy(reservations.variantId)
      : [];
    const heldBy = new Map(held.map((h) => [h.variantId, h.n]));
    return { listing: new Map(ls.map((l) => [l.id, l])), free: (listingId: string): Record<string, number> => Object.fromEntries(vs.filter((v) => v.listingId === listingId).map((v) => [v.id, Math.max(0, v.stock - (heldBy.get(v.id) ?? 0))])) };
  }

  private paymentFor(j: Joined, pay: typeof sellerPaymentProfiles.$inferSelect | undefined): BuyerOrder['payment'] {
    const { o, seller } = j;
    if (!pay || !o.paymentMethod || !buyerMaySeePayment({ status: o.status, channel: o.channel })) return null;
    const number = formatOrderNumber(o.seq);
    const method = o.paymentMethod;
    return {
      method,
      note: number,
      amount: o.pricePaise,
      payeeName: seller.name,
      upiId: method === 'UPI' ? pay.upiId : null,
      upiUri: method === 'UPI' && pay.upiId ? upiPayUri({ upiId: pay.upiId, payeeName: seller.name, amount: o.pricePaise, note: number }) : null,
      upiQrUrl: method === 'UPI' && pay.upiQrMediaId ? `/v1/buyer/orders/${o.id}/payment-qr` : null,
      bank: method === 'BANK' && pay.bankAccount ? { holder: pay.bankHolder ?? '', account: pay.bankAccount, ifsc: pay.bankIfsc ?? '', bankName: pay.bankName } : null,
      paymentLink: method === 'LINK' ? pay.paymentLink : null,
    };
  }

  private async buyerViews(rows: Joined[], userId: string): Promise<BuyerOrder[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.o.id);
    const sellerIds = [...new Set(rows.map((r) => r.seller.id))];
    const placedIds = [...new Set(rows.filter((r) => r.o.status === 'PLACED' && r.o.channel === 'DIRECT').map((r) => r.seller.id))];
    const [records, reviewsBy, threads, avail, pays] = await Promise.all([
      this.recordsFor(sellerIds),
      this.reviewViews(ids),
      this.chat.orderThreadInfo(this.db, ids, 'BUYER'),
      this.availability([...new Set(rows.map((r) => r.o.listingId))]),
      placedIds.length ? this.db.select().from(sellerPaymentProfiles).where(inArray(sellerPaymentProfiles.sellerId, placedIds)) : [],
    ]);
    const payBy = new Map(pays.map((p) => [p.sellerId, p]));
    return rows.map((j) => {
      const { o, seller } = j;
      const d = this.toDomain(o);
      const l = avail.listing.get(o.listingId);
      const t = threads.get(o.id);
      const contact: Contact | null = contactForOrder(o.status, { phone: seller.contactPhone, whatsapp: seller.contactWhatsapp });
      return {
        id: o.id,
        number: d.number,
        status: o.status,
        statusLabel: BUYER_LABEL[o.status](o.channel),
        listing: { id: o.listingId, title: o.listingTitle, coverUrl: o.coverMediaId ? publicMediaUrl(o.coverMediaId) : null, variantLabel: o.variantLabel, channel: o.channel },
        price: o.pricePaise,
        listPrice: o.listPricePaise,
        priceSource: o.priceSource,
        channel: o.channel,
        paymentMethod: o.paymentMethod,
        dealAccess: o.dealAccess ?? null,
        address: o.address ?? null,
        createdAt: o.createdAt.getTime(),
        confirmBy: o.confirmBy.getTime(),
        confirmedAt: toMs(o.confirmedAt),
        shipment: shipmentView(o.shipment ?? null),
        cancelText: cancelText(o),
        seller: {
          id: seller.id,
          name: seller.name,
          area: seller.area,
          slaConfirmHours: seller.slaConfirmHours,
          slaShipDays: seller.slaShipDays,
          record: records.get(seller.id)!,
          contact,
        },
        payment: this.paymentFor(j, payBy.get(seller.id)),
        review: reviewsBy.get(o.id) ?? null,
        canReview: canReviewOrder({ buyerId: o.buyerUserId, confirmedAt: toMs(o.confirmedAt) }, userId).ok,
        buyAgain: buyAgain(l ? { id: l.id, status: l.status, channel: l.channel } : null, o.variantId, avail.free(o.listingId)),
        threadId: t?.threadId ?? null,
        unread: t?.unread ?? 0,
      };
    });
  }

  async listForBuyer(userId: string): Promise<BuyerOrderList> {
    await this.catchUp(eq(orders.buyerUserId, userId));
    const items = await this.buyerViews(await this.joined(eq(orders.buyerUserId, userId), LIST_LIMIT), userId);
    return { items, unread: items.reduce((t, i) => t + i.unread, 0) };
  }

  async getForBuyer(userId: string, id: string): Promise<BuyerOrder> {
    await this.catchUp(and(eq(orders.id, id), eq(orders.buyerUserId, userId)));
    const rows = await this.joined(and(eq(orders.id, id), eq(orders.buyerUserId, userId)));
    if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
    return (await this.buyerViews(rows, userId))[0]!;
  }

  private async sellerViews(rows: Joined[]): Promise<SellerOrder[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.o.id);
    const open = [...new Set(rows.map((r) => r.o.buyerUserId))];
    const [reviewsBy, threads, contacts] = await Promise.all([
      this.reviewViews(ids),
      this.chat.orderThreadInfo(this.db, ids, 'SELLER'),
      this.db.select({ userId: buyerProfiles.userId, phone: buyerProfiles.contactPhone, whatsapp: buyerProfiles.contactWhatsapp }).from(buyerProfiles).where(inArray(buyerProfiles.userId, open)),
    ]);
    const contactBy = new Map(contacts.map((c) => [c.userId, { phone: c.phone, whatsapp: c.whatsapp }]));
    return rows.map(({ o, buyerName }) => {
      const t = threads.get(o.id);
      return {
        id: o.id,
        number: formatOrderNumber(o.seq),
        status: o.status,
        statusLabel: SELLER_LABEL[o.status](o.channel),
        listing: { id: o.listingId, title: o.listingTitle, coverUrl: o.coverMediaId ? publicMediaUrl(o.coverMediaId) : null, variantLabel: o.variantLabel, channel: o.channel },
        price: o.pricePaise,
        priceSource: o.priceSource,
        channel: o.channel,
        paymentMethod: o.paymentMethod,
        dealAccess: o.dealAccess ?? null,
        buyerName: buyerName?.trim() || 'Buyer',
        address: o.address ?? null,
        createdAt: o.createdAt.getTime(),
        confirmBy: o.confirmBy.getTime(),
        confirmedAt: toMs(o.confirmedAt),
        shipment: shipmentView(o.shipment ?? null),
        cancelText: cancelText(o),
        buyerContact: contactForOrder(o.status, contactBy.get(o.buyerUserId) ?? null),
        review: reviewsBy.get(o.id) ?? null,
        canConfirm: o.status === 'PLACED',
        canShip: o.status === 'CONFIRMED' || o.status === 'SHIPPED',
        canDeliver: o.status === 'CONFIRMED' || o.status === 'SHIPPED',
        canCancel: o.status === 'PLACED' || o.status === 'CONFIRMED',
        threadId: t?.threadId ?? null,
        unread: t?.unread ?? 0,
      };
    });
  }

  async listForSeller(userId: string): Promise<SellerOrderList> {
    const seller = await this.sellerOf(userId);
    await this.catchUp(eq(orders.sellerId, seller.id));
    const items = await this.sellerViews(await this.joined(eq(orders.sellerId, seller.id), LIST_LIMIT));
    return { items, needsConfirm: items.filter((i) => i.canConfirm).length, unread: items.reduce((t, i) => t + i.unread, 0) };
  }

  async getForSeller(userId: string, id: string): Promise<SellerOrder> {
    const seller = await this.sellerOf(userId);
    await this.catchUp(and(eq(orders.id, id), eq(orders.sellerId, seller.id)));
    const rows = await this.joined(and(eq(orders.id, id), eq(orders.sellerId, seller.id)));
    if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Order not found.');
    return (await this.sellerViews(rows))[0]!;
  }

  // ---------- the seller's private UPI QR, for the buyer's own PLACED order ----------
  /** The QR image for a direct UPI order that is still PLACED and belongs to this buyer. Anything else is "not found". */
  async paymentQr(userId: string, id: string): Promise<{ mime: string; size: number; stream: Readable }> {
    await this.catchUp(and(eq(orders.id, id), eq(orders.buyerUserId, userId)));
    const [o] = await this.db.select().from(orders).where(and(eq(orders.id, id), eq(orders.buyerUserId, userId))).limit(1);
    if (!o || !buyerMaySeePayment({ status: o.status, channel: o.channel }) || o.paymentMethod !== 'UPI') throw new AppError(404, 'NOT_FOUND', 'Not found.');
    const [pay] = await this.db.select({ id: sellerPaymentProfiles.upiQrMediaId }).from(sellerPaymentProfiles).where(eq(sellerPaymentProfiles.sellerId, o.sellerId)).limit(1);
    if (!pay?.id) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    const [m] = await this.db.select().from(media).where(and(eq(media.id, pay.id), eq(media.status, 'READY'))).limit(1);
    if (!m?.size) throw new AppError(404, 'NOT_FOUND', 'Not found.');
    return { mime: m.mime, size: m.size, stream: this.mediaService.openFile(m.storageKey) };
  }
}
