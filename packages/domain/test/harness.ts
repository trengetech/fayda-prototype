/**
 * In-memory reference implementation of the API's persistence layer, built only from the pure domain functions.
 * It plays the role the Nest + Postgres layer plays in production: load rows, call rules, write the result.
 * The scenario tests run against it so they exercise the real rules with a fake clock.
 * Prices in command arguments are whole rupees (as in the prototype); stored money is paise.
 */
import {
  DAY,
  acceptLatest,
  appendOffer,
  availableUnits,
  buyerListingView,
  buyerMaySeePayment,
  buyerNegotiationView,
  cancelOrder,
  confirmOrder,
  cleanDeal,
  decideAutomation,
  declineLatest,
  deliverOrder,
  directMethods,
  expireOrderIfDue,
  fail,
  invalidate,
  invalidationsForListingChange,
  latest,
  newOrder,
  publishStockError,
  rupeesToPaise,
  scheduleAutomation,
  shipOrder,
  startNegotiation,
  sweepNegotiation,
  validateCheckout,
  validateCounter,
  validateDealAccess,
  validateListingDraft,
  validateNewOffer,
  validatePayment,
  validatePlacement,
  visibilityFor,
  withdraw,
  type AutomationDecision,
  type BargainMode,
  type Channel,
  type DealAccess,
  type DealCodes,
  type Negotiation,
  type Notice,
  type Order,
  type PaymentInput,
  type PaymentProfile,
  type PayMethod,
  type PrivateRules,
  type Reservation,
  type Result,
  type ShipmentInput,
} from '../src/index.js';

export const NOW = Date.UTC(2026, 9, 30, 10, 0, 0);
export { DAY };

interface Variant {
  id: string;
  label: string;
  stock: number;
}
interface Listing {
  id: string;
  sellerId: string;
  ownerId: string;
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED';
  price: number;
  mode: BargainMode;
  expiryHours: number;
  channel: Channel;
  productUrl: string | null;
  title: string;
  description: string;
  category: string;
  variants: Variant[];
}
interface StoredReservation extends Reservation {
  id: string;
  negotiationId: string;
}
export interface LoggedNotice extends Notice {
  userId: string;
}

export interface Cmd {
  type: string;
  userId?: string;
  listingId?: string;
  variantId?: string;
  negotiationId?: string;
  orderId?: string;
  amount?: number;
  action?: 'ACCEPT' | 'DECLINE' | 'COUNTER';
  dealAccess?: Partial<DealAccess>;
  visibility?: 'PUBLIC' | 'PRIVATE';
  paymentMethod?: string;
  addressId?: string;
  shipment?: ShipmentInput;
  reason?: string;
  note?: string;
  status?: 'ACTIVE' | 'PAUSED';
  publish?: boolean;
  draft?: Draft;
}
export interface Draft {
  title?: string;
  description?: string;
  category?: string;
  price?: number;
  media?: unknown[];
  variants?: { id?: string; label?: string; stock?: number }[];
  bargaining?: { mode?: string; expiryHours?: number };
  rules?: { autoAcceptAt?: number | null; autoDeclineBelow?: number | null; autoCounterAt?: number | null };
  checkout?: { channel?: string; productUrl?: string };
  dealCodes?: { accept?: Partial<DealAccess>; counter?: Partial<DealAccess> };
}
type Out = Record<string, unknown> & { ok: boolean; code?: string };

export class World {
  seq = 0;
  orderSeq = 10000;
  listings = new Map<string, Listing>();
  rules = new Map<string, PrivateRules>();
  codes = new Map<string, DealCodes>();
  negs = new Map<string, Negotiation>();
  reservations = new Map<string, StoredReservation>();
  orders = new Map<string, Order>();
  payments = new Map<string, PaymentProfile>();
  sellers = new Map<string, { id: string; userId: string }>();
  addresses = new Set<string>();
  notices: LoggedNotice[] = [];

  private id = (p: string) => `${p}_${++this.seq}`;

  addSeller(userId: string, payment: PaymentInput): string {
    const sellerId = this.id('sl');
    this.sellers.set(sellerId, { id: sellerId, userId });
    this.payments.set(sellerId, validatePayment(payment).clean);
    return sellerId;
  }
  addBuyer(userId: string): string {
    const addressId = `ad_${userId}`;
    this.addresses.add(addressId);
    return addressId;
  }

  // ---------- helpers ----------
  private sellerOf = (userId?: string) => [...this.sellers.values()].find((s) => s.userId === userId);
  private available(l: Listing, v: Variant, now: number) {
    return availableUnits(v.stock, [...this.reservations.values()], v.id, now);
  }
  private notify(userId: string, ns: Notice[]) {
    ns.forEach((n) => this.notices.push({ ...n, userId }));
  }
  private notifyNeg(n: Negotiation, ns: Notice[]) {
    const l = this.listings.get(n.listingId) as Listing;
    ns.forEach((x) => this.notices.push({ ...x, userId: x.audience === 'buyer' ? n.buyerId : l.ownerId }));
  }
  private sweepCtx(l: Listing) {
    return {
      listPrice: l.price,
      expiryHours: l.expiryHours,
      channel: l.channel,
      rules: this.rules.get(l.id) as PrivateRules,
      codes: this.codes.get(l.id) ?? {},
      newOfferId: () => this.id('of'),
    };
  }
  private invalidateIfSoldOut(l: Listing, v: Variant, now: number, exceptId?: string) {
    if (this.available(l, v, now) > 0) return;
    this.invalidateWhere((n) => n.variantId === v.id && n.id !== exceptId, 'SOLD_OUT', now);
  }
  private invalidateWhere(pred: (n: Negotiation) => boolean, reason: 'SOLD_OUT' | 'FIXED_PRICE' | 'PRICE_DROPPED' | 'LISTING_PAUSED', now: number) {
    [...this.negs.values()].filter((n) => n.status === 'OPEN' && pred(n)).forEach((n) => this.applyInvalidation(n, reason, now));
  }
  private applyInvalidation(n: Negotiation, reason: 'SOLD_OUT' | 'FIXED_PRICE' | 'PRICE_DROPPED' | 'LISTING_PAUSED', now: number) {
    const r = invalidate(n, reason, now);
    this.negs.set(n.id, r.negotiation);
    this.notifyNeg(n, r.notices);
  }
  private release(reservationId: string | undefined) {
    const r = reservationId ? this.reservations.get(reservationId) : undefined;
    if (r && r.status === 'ACTIVE') r.status = 'RELEASED';
  }

  // ---------- sweep ----------
  sweep(now: number) {
    for (const n of [...this.negs.values()]) {
      const l = this.listings.get(n.listingId) as Listing;
      const out = sweepNegotiation(n, now, this.sweepCtx(l));
      if (!out.changed) continue;
      this.negs.set(n.id, out.negotiation);
      this.notifyNeg(n, out.notices);
      if (out.releaseReservation) {
        const rs = [...this.reservations.values()].find((r) => r.negotiationId === n.id && r.status === 'ACTIVE');
        this.release(rs?.id);
      }
    }
    this.reservations.forEach((r) => {
      if (r.status === 'ACTIVE' && r.expiresAt <= now) r.status = 'RELEASED';
    });
    for (const o of [...this.orders.values()]) {
      const t = expireOrderIfDue(o, now);
      if (!t) continue;
      this.orders.set(o.id, t.order);
      if (t.restock) this.restock(o);
      this.notifyOrder(o, t.notices);
    }
  }
  private restock(o: Order) {
    const l = this.listings.get(o.listingId);
    const v = l?.variants.find((x) => x.id === o.variantId);
    if (v) v.stock += 1;
  }
  private notifyOrder(o: Order, ns: Notice[]) {
    const l = this.listings.get(o.listingId) as Listing;
    ns.forEach((x) => this.notices.push({ ...x, userId: x.audience === 'buyer' ? o.buyerId : l.ownerId }));
  }

  // ---------- commands ----------
  exec(c: Cmd, now: number): Out {
    this.sweep(now);
    const r = this.handle(c, now) as Out;
    if (r.ok) this.sweep(now);
    return r;
  }

  private handle(c: Cmd, now: number): Result<Record<string, unknown>> {
    switch (c.type) {
      case 'system.sweep':
        return { ok: true };
      case 'listing.save':
        return this.saveListing(c, now);
      case 'listing.setStatus':
        return this.setStatus(c, now);
      case 'offer.make':
        return this.offerMake(c, now);
      case 'offer.respond':
        return this.offerRespond(c, now);
      case 'offer.withdraw':
        return this.offerWithdraw(c, now);
      case 'order.place':
        return this.orderPlace(c, now);
      case 'order.confirm':
      case 'order.ship':
      case 'order.deliver':
      case 'order.cancel':
        return this.orderMove(c, now);
      default:
        return fail('UNKNOWN_COMMAND', 'Unknown command.');
    }
  }

  private saveListing(c: Cmd, now: number): Result<Record<string, unknown>> {
    const seller = this.sellerOf(c.userId);
    if (!seller) return fail('NO_SELLER', 'Register your shop first.');
    const d = c.draft ?? {};
    const toP = (x: number | null | undefined) => (x == null ? null : rupeesToPaise(x));
    const paise = {
      ...d,
      price: d.price == null ? undefined : rupeesToPaise(d.price),
      rules: { autoAcceptAt: toP(d.rules?.autoAcceptAt), autoDeclineBelow: toP(d.rules?.autoDeclineBelow), autoCounterAt: toP(d.rules?.autoCounterAt) },
    };
    const { errors, rules } = validateListingDraft(paise);
    if (c.publish && !errors.variants) {
      const m = publishStockError(d.variants);
      if (m) errors.variants = m;
    }
    const co = d.checkout ?? { channel: 'DIRECT' };
    const dealCodes: DealCodes = { accept: d.dealCodes?.accept as DealAccess | undefined, counter: d.dealCodes?.counter as DealAccess | undefined };
    Object.assign(errors, validateCheckout({ channel: co.channel, productUrl: co.productUrl, mode: d.bargaining?.mode, rules, dealCodes, payment: this.payments.get(seller.id) ?? null }));
    if (Object.keys(errors).length) return fail('VALIDATION', 'Check the highlighted fields.', errors);

    let l = c.listingId ? this.listings.get(c.listingId) : undefined;
    if (c.listingId && (!l || l.sellerId !== seller.id)) return fail('NOT_FOUND', 'Listing not found.');
    const oldPrice = l?.price ?? null;
    const oldMode = l?.mode ?? null;
    const oldVariants = l?.variants ?? [];
    const mode = d.bargaining?.mode as BargainMode;
    const variants: Variant[] = (d.variants ?? []).map((v) => ({
      id: v.id && oldVariants.some((o) => o.id === v.id) ? v.id : this.id('vr'),
      label: String(v.label).trim(),
      stock: Number(v.stock),
    }));
    if (!l) {
      l = { id: this.id('ls'), sellerId: seller.id, ownerId: seller.userId, status: 'DRAFT' } as Listing;
      this.listings.set(l.id, l);
    }
    Object.assign(l, {
      title: String(d.title).trim(),
      description: String(d.description ?? '').trim(),
      category: d.category,
      price: paise.price as number,
      mode,
      expiryHours: Number(d.bargaining?.expiryHours),
      variants,
      channel: co.channel === 'WEBSITE' ? 'WEBSITE' : 'DIRECT',
      productUrl: co.channel === 'WEBSITE' ? String(co.productUrl).trim() : null,
    });
    this.rules.set(l.id, rules);
    this.codes.set(
      l.id,
      co.channel === 'WEBSITE' && mode !== 'FIXED'
        ? { accept: rules.autoAcceptAt != null ? cleanDeal(dealCodes.accept) : null, counter: rules.autoCounterAt != null ? cleanDeal(dealCodes.counter) : null }
        : {},
    );
    if (c.publish && l.status !== 'ACTIVE') l.status = 'ACTIVE';
    const open = [...this.negs.values()].filter((n) => n.listingId === l.id && n.status === 'OPEN');
    const removed = oldVariants.filter((o) => !variants.some((v) => v.id === o.id)).map((o) => o.id);
    const listing = l;
    invalidationsForListingChange(
      { oldPrice, newPrice: listing.price, oldMode, newMode: mode, removedVariantIds: removed },
      open.map((n) => ({ id: n.id, variantId: n.variantId, latestAmount: latest(n).amount })),
    ).forEach(({ id, reason }) => this.applyInvalidation(this.negs.get(id) as Negotiation, reason as 'SOLD_OUT' | 'FIXED_PRICE' | 'PRICE_DROPPED', now));
    listing.variants.forEach((v) => this.invalidateIfSoldOut(listing, v, now));
    return { ok: true, listingId: listing.id };
  }

  private setStatus(c: Cmd, now: number): Result<Record<string, unknown>> {
    const seller = this.sellerOf(c.userId);
    const l = this.listings.get(c.listingId ?? '');
    if (!seller || !l || l.sellerId !== seller.id) return fail('NOT_FOUND', 'Listing not found.');
    if (c.status !== 'ACTIVE' && c.status !== 'PAUSED') return fail('INVALID_STATUS', 'Unsupported status.');
    if (c.status === 'ACTIVE' && l.variants.reduce((t, v) => t + v.stock, 0) < 1) return fail('NO_STOCK', 'Add stock before resuming this listing.');
    l.status = c.status;
    if (c.status === 'PAUSED') this.invalidateWhere((n) => n.listingId === l.id, 'LISTING_PAUSED', now);
    return { ok: true };
  }

  private applyAutomationDecision(n: Negotiation, l: Listing, d: AutomationDecision | null, now: number): Negotiation {
    if (!d) return n;
    const v = l.variants.find((x) => x.id === n.variantId) as Variant;
    const codes = this.codes.get(l.id) ?? {};
    const rules = this.rules.get(l.id) as PrivateRules;
    if (d.kind === 'ACCEPT') {
      const r = acceptLatest(n, 'SYSTEM', now, { channel: l.channel, availableUnits: this.available(l, v, now), price: d.price, dealAccess: d.dealAccess });
      if (r.ok) {
        this.addReservation(v.id, n.id, r.reserveUntil);
        this.notifyNeg(n, r.notices);
        return r.negotiation;
      }
      return this.applyAutomationDecision(n, l, decideAutomation(n, rules, { channel: l.channel, listPrice: l.price, now, codes, skipAccept: true }), now);
    }
    if (d.kind === 'NOTIFY_SELLER') {
      this.notifyNeg(n, [{ audience: 'seller', code: 'NEW_OFFER', at: now }]);
      return n;
    }
    return scheduleAutomation(n, d);
  }
  private addReservation(variantId: string, negotiationId: string, expiresAt: number) {
    const id = this.id('rs');
    this.reservations.set(id, { id, variantId, negotiationId, status: 'ACTIVE', expiresAt });
  }

  private offerMake(c: Cmd, now: number): Result<Record<string, unknown>> {
    const l = this.listings.get(c.listingId ?? '');
    if (!l) return fail('NOT_AVAILABLE', 'This listing isn’t available.');
    const v = l.variants.find((x) => x.id === c.variantId);
    const mine = [...this.negs.values()].filter((n) => n.buyerId === c.userId && n.listingId === l.id);
    const amount = rupeesToPaise(c.amount as number);
    const check = validateNewOffer({
      listingActive: l.status === 'ACTIVE',
      isOwnListing: l.ownerId === c.userId,
      mode: l.mode,
      variantExists: !!v,
      availableUnits: v ? this.available(l, v, now) : 0,
      listPrice: l.price,
      amount,
      hasOpenForVariant: mine.some((n) => n.variantId === c.variantId && (n.status === 'OPEN' || n.status === 'AGREED')),
      startedLast24h: mine.filter((n) => n.createdAt > now - DAY).length,
    });
    if (!check.ok) return check;
    let n = startNegotiation({ id: this.id('ng'), listingId: l.id, variantId: (v as Variant).id, buyerId: c.userId as string, visibility: visibilityFor(l.mode, c.visibility) }, now);
    n = appendOffer(n, { id: this.id('of'), by: 'BUYER', amount }, now, l.expiryHours);
    n = this.runAutomation(n, l, now);
    this.negs.set(n.id, n);
    if (n.status === 'AGREED') this.invalidateIfSoldOut(l, v as Variant, now, n.id);
    return { ok: true, negotiationId: n.id };
  }
  private runAutomation(n: Negotiation, l: Listing, now: number): Negotiation {
    const d = decideAutomation(n, this.rules.get(l.id) as PrivateRules, { channel: l.channel, listPrice: l.price, now, codes: this.codes.get(l.id) ?? {} });
    return this.applyAutomationDecision(n, l, d, now);
  }

  private offerRespond(c: Cmd, now: number): Result<Record<string, unknown>> {
    const n = this.negs.get(c.negotiationId ?? '');
    if (!n) return fail('NOT_FOUND', 'Negotiation not found.');
    const l = this.listings.get(n.listingId) as Listing;
    const side = c.userId === n.buyerId ? 'BUYER' : c.userId === l.ownerId ? 'SELLER' : null;
    if (!side) return fail('FORBIDDEN', 'You’re not part of this negotiation.');
    const last = latest(n);
    if (n.status !== 'OPEN' || last.status !== 'PENDING') return fail('NOT_OPEN', 'This negotiation is no longer open.');
    if ((last.by === 'BUYER' ? 'BUYER' : 'SELLER') === side) return fail('NOT_YOUR_TURN', 'Wait for the other side to respond.');
    const v = l.variants.find((x) => x.id === n.variantId) as Variant;
    const website = l.channel === 'WEBSITE';
    if (c.action === 'ACCEPT') {
      let dealAccess: DealAccess | null = null;
      if (website && side === 'SELLER') {
        const m = validateDealAccess(c.dealAccess, 'Code or link');
        if (m) return fail('DEAL_ACCESS_REQUIRED', m, { dealAccess: m });
        dealAccess = cleanDeal(c.dealAccess as DealAccess);
      }
      const r = acceptLatest(n, side, now, { channel: l.channel, availableUnits: this.available(l, v, now), dealAccess });
      if (!r.ok) return r;
      this.negs.set(n.id, r.negotiation);
      this.addReservation(v.id, n.id, r.reserveUntil);
      this.notifyNeg(n, r.notices);
      this.invalidateIfSoldOut(l, v, now, n.id);
      return { ok: true };
    }
    if (c.action === 'DECLINE') {
      const r = declineLatest(n, side, now);
      if (!r.ok) return r;
      this.negs.set(n.id, r.negotiation);
      this.notifyNeg(n, [r.notice]);
      return { ok: true };
    }
    if (c.action === 'COUNTER') {
      const amount = rupeesToPaise(c.amount as number);
      const ok = validateCounter(n, side, amount, l.price);
      if (!ok.ok) return ok;
      let dealAccess: DealAccess | null = null;
      if (website && side === 'SELLER') {
        const m = validateDealAccess(c.dealAccess, 'Code or link for your counter');
        if (m) return fail('DEAL_ACCESS_REQUIRED', m, { dealAccess: m });
        dealAccess = cleanDeal(c.dealAccess as DealAccess);
      }
      let next = appendOffer(n, { id: this.id('of'), by: side, amount, dealAccess }, now, l.expiryHours);
      if (side === 'SELLER') this.notifyNeg(n, [{ audience: 'buyer', code: 'SELLER_COUNTERED', at: now, params: { amount } }]);
      else next = this.runAutomation(next, l, now);
      this.negs.set(n.id, next);
      return { ok: true };
    }
    return fail('INVALID_ACTION', 'Unknown action.');
  }

  private offerWithdraw(c: Cmd, now: number): Result<Record<string, unknown>> {
    const n = this.negs.get(c.negotiationId ?? '');
    if (!n || n.buyerId !== c.userId) return fail('NOT_FOUND', 'Negotiation not found.');
    const r = withdraw(n, now);
    if (!r.ok) return r;
    this.negs.set(n.id, r.negotiation);
    this.notifyNeg(n, [r.notice]);
    return { ok: true };
  }

  private orderPlace(c: Cmd, now: number): Result<Record<string, unknown>> {
    const n = c.negotiationId ? this.negs.get(c.negotiationId) : undefined;
    if (c.negotiationId && !n) return fail('NOT_FOUND', 'Agreement not found.');
    const l = this.listings.get(n ? n.listingId : (c.listingId ?? ''));
    if (!l) return fail('NOT_AVAILABLE', 'This listing isn’t available.');
    const v = l.variants.find((x) => x.id === (n ? n.variantId : c.variantId));
    const check = validatePlacement({
      agreement: n ? { status: n.status, belongsToBuyer: n.buyerId === c.userId } : null,
      listingActive: l.status === 'ACTIVE',
      isOwnListing: l.ownerId === c.userId,
      channel: l.channel,
      variantExists: !!v,
      availableUnits: v ? this.available(l, v, now) : 0,
      addressOk: !!c.addressId && this.addresses.has(c.addressId),
      paymentMethod: c.paymentMethod as PayMethod | undefined,
      sellerPayment: this.payments.get(l.sellerId) ?? null,
    });
    if (!check.ok) return check;
    const variant = v as Variant;
    if (n) {
      const rs = [...this.reservations.values()].find((r) => r.negotiationId === n.id && r.status === 'ACTIVE');
      if (rs) rs.status = 'CONSUMED';
      this.negs.set(n.id, {
        ...n,
        status: 'PURCHASED',
        closeReason: 'PURCHASED',
        updatedAt: now,
        events: [...n.events, { type: 'PURCHASED', actor: 'BUYER', at: now }],
      });
    }
    variant.stock -= 1;
    const order = newOrder({
      id: this.id('or'),
      number: 'FY-' + ++this.orderSeq,
      buyerId: c.userId as string,
      sellerId: l.sellerId,
      listingId: l.id,
      variantId: variant.id,
      price: n?.agreement ? n.agreement.price : l.price,
      listPrice: l.price,
      priceSource: check.priceSource,
      negotiationId: n?.id ?? null,
      channel: l.channel,
      paymentMethod: l.channel === 'DIRECT' ? (c.paymentMethod as PayMethod) : null,
      dealAccess: n?.agreement?.dealAccess ?? null,
      now,
    });
    this.orders.set(order.id, order);
    this.notifyOrder(order, [
      { audience: 'buyer', code: 'ORDER_PLACED', at: now },
      { audience: 'seller', code: 'NEW_ORDER', at: now },
    ]);
    this.invalidateIfSoldOut(l, variant, now);
    return { ok: true, orderId: order.id, url: l.channel === 'WEBSITE' ? l.productUrl : null };
  }

  private orderMove(c: Cmd, now: number): Result<Record<string, unknown>> {
    const o = this.orders.get(c.orderId ?? '');
    const l = o && this.listings.get(o.listingId);
    if (!o || !l || l.ownerId !== c.userId) return fail('NOT_FOUND', 'Order not found.');
    const r =
      c.type === 'order.confirm'
        ? confirmOrder(o, c.shipment, now)
        : c.type === 'order.ship'
          ? shipOrder(o, c.shipment ?? {}, now)
          : c.type === 'order.deliver'
            ? deliverOrder(o, now)
            : cancelOrder(o, c.reason ?? '', c.note, now);
    if (!r.ok) return r;
    this.orders.set(o.id, r.order);
    if (r.restock) this.restock(o);
    this.notifyOrder(o, r.notices);
    return { ok: true };
  }

  // ---------- read models ----------
  buyerNegotiation(userId: string, id: string) {
    const n = this.negs.get(id);
    if (!n || n.buyerId !== userId) return null;
    return buyerNegotiationView(n, (this.listings.get(n.listingId) as Listing).channel);
  }
  buyerListing(listingId: string, now: number) {
    const l = this.listings.get(listingId) as Listing;
    return buyerListingView(
      { id: l.id, sellerId: l.sellerId, title: l.title, description: l.description, category: l.category, price: l.price, status: l.status, mode: l.mode, expiryHours: l.expiryHours, channel: l.channel, productUrl: l.productUrl, variants: l.variants },
      Object.fromEntries(l.variants.map((v) => [v.id, this.available(l, v, now)])),
    );
  }
  buyerOrder(userId: string, id: string) {
    const o = this.orders.get(id);
    if (!o || o.buyerId !== userId) return null;
    const pay = this.payments.get(o.sellerId);
    return {
      id: o.id,
      status: o.status,
      payTo: buyerMaySeePayment(o) && pay ? { upiId: pay.upiId, bank: pay.bankAccount ? { account: pay.bankAccount, ifsc: pay.bankIfsc } : null, methods: directMethods(pay) } : undefined,
    };
  }
}
