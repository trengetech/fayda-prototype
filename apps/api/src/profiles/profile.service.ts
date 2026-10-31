import { Inject, Injectable } from '@nestjs/common';
import { MAX_ADDRESSES, type AddressInput, type AppAudience, type BuyerProfile, type BuyerProfileInput, type NewAddress, type PaymentInput, type ProfileStatus, type SellerProfile, type SellerShopInput } from '@fayda/contracts';
import {
  RULES,
  missingBuyerFields,
  missingSellerFields,
  validateAddress,
  validateBuyerOnboarding,
  validateContact,
  validatePayment,
  validateSellerReach,
  validateSellerShop,
  type Clock,
} from '@fayda/domain';
import { and, count, eq, ne } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { DbService } from '../db/db.service.js';
import { MediaService } from '../media/media.service.js';
import { buyerAddresses, buyerProfiles, sellerPaymentProfiles, sellers, users } from '../db/schema.js';

type Tx = Parameters<Parameters<DbService['db']['transaction']>[0]>[0];
const ms = (d: Date | null): number | null => (d ? d.getTime() : null);
const invalid = (fields: Record<string, string>): AppError => new AppError(400, 'VALIDATION', 'Check the highlighted fields.', fields);

@Injectable()
export class ProfileService {
  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MediaService) private readonly mediaFiles: MediaService,
  ) {}

  private get db() {
    return this.database.db;
  }

  /** What is still missing for this user in this app. Existing accounts are asked for new fields, never locked out. */
  async status(userId: string, app: AppAudience): Promise<ProfileStatus> {
    const missing = app === 'buyer' ? (await this.getBuyer(userId)).missing : await this.sellerMissing(userId);
    return { complete: missing.length === 0, missing };
  }

  // ---------- buyer ----------
  async getBuyer(userId: string): Promise<BuyerProfile> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    const [p] = await this.db.select().from(buyerProfiles).where(eq(buyerProfiles.userId, userId)).limit(1);
    const addresses = await this.db.select().from(buyerAddresses).where(eq(buyerAddresses.userId, userId)).orderBy(buyerAddresses.createdAt);
    const contact = { phone: p?.contactPhone ?? null, whatsapp: p?.contactWhatsapp ?? null };
    const missing = new Set(
      p
        ? missingBuyerFields({ contact, agreementVersion: p.agreementVersion, agreementAcceptedAt: ms(p.agreementAcceptedAt) })
        : ['contact', 'agreement'],
    );
    if (!user?.name) missing.add('name');
    if (!addresses.length) missing.add('address');
    return {
      name: user?.name ?? null,
      addresses: addresses.map((a) => ({ id: a.id, name: a.name, line1: a.line1, line2: a.line2, pin: a.pin, city: a.city, state: a.state })),
      defaultAddressId: p?.defaultAddressId ?? null,
      contact,
      agreementVersion: p?.agreementVersion ?? null,
      agreementAcceptedAt: ms(p?.agreementAcceptedAt ?? null),
      missing: [...missing],
    };
  }

  async saveBuyer(userId: string, input: BuyerProfileInput): Promise<BuyerProfile> {
    const fields: Record<string, string> = {};
    const name = input.name.trim();
    if (name.length < 2) fields.name = 'Enter your name.';
    Object.entries(validateAddress(input.address)).forEach(([k, v]) => (fields[`address.${k}`] = v));
    const onboarding = validateBuyerOnboarding({ contact: input.contact, agreementAccepted: input.agreementAccepted });
    Object.assign(fields, onboarding.errors);
    if (Object.keys(fields).length) throw invalid(fields);

    const now = new Date(this.clock.now());
    const a = input.address;
    const row = { name: a.name.trim(), line1: a.line1.trim(), line2: a.line2.trim(), pin: a.pin.trim(), city: a.city.trim(), state: a.state.trim() };
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ name }).where(eq(users.id, userId));
      const [existing] = await tx.select().from(buyerProfiles).where(eq(buyerProfiles.userId, userId)).limit(1);
      let addressId = existing?.defaultAddressId ?? null;
      if (addressId) await tx.update(buyerAddresses).set(row).where(and(eq(buyerAddresses.id, addressId), eq(buyerAddresses.userId, userId)));
      else [{ id: addressId }] = (await tx.insert(buyerAddresses).values({ userId, ...row }).returning({ id: buyerAddresses.id })) as [{ id: string }];
      // The agreement time changes only when the accepted version changes.
      const sameVersion = existing?.agreementVersion === RULES.AGREEMENT_VERSION && existing.agreementAcceptedAt;
      const values = {
        contactPhone: onboarding.contact.phone,
        contactWhatsapp: onboarding.contact.whatsapp,
        agreementVersion: RULES.AGREEMENT_VERSION,
        agreementAcceptedAt: sameVersion ? existing.agreementAcceptedAt : now,
        defaultAddressId: addressId,
      };
      await tx.insert(buyerProfiles).values({ userId, ...values }).onConflictDoUpdate({ target: buyerProfiles.userId, set: values });
    });
    return this.getBuyer(userId);
  }

  async updateBuyerContact(userId: string, contact: { phone?: string | null; whatsapp?: string | null }): Promise<BuyerProfile> {
    const [p] = await this.db.select().from(buyerProfiles).where(eq(buyerProfiles.userId, userId)).limit(1);
    if (!p) throw new AppError(403, 'NO_PROFILE', 'Complete your profile first.');
    const c = validateContact(contact, 'Add a phone or WhatsApp number sellers can use for your orders.');
    if (Object.keys(c.errors).length) throw invalid(c.errors);
    await this.db.update(buyerProfiles).set({ contactPhone: c.clean.phone, contactWhatsapp: c.clean.whatsapp }).where(eq(buyerProfiles.userId, userId));
    return this.getBuyer(userId);
  }

  // ---------- buyer addresses ----------
  /** Cleans an address after the domain check; throws the field errors as they are. */
  private cleanAddress(a: { name: string; line1: string; line2: string; pin: string; city: string; state: string }) {
    const errors = validateAddress(a);
    if (Object.keys(errors).length) throw invalid(errors);
    return { name: a.name.trim(), line1: a.line1.trim(), line2: a.line2.trim(), pin: a.pin.trim(), city: a.city.trim(), state: a.state.trim() };
  }

  /**
   * Runs one change to a buyer's addresses under a lock on their profile row, so two taps at once cannot go past the limit or
   * leave the default pointing at a deleted address.
   */
  private async changeAddresses(userId: string, fn: (tx: Tx, profile: typeof buyerProfiles.$inferSelect) => Promise<void>): Promise<BuyerProfile> {
    await this.db.transaction(async (tx) => {
      const [p] = await tx.select().from(buyerProfiles).where(eq(buyerProfiles.userId, userId)).for('update');
      if (!p) throw new AppError(403, 'NO_PROFILE', 'Complete your profile first.');
      await fn(tx, p);
    });
    return this.getBuyer(userId);
  }

  async addAddress(userId: string, input: NewAddress): Promise<BuyerProfile> {
    const row = this.cleanAddress(input);
    return this.changeAddresses(userId, async (tx, p) => {
      const [n] = await tx.select({ n: count() }).from(buyerAddresses).where(eq(buyerAddresses.userId, userId));
      if ((n?.n ?? 0) >= MAX_ADDRESSES) throw new AppError(400, 'VALIDATION', `You can save up to ${MAX_ADDRESSES} addresses. Delete one first.`, { address: `You can save up to ${MAX_ADDRESSES} addresses.` });
      const [made] = await tx.insert(buyerAddresses).values({ userId, ...row }).returning({ id: buyerAddresses.id });
      if (!p.defaultAddressId || input.makeDefault) await tx.update(buyerProfiles).set({ defaultAddressId: made!.id }).where(eq(buyerProfiles.userId, userId));
    });
  }

  async updateAddress(userId: string, id: string, input: AddressInput): Promise<BuyerProfile> {
    const row = this.cleanAddress(input);
    return this.changeAddresses(userId, async (tx) => {
      const done = await tx.update(buyerAddresses).set(row).where(and(eq(buyerAddresses.id, id), eq(buyerAddresses.userId, userId))).returning({ id: buyerAddresses.id });
      if (!done.length) throw new AppError(404, 'NOT_FOUND', 'Address not found.');
    });
  }

  async deleteAddress(userId: string, id: string): Promise<BuyerProfile> {
    return this.changeAddresses(userId, async (tx, p) => {
      const all = await tx.select({ id: buyerAddresses.id }).from(buyerAddresses).where(eq(buyerAddresses.userId, userId)).orderBy(buyerAddresses.createdAt);
      if (!all.some((a) => a.id === id)) throw new AppError(404, 'NOT_FOUND', 'Address not found.');
      if (all.length === 1) throw new AppError(409, 'LAST_ADDRESS', 'You need at least one delivery address. Add another first, or edit this one.');
      // Orders keep their own copy of the address, so removing one never changes an order.
      await tx.delete(buyerAddresses).where(and(eq(buyerAddresses.id, id), eq(buyerAddresses.userId, userId)));
      if (p.defaultAddressId === id) {
        const next = all.find((a) => a.id !== id)!;
        await tx.update(buyerProfiles).set({ defaultAddressId: next.id }).where(eq(buyerProfiles.userId, userId));
      }
    });
  }

  async setDefaultAddress(userId: string, id: string): Promise<BuyerProfile> {
    return this.changeAddresses(userId, async (tx) => {
      const [a] = await tx.select({ id: buyerAddresses.id }).from(buyerAddresses).where(and(eq(buyerAddresses.id, id), eq(buyerAddresses.userId, userId))).limit(1);
      if (!a) throw new AppError(404, 'NOT_FOUND', 'Address not found.');
      await tx.update(buyerProfiles).set({ defaultAddressId: id }).where(eq(buyerProfiles.userId, userId));
    });
  }

  // ---------- seller ----------
  private async sellerMissing(userId: string): Promise<string[]> {
    const [s] = await this.db.select().from(sellers).where(eq(sellers.userId, userId)).limit(1);
    if (!s) return ['shop', 'payment', 'conduct'];
    const missing = missingSellerFields({
      categories: s.categories,
      mapsUrl: s.mapsUrl,
      contact: { phone: s.contactPhone, whatsapp: s.contactWhatsapp },
      sla: { confirmHours: s.slaConfirmHours, shipDays: s.slaShipDays },
    });
    const [pay] = await this.db.select().from(sellerPaymentProfiles).where(eq(sellerPaymentProfiles.sellerId, s.id)).limit(1);
    if (!pay || Object.keys(validatePayment(pay, { skipQrCheck: true }).errors).length) missing.push('payment');
    if (!s.conductAcceptedAt || s.conductVersion !== RULES.CONDUCT_VERSION) missing.push('conduct');
    return missing;
  }

  async getSeller(userId: string): Promise<SellerProfile> {
    const [s] = await this.db.select().from(sellers).where(eq(sellers.userId, userId)).limit(1);
    if (!s) throw new AppError(404, 'NO_SELLER', 'Set up your shop first.');
    const [pay] = await this.db.select().from(sellerPaymentProfiles).where(eq(sellerPaymentProfiles.sellerId, s.id)).limit(1);
    return {
      id: s.id,
      sellerType: s.sellerType,
      name: s.name,
      handle: s.handle,
      area: s.area,
      city: s.city,
      gstin: s.gstin,
      bio: s.bio,
      categories: s.categories,
      mapsUrl: s.mapsUrl,
      googleProfileUrl: s.googleProfileUrl,
      socialUrl: s.socialUrl,
      contact: { phone: s.contactPhone, whatsapp: s.contactWhatsapp },
      sla: { confirmHours: s.slaConfirmHours, shipDays: s.slaShipDays },
      payment: pay
        ? { upiId: pay.upiId, upiQrMediaId: pay.upiQrMediaId, bankHolder: pay.bankHolder, bankAccount: pay.bankAccount, bankIfsc: pay.bankIfsc, bankName: pay.bankName, paymentLink: pay.paymentLink, website: pay.website }
        : null,
      conductAcceptedAt: ms(s.conductAcceptedAt),
      missing: await this.sellerMissing(userId),
    };
  }

  /** Steps 1 and 2: shop, categories, location, contact and declared times. */
  async saveShop(userId: string, input: SellerShopInput): Promise<SellerProfile> {
    const [mine] = await this.db.select({ id: sellers.id }).from(sellers).where(eq(sellers.userId, userId)).limit(1);
    const [clash] = await this.db
      .select({ id: sellers.id })
      .from(sellers)
      .where(mine ? and(eq(sellers.handle, input.handle.trim().toLowerCase()), ne(sellers.id, mine.id)) : eq(sellers.handle, input.handle.trim().toLowerCase()))
      .limit(1);
    const shop = validateSellerShop(input, !!clash);
    const reach = validateSellerReach(input);
    const fields = { ...shop.errors, ...reach.errors };
    if (Object.keys(fields).length) throw invalid(fields);

    const now = new Date(this.clock.now());
    const values = {
      sellerType: shop.clean.sellerType,
      name: shop.clean.name,
      handle: shop.clean.handle,
      area: shop.clean.area,
      city: shop.clean.city,
      gstin: shop.clean.gstin,
      bio: shop.clean.bio,
      categories: reach.clean.categories,
      mapsUrl: reach.clean.mapsUrl,
      googleProfileUrl: reach.clean.googleProfileUrl,
      socialUrl: reach.clean.socialUrl,
      contactPhone: reach.clean.contact.phone,
      contactWhatsapp: reach.clean.contact.whatsapp,
      slaConfirmHours: reach.clean.sla.confirmHours,
      slaShipDays: reach.clean.sla.shipDays,
      updatedAt: now,
    };
    try {
      await this.db.insert(sellers).values({ userId, ...values }).onConflictDoUpdate({ target: sellers.userId, set: values });
    } catch (e) {
      // Two people claiming the same handle at once: the unique index decides.
      if ((e as { code?: string; cause?: { code?: string } }).code === '23505' || (e as { cause?: { code?: string } }).cause?.code === '23505')
        throw invalid({ handle: 'That handle is taken.' });
      throw e;
    }
    return this.getSeller(userId);
  }

  /** Step 3: payment details and the Code of Conduct. Together with the shop, this completes onboarding. */
  async savePayment(userId: string, input: PaymentInput): Promise<SellerProfile> {
    const [s] = await this.db.select({ id: sellers.id }).from(sellers).where(eq(sellers.userId, userId)).limit(1);
    if (!s) throw new AppError(403, 'NO_SELLER', 'Set up your shop first.');
    const pay = validatePayment(input);
    const fields = { ...pay.errors };
    if (!input.conductAccepted) fields.conduct = 'You need to agree to the Seller Code of Conduct to register.';
    if (Object.keys(fields).length) throw invalid(fields);
    // The QR must be this seller's own finished upload. Its text was checked against the UPI ID by validatePayment.
    if (pay.clean.upiQrMediaId) await this.mediaFiles.requireOwnedReady(userId, pay.clean.upiQrMediaId, 'UPI_QR', 'image');

    const now = new Date(this.clock.now());
    const { upiId, upiQrMediaId, bankHolder, bankAccount, bankIfsc, bankName, paymentLink, website } = pay.clean;
    const values = { upiId, upiQrMediaId, bankHolder, bankAccount, bankIfsc, bankName, paymentLink, website, updatedAt: now };
    await this.db.transaction(async (tx) => {
      await tx.insert(sellerPaymentProfiles).values({ sellerId: s.id, ...values }).onConflictDoUpdate({ target: sellerPaymentProfiles.sellerId, set: values });
      await tx.update(sellers).set({ conductVersion: RULES.CONDUCT_VERSION, conductAcceptedAt: now, updatedAt: now }).where(eq(sellers.id, s.id));
    });
    return this.getSeller(userId);
  }
}
