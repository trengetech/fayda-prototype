import { Inject, Injectable } from '@nestjs/common';
import type { BuyerFeed, BuyerListing, ListingInput, SellerListing } from '@fayda/contracts';
import {
  buyerListingView,
  cleanPayment,
  directMethods,
  cleanDeal,
  publishStockError,
  validateCheckout,
  validateListingDraft,
  validateTags,
  type Clock,
  type ListingDraft,
  type PaymentProfile,
  type PublicListing,
} from '@fayda/domain';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { DbService } from '../db/db.service.js';
import { follows, listingMedia, listingVariants, listings, media, sellerPaymentProfiles, sellers } from '../db/schema.js';
import { publicMediaUrl } from '../media/media.service.js';
import type { NegotiationTouch } from '../negotiations/negotiation-events.js';
import { NegotiationsService } from '../negotiations/negotiations.service.js';
import { socialCounts } from '../social/social-counts.js';
import { andAll, encodeFeedCursor, feedAfter, feedConditions, feedOrder, type FeedRequest } from './feed-query.js';
import { ChatService } from '../chat/chat.service.js';
import { loadSellerStats, sellerRatings } from '../community/shared.js';

type ListingRow = typeof listings.$inferSelect;
type MediaItem = { mediaId: string; kind: 'image' | 'video'; url: string; posterMediaId: string | null; posterUrl: string | null };

const invalid = (fields: Record<string, string>): AppError => new AppError(400, 'VALIDATION', 'Check the highlighted fields.', fields);
const FEED_PAGE = 20;
export const MAX_FEED_PAGE = 50;

/** What a feed card needs from the database. Public columns only. */
const CARD_COLUMNS = {
  id: listings.id,
  title: listings.title,
  category: listings.category,
  pricePaise: listings.pricePaise,
  bargainMode: listings.bargainMode,
  publishedAt: listings.publishedAt,
  sellerId: sellers.id,
  sellerUserId: sellers.userId,
  sellerName: sellers.name,
  sellerHandle: sellers.handle,
  sellerArea: sellers.area,
  sellerCity: sellers.city,
};
interface CardRow {
  id: string;
  title: string;
  category: string;
  pricePaise: number;
  bargainMode: 'BUY_NOW' | 'BOTH';
  publishedAt: Date | null;
  sellerId: string;
  sellerUserId: string;
  sellerName: string;
  sellerHandle: string;
  sellerArea: string;
  sellerCity: string;
}

@Injectable()
export class ListingsService {
  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NegotiationsService) private readonly negotiations: NegotiationsService,
    @Inject(ChatService) private readonly chat: ChatService,
  ) {}

  private get db() {
    return this.database.db;
  }

  private async requireSeller(userId: string): Promise<{ id: string }> {
    const [s] = await this.db.select({ id: sellers.id }).from(sellers).where(eq(sellers.userId, userId)).limit(1);
    if (!s) throw new AppError(403, 'NO_SELLER', 'Set up your shop first.');
    return s;
  }

  // ---------- seller: write ----------
  /** Creates (no `listingId`) or updates a listing. Draft and publish share the prototype's validation; publish adds the stock rule. */
  async save(userId: string, listingId: string | null, input: ListingInput): Promise<SellerListing> {
    const seller = await this.requireSeller(userId);
    const [payRow] = await this.db.select().from(sellerPaymentProfiles).where(eq(sellerPaymentProfiles.sellerId, seller.id)).limit(1);
    const payment: PaymentProfile | null = payRow
      ? { upiId: payRow.upiId, upiQrMediaId: payRow.upiQrMediaId, bankHolder: payRow.bankHolder, bankAccount: payRow.bankAccount, bankIfsc: payRow.bankIfsc, bankName: payRow.bankName, paymentLink: payRow.paymentLink, website: payRow.website }
      : null;

    const draft: ListingDraft = {
      title: input.title,
      description: input.description ?? '',
      category: input.category,
      price: input.price,
      media: input.media,
      ...(input.tags ? { tags: input.tags } : {}),
      variants: input.variants.map((v) => ({ ...(v.id ? { id: v.id } : {}), label: v.label, stock: v.stock })),
      bargaining: input.bargaining,
      rules: { autoAcceptAt: input.rules?.autoAcceptAt ?? null, autoDeclineBelow: input.rules?.autoDeclineBelow ?? null, autoCounterAt: input.rules?.autoCounterAt ?? null },
    };
    const { errors, rules } = validateListingDraft(draft);
    if (input.publish && !errors.variants) {
      const m = publishStockError(draft.variants);
      if (m) errors.variants = m;
    }
    Object.assign(errors, validateCheckout({ channel: input.checkout.channel, productUrl: input.checkout.productUrl ?? undefined, mode: input.bargaining.mode, rules, dealCodes: input.dealCodes ?? null, payment }));
    if (!errors.media) {
      const m = await this.checkMedia(userId, input.media);
      if (m) errors.media = m;
    }
    if (Object.keys(errors).length) throw invalid(errors);

    const now = new Date(this.clock.now());
    const website = input.checkout.channel === 'WEBSITE';
    const withCodes = website && input.bargaining.mode === 'BOTH';
    const channel = input.checkout.channel as 'DIRECT' | 'WEBSITE';
    const fields = {
      title: input.title.trim(),
      description: (input.description ?? '').trim(),
      category: input.category,
      // Omitted tags keep what the listing has; sent tags replace them (cleaned the same way the check cleaned them).
      ...(input.tags ? { tags: validateTags(input.tags).tags } : {}),
      pricePaise: input.price,
      bargainMode: input.bargaining.mode as 'BUY_NOW' | 'BOTH',
      expiryMinutes: input.bargaining.expiryMinutes,
      channel,
      productUrl: website ? (input.checkout.productUrl ?? '').trim() : null,
      autoAcceptAt: rules.autoAcceptAt,
      autoDeclineBelow: rules.autoDeclineBelow,
      autoCounterAt: rules.autoCounterAt,
      dealAccept: withCodes && rules.autoAcceptAt != null ? cleanDeal(input.dealCodes?.accept) : null,
      dealCounter: withCodes && rules.autoCounterAt != null ? cleanDeal(input.dealCodes?.counter) : null,
      updatedAt: now,
    };

    const touched: NegotiationTouch[] = [];
    const id = await this.db.transaction(async (tx) => {
      let current: ListingRow | undefined;
      if (listingId) {
        [current] = await tx.select().from(listings).where(and(eq(listings.id, listingId), eq(listings.sellerId, seller.id))).for('update');
        if (!current) throw new AppError(404, 'NOT_FOUND', 'Listing not found.');
      }
      // As in the prototype: publishing a draft or a paused listing makes it live; a plain save keeps the status.
      const status = current ? (input.publish && current.status !== 'ACTIVE' ? 'ACTIVE' : current.status) : input.publish ? 'ACTIVE' : 'DRAFT';
      const publishedAt = status === 'ACTIVE' ? (current?.publishedAt ?? now) : (current?.publishedAt ?? null);
      let rowId: string;
      if (current) {
        rowId = current.id;
        await tx.update(listings).set({ ...fields, status, publishedAt }).where(eq(listings.id, rowId));
      } else {
        const [created] = await tx.insert(listings).values({ ...fields, sellerId: seller.id, status, publishedAt }).returning({ id: listings.id });
        rowId = created!.id;
      }

      await tx.delete(listingMedia).where(eq(listingMedia.listingId, rowId));
      if (input.media.length) {
        const kinds = await this.kindsOf(tx, input.media.map((m) => m.mediaId));
        await tx.insert(listingMedia).values(input.media.map((m, position) => ({ listingId: rowId, position, mediaId: m.mediaId, posterMediaId: kinds.get(m.mediaId) === 'video' ? (m.posterMediaId ?? null) : null })));
      }

      // Sizes keep their id when the seller edits them, so later offers and orders can point at one.
      const existing = await tx.select({ id: listingVariants.id }).from(listingVariants).where(eq(listingVariants.listingId, rowId));
      const known = new Set(existing.map((v) => v.id));
      const kept = new Set<string>();
      for (const [position, v] of input.variants.entries()) {
        const label = v.label.trim();
        if (v.id && known.has(v.id)) {
          kept.add(v.id);
          await tx.update(listingVariants).set({ position, label, stock: v.stock }).where(eq(listingVariants.id, v.id));
        } else {
          await tx.insert(listingVariants).values({ listingId: rowId, position, label, stock: v.stock });
        }
      }
      const drop = [...known].filter((x) => !kept.has(x));
      // Offers on a size that is going away close first (and are kept, since negotiations have no link to the size row).
      if (current) {
        const clockNow = this.clock.now();
        await this.negotiations.onListingChanged(
          tx,
          rowId,
          { oldPrice: current.pricePaise, newPrice: fields.pricePaise, oldMode: current.bargainMode, newMode: fields.bargainMode, removedVariantIds: drop, paused: false },
          clockNow,
          touched,
        );
      }
      if (drop.length) await tx.delete(listingVariants).where(inArray(listingVariants.id, drop));
      // A size whose stock was lowered to what is already held, or to zero, can no longer honour open offers.
      if (current) await this.negotiations.closeSoldOutSizes(tx, rowId, this.clock.now(), touched);
      return rowId;
    });
    this.negotiations.publish(touched);
    // "Create listing from a request": once it is live, show it in the chat with the buyer who wanted it. A response that is not
    // WANTED, not this seller's, or already used simply does nothing; the listing itself is saved either way.
    if (input.fromResponseId) await this.chat.shareListingFromResponse(seller.id, input.fromResponseId, id);
    return this.getForSeller(userId, id);
  }

  private async kindsOf(db: Pick<DbService['db'], 'select'>, ids: string[]): Promise<Map<string, 'image' | 'video'>> {
    const rows = await db.select({ id: media.id, kind: media.kind }).from(media).where(inArray(media.id, ids));
    return new Map(rows.map((r) => [r.id, r.kind]));
  }

  /** Every file must be this seller's own finished listing upload; a video needs a poster photo. Returns a message, or null when fine. */
  private async checkMedia(userId: string, items: ListingInput['media']): Promise<string | null> {
    if (!items.length) return null;
    const wanted = new Set<string>();
    for (const m of items) {
      if (wanted.has(m.mediaId)) return 'Each photo or video can be added once.';
      wanted.add(m.mediaId);
    }
    const posterIds = items.map((m) => m.posterMediaId).filter((x): x is string => !!x);
    const rows = await this.db.select().from(media).where(inArray(media.id, [...wanted, ...posterIds]));
    const byId = new Map(rows.map((r) => [r.id, r]));
    const usable = (id: string | null | undefined, kind?: 'image' | 'video') => {
      const r = id ? byId.get(id) : undefined;
      return !!r && r.ownerUserId === userId && r.purpose === 'LISTING' && r.status === 'READY' && (!kind || r.kind === kind);
    };
    for (const m of items) {
      if (!usable(m.mediaId)) return 'One of the files is missing or has not finished uploading. Upload it again.';
      if (byId.get(m.mediaId)!.kind === 'video' && !usable(m.posterMediaId, 'image')) return 'Every video needs a cover photo. Pick the video again.';
    }
    return null;
  }

  async setStatus(userId: string, listingId: string, status: 'ACTIVE' | 'PAUSED'): Promise<SellerListing> {
    const seller = await this.requireSeller(userId);
    const touched: NegotiationTouch[] = [];
    await this.db.transaction(async (tx) => {
      const [l] = await tx.select().from(listings).where(and(eq(listings.id, listingId), eq(listings.sellerId, seller.id))).for('update');
      if (!l) throw new AppError(404, 'NOT_FOUND', 'Listing not found.');
      if (l.status === 'DRAFT') throw new AppError(409, 'INVALID_STATE', 'Publish the draft first.');
      if (status === 'ACTIVE') {
        const [total] = await tx.select({ n: sql<number>`coalesce(sum(${listingVariants.stock}), 0)::int` }).from(listingVariants).where(eq(listingVariants.listingId, l.id));
        if ((total?.n ?? 0) < 1) throw new AppError(422, 'NO_STOCK', 'Add stock before resuming this listing.');
      }
      const now = new Date(this.clock.now());
      await tx.update(listings).set({ status, updatedAt: now, publishedAt: l.publishedAt ?? now }).where(eq(listings.id, l.id));
      if (status === 'PAUSED') {
        await this.negotiations.onListingChanged(tx, l.id, { oldPrice: l.pricePaise, newPrice: l.pricePaise, oldMode: l.bargainMode, newMode: l.bargainMode, removedVariantIds: [], paused: true }, now.getTime(), touched);
      }
    });
    this.negotiations.publish(touched);
    return this.getForSeller(userId, listingId);
  }

  async deleteDraft(userId: string, listingId: string): Promise<void> {
    const seller = await this.requireSeller(userId);
    await this.db.transaction(async (tx) => {
      const [l] = await tx.select().from(listings).where(and(eq(listings.id, listingId), eq(listings.sellerId, seller.id))).for('update');
      if (!l) throw new AppError(404, 'NOT_FOUND', 'Listing not found.');
      if (l.status !== 'DRAFT') throw new AppError(409, 'NOT_DRAFT', 'Only drafts can be deleted. Pause a published listing instead.');
      await tx.delete(listings).where(eq(listings.id, l.id));
    });
  }

  // ---------- seller: read ----------
  async listForSeller(userId: string): Promise<SellerListing[]> {
    const seller = await this.requireSeller(userId);
    const rows = await this.db.select().from(listings).where(eq(listings.sellerId, seller.id)).orderBy(desc(listings.updatedAt), desc(listings.id));
    return this.sellerViews(rows);
  }

  async getForSeller(userId: string, listingId: string): Promise<SellerListing> {
    const seller = await this.requireSeller(userId);
    const rows = await this.db.select().from(listings).where(and(eq(listings.id, listingId), eq(listings.sellerId, seller.id))).limit(1);
    if (!rows.length) throw new AppError(404, 'NOT_FOUND', 'Listing not found.');
    return (await this.sellerViews(rows))[0]!;
  }

  private async mediaOf(ids: string[]): Promise<Map<string, MediaItem[]>> {
    const out = new Map<string, MediaItem[]>();
    if (!ids.length) return out;
    const rows = await this.db
      .select({ listingId: listingMedia.listingId, mediaId: listingMedia.mediaId, posterMediaId: listingMedia.posterMediaId, kind: media.kind })
      .from(listingMedia)
      .innerJoin(media, eq(media.id, listingMedia.mediaId))
      .where(inArray(listingMedia.listingId, ids))
      .orderBy(listingMedia.listingId, listingMedia.position);
    for (const r of rows) {
      const list = out.get(r.listingId) ?? [];
      list.push({ mediaId: r.mediaId, kind: r.kind, url: publicMediaUrl(r.mediaId), posterMediaId: r.posterMediaId, posterUrl: r.posterMediaId ? publicMediaUrl(r.posterMediaId) : null });
      out.set(r.listingId, list);
    }
    return out;
  }

  private async variantsOf(ids: string[]): Promise<Map<string, { id: string; label: string; stock: number }[]>> {
    const out = new Map<string, { id: string; label: string; stock: number }[]>();
    if (!ids.length) return out;
    const rows = await this.db.select().from(listingVariants).where(inArray(listingVariants.listingId, ids)).orderBy(listingVariants.listingId, listingVariants.position);
    for (const v of rows) {
      const list = out.get(v.listingId) ?? [];
      list.push({ id: v.id, label: v.label, stock: v.stock });
      out.set(v.listingId, list);
    }
    return out;
  }

  private async sellerViews(rows: ListingRow[]): Promise<SellerListing[]> {
    const ids = rows.map((r) => r.id);
    const [mediaBy, variantsBy, social] = await Promise.all([this.mediaOf(ids), this.variantsOf(ids), socialCounts(this.db, null, ids)]);
    return rows.map((l) => ({
      id: l.id,
      status: l.status,
      title: l.title,
      description: l.description,
      category: l.category,
      tags: l.tags,
      price: l.pricePaise,
      media: mediaBy.get(l.id) ?? [],
      variants: variantsBy.get(l.id) ?? [],
      bargaining: { mode: l.bargainMode, expiryMinutes: l.expiryMinutes },
      rules: { autoAcceptAt: l.autoAcceptAt, autoDeclineBelow: l.autoDeclineBelow, autoCounterAt: l.autoCounterAt },
      checkout: { channel: l.channel, productUrl: l.productUrl },
      dealCodes: { accept: l.dealAccept ?? null, counter: l.dealCounter ?? null },
      publishedAt: l.publishedAt ? l.publishedAt.getTime() : null,
      updatedAt: l.updatedAt.getTime(),
      stats: { likes: social.get(l.id)!.likeCount, saves: social.get(l.id)!.saveCount, comments: social.get(l.id)!.commentCount },
    }));
  }

  // ---------- buyer ----------
  /**
   * Live listings, newest first. Only public columns are read, and the response is built from buyer schemas, so private
   * rules and deal codes cannot appear. Until offers exist (M3.3) every unit in stock is available.
   */
  async feed(req: FeedRequest, limit = FEED_PAGE): Promise<BuyerFeed> {
    const take = Math.min(Math.max(limit, 1), MAX_FEED_PAGE);
    const conditions = feedConditions(req);
    if (req.cursor) conditions.push(feedAfter(req.sort, req.cursor));
    const rows = await this.db.select(CARD_COLUMNS).from(listings).innerJoin(sellers, eq(sellers.id, listings.sellerId)).where(andAll(conditions)).orderBy(...feedOrder(req.sort)).limit(take + 1);
    const page = rows.slice(0, take);
    const last = page[page.length - 1];
    return { items: await this.buildCards(page, req.userId), nextCursor: rows.length > take && last ? encodeFeedCursor(req.sort, last) : null };
  }

  /** The cards for these listings, in the order given. A listing that is not live is left out. Used by lists that order by something other than the feed's sorts (Saved). */
  async cardsFor(userId: string, ids: string[]): Promise<BuyerFeed['items']> {
    if (!ids.length) return [];
    const rows = await this.db.select(CARD_COLUMNS).from(listings).innerJoin(sellers, eq(sellers.id, listings.sellerId)).where(and(eq(listings.status, 'ACTIVE'), inArray(listings.id, ids)));
    const byId = new Map(rows.map((r) => [r.id, r]));
    return this.buildCards(ids.map((id) => byId.get(id)).filter((r): r is CardRow => !!r), userId);
  }

  private async buildCards(page: CardRow[], userId: string): Promise<BuyerFeed['items']> {
    const ids = page.map((r) => r.id);
    const sellerIds = [...new Set(page.map((r) => r.sellerId))];
    const [mediaBy, variantsBy, ratings, followed, social] = await Promise.all([
      this.mediaOf(ids),
      this.variantsOf(ids),
      sellerRatings(this.db, sellerIds),
      sellerIds.length
        ? this.db.select({ id: follows.targetId }).from(follows).where(and(eq(follows.followerUserId, userId), eq(follows.targetType, 'SELLER'), inArray(follows.targetId, sellerIds)))
        : Promise.resolve([] as { id: string }[]),
      socialCounts(this.db, userId, ids),
    ]);
    const following = new Set(followed.map((f) => f.id));
    return page.map((r) => {
      const m = mediaBy.get(r.id) ?? [];
      const first = m[0];
      const video = m.find((x) => x.kind === 'video');
      const stock = (variantsBy.get(r.id) ?? []).reduce((t, v) => t + v.stock, 0);
      const sc = social.get(r.id)!;
      return {
        id: r.id,
        title: r.title,
        price: r.pricePaise,
        category: r.category,
        soldOut: stock < 1,
        acceptsOffers: r.bargainMode !== 'BUY_NOW',
        coverUrl: first ? (first.kind === 'image' ? first.url : first.posterUrl) : null,
        hasVideo: !!video,
        video: video ? { url: video.url, posterUrl: video.posterUrl } : null,
        following: following.has(r.sellerId),
        ownShop: r.sellerUserId === userId,
        likeCount: sc.likeCount,
        commentCount: sc.commentCount,
        liked: sc.liked,
        saved: sc.saved,
        seller: { id: r.sellerId, name: r.sellerName, handle: r.sellerHandle, area: r.sellerArea, city: r.sellerCity, rating: ratings.get(r.sellerId)?.rating ?? null, reviewCount: ratings.get(r.sellerId)?.reviewCount ?? 0 },
      };
    });
  }

  async getForBuyer(viewerUserId: string, listingId: string): Promise<BuyerListing> {
    const [row] = await this.db
      .select({
        l: listings,
        sellerUserId: sellers.userId,
        sellerName: sellers.name,
        sellerHandle: sellers.handle,
        sellerArea: sellers.area,
        sellerCity: sellers.city,
        sellerCategories: sellers.categories,
        sellerConfirmHours: sellers.slaConfirmHours,
        sellerShipDays: sellers.slaShipDays,
      })
      .from(listings)
      .innerJoin(sellers, eq(sellers.id, listings.sellerId))
      .where(and(eq(listings.id, listingId), eq(listings.status, 'ACTIVE')))
      .limit(1);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'This listing is not available.');
    const [mediaBy, variantsBy, stats, social] = await Promise.all([this.mediaOf([listingId]), this.variantsOf([listingId]), loadSellerStats(this.db, [row.l.sellerId]), socialCounts(this.db, viewerUserId, [listingId])]);
    const sc = social.get(listingId)!;
    const record = stats.get(row.l.sellerId)!;
    const variants = variantsBy.get(listingId) ?? [];
    const l = row.l;
    const publicListing: PublicListing = {
      id: l.id,
      sellerId: l.sellerId,
      title: l.title,
      description: l.description,
      category: l.category,
      price: l.pricePaise,
      status: l.status,
      mode: l.bargainMode,
      expiryMinutes: l.expiryMinutes,
      channel: l.channel,
      productUrl: l.productUrl,
      variants,
    };
    const view = buyerListingView(publicListing, Object.fromEntries(variants.map((v) => [v.id, v.stock])));
    const [pay] = l.channel === 'DIRECT' ? await this.db.select().from(sellerPaymentProfiles).where(eq(sellerPaymentProfiles.sellerId, l.sellerId)).limit(1) : [];
    return {
      ...view,
      tags: l.tags,
      likeCount: sc.likeCount,
      commentCount: sc.commentCount,
      liked: sc.liked,
      saved: sc.saved,
      ownListing: row.sellerUserId === viewerUserId,
      checkout: { ...view.checkout, payMethods: pay ? directMethods(cleanPayment(pay)) : [] },
      media: (mediaBy.get(listingId) ?? []).map((m) => ({ kind: m.kind, url: m.url, posterUrl: m.posterUrl })),
      seller: {
        id: l.sellerId,
        name: row.sellerName,
        handle: row.sellerHandle,
        area: row.sellerArea,
        city: row.sellerCity,
        rating: record.rating,
        reviewCount: record.reviewCount,
        slaConfirmHours: row.sellerConfirmHours,
        slaShipDays: row.sellerShipDays,
        categories: row.sellerCategories,
        record,
      },
    };
  }
}
