import { validateTags } from './discovery.js';
import { isWholeRupees, type Paise } from './money.js';
import { BARGAIN_MODES, CATEGORIES, IMAGE_MIMES, MEDIA_PURPOSES, OFFER_EXPIRY_MINUTES, RULES, VIDEO_MIMES } from './rules.js';
import type { BargainMode, DealAccess, DealCodes, PayMethod, PrivateRules } from './types.js';

const PHONE_RE = /^[6-9]\d{9}$/;
const PIN_RE = /^[1-9]\d{5}$/;
const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCT_RE = /^\d{9,18}$/;
const CODE_RE = /^[A-Za-z0-9_-]{3,40}$/;

export const isHttps = (u: unknown): boolean => {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' && !!x.hostname && x.hostname.includes('.');
  } catch {
    return false;
  }
};

const text = (x: unknown): string => String(x ?? '').trim();

// ---------- identity ----------
export const normalizePhone = (p: unknown): string =>
  String(p ?? '')
    .replace(/\D/g, '')
    .replace(/^91(?=\d{10}$)/, '');
export const isValidIndianMobile = (normalized: string): boolean => PHONE_RE.test(normalized);

// ---------- addresses ----------
export interface AddressInput {
  name?: string;
  line1?: string;
  line2?: string;
  pin?: string;
  city?: string;
  state?: string;
}
export function validateAddress(a: AddressInput | null | undefined): Record<string, string> {
  const e: Record<string, string> = {};
  if (text(a?.name).length < 2) e.name = 'Enter the recipient’s name.';
  if (!text(a?.line1)) e.line1 = 'Enter flat, house or building.';
  if (!text(a?.line2)) e.line2 = 'Enter area or street.';
  if (!PIN_RE.test(text(a?.pin))) e.pin = 'Enter a 6-digit PIN code.';
  if (!text(a?.city)) e.city = 'Enter the city.';
  if (!text(a?.state)) e.state = 'Enter the state.';
  return e;
}

// ---------- seller payment profile ----------
export interface PaymentInput {
  upiId?: string | null;
  upiQrMediaId?: string | null;
  /** The text the phone decoded from the QR image. Needed with `upiQrMediaId`, so the QR can be checked against `upiId`. */
  upiQrPayload?: string | null;
  bankHolder?: string | null;
  bankAccount?: string | null;
  bankIfsc?: string | null;
  bankName?: string | null;
  paymentLink?: string | null;
  website?: string | null;
}
export interface PaymentProfile {
  upiId: string | null;
  upiQrMediaId: string | null;
  bankHolder: string | null;
  bankAccount: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  paymentLink: string | null;
  website: string | null;
}

export function cleanPayment(p: PaymentInput | null | undefined): PaymentProfile {
  const q = p ?? {};
  return {
    upiId: text(q.upiId) || null,
    upiQrMediaId: q.upiQrMediaId || null,
    bankHolder: text(q.bankHolder) || null,
    bankAccount: text(q.bankAccount).replace(/\s/g, '') || null,
    bankIfsc: text(q.bankIfsc).toUpperCase() || null,
    bankName: text(q.bankName) || null,
    paymentLink: text(q.paymentLink) || null,
    website: text(q.website) || null,
  };
}

/** The payee address (`pa=`) inside a UPI payment QR, lower-cased; null when the text is not a UPI payment link. */
export function upiPayeeFromQr(payload: string | null | undefined): string | null {
  const t = text(payload);
  if (!/^upi:\/\/pay\?/i.test(t)) return null;
  const pa = new URLSearchParams(t.slice(t.indexOf('?') + 1)).get('pa');
  return pa ? pa.trim().toLowerCase() : null;
}

/** Error message when the QR's payee does not match the UPI ID the seller entered; null when it matches. */
export function validateUpiQr(upiId: string | null | undefined, payload: string | null | undefined): string | null {
  const payee = upiPayeeFromQr(payload);
  if (!payee) return 'This image is not a UPI payment QR code. Upload the QR from your UPI app.';
  if (!text(upiId)) return 'Enter your UPI ID too, so we can check it against the QR.';
  if (payee !== text(upiId).toLowerCase()) return `The QR belongs to ${payee}, not ${text(upiId).toLowerCase()}. Upload the right QR or fix the UPI ID.`;
  return null;
}

export function validatePayment(
  p: PaymentInput | null | undefined,
  /** Pass `skipQrCheck` when re-checking a saved profile: its QR was checked when it was uploaded, and the decoded text is not stored. */
  opts: { skipQrCheck?: boolean } = {},
): {
  errors: Record<string, string>;
  clean: PaymentProfile;
} {
  const e: Record<string, string> = {};
  const c = cleanPayment(p);
  if (c.upiId && !UPI_RE.test(c.upiId)) e.upiId = 'Enter a UPI ID like name@okbank.';
  if (c.upiQrMediaId && !opts.skipQrCheck) {
    const qr = validateUpiQr(c.upiId, p?.upiQrPayload);
    if (qr) e.upiQr = qr;
  }
  const anyBank = c.bankHolder || c.bankAccount || c.bankIfsc || c.bankName;
  if (anyBank) {
    if (!c.bankHolder || c.bankHolder.length < 2) e.bankHolder = 'Enter the account holder’s name.';
    if (!ACCT_RE.test(c.bankAccount ?? '')) e.bankAccount = 'Enter a 9–18 digit account number.';
    if (!IFSC_RE.test(c.bankIfsc ?? '')) e.bankIfsc = 'Enter an 11-character IFSC, like HDFC0001234.';
  }
  if (c.paymentLink && !isHttps(c.paymentLink)) e.paymentLink = 'Enter a full https:// payment link.';
  if (c.website && !isHttps(c.website)) e.website = 'Enter a full https:// website address.';
  if (!c.upiId && !c.upiQrMediaId && !anyBank && !c.paymentLink && !c.website)
    e.payment = 'Add at least one way for buyers to pay you, or your website.';
  return { errors: e, clean: c };
}

/** Payment methods a buyer can use to pay this seller directly. */
export function directMethods(p: PaymentProfile | null | undefined): PayMethod[] {
  const m: PayMethod[] = [];
  if (!p) return m;
  if (p.upiId || p.upiQrMediaId) m.push('UPI');
  if (p.bankAccount) m.push('BANK');
  if (p.paymentLink) m.push('LINK');
  return m;
}

// ---------- deal codes / links ----------
export function validateDealAccess(d: Partial<DealAccess> | null | undefined, label: string): string | null {
  if (!d || !d.value || !text(d.value)) return label + ': enter a coupon code or a discount link.';
  if (d.type === 'LINK') return isHttps(d.value) ? null : label + ': enter a full https:// link.';
  if (d.type === 'CODE') return CODE_RE.test(text(d.value)) ? null : label + ': codes use 3–40 letters, numbers, - or _.';
  return label + ': choose code or link.';
}
export const cleanDeal = (d: DealAccess | null | undefined): DealAccess | null =>
  d ? { type: d.type, value: text(d.value) } : null;

// ---------- shipment ----------
export interface ShipmentInput {
  carrier?: string | null;
  trackingId?: string | null;
  trackingUrl?: string | null;
  expectedDate?: string | null;
  note?: string | null;
}
export interface Shipment {
  carrier: string | null;
  trackingId: string | null;
  trackingUrl: string | null;
  expectedDate: string | null;
  note: string | null;
}
export const hasShipment = (x: ShipmentInput | null | undefined): boolean =>
  !!x && (['carrier', 'trackingId', 'trackingUrl', 'expectedDate', 'note'] as const).some((k) => text(x[k]));

export function validateShipment(x: ShipmentInput): { fields: Record<string, string> } | { clean: Shipment } {
  const f: Record<string, string> = {};
  const clean: Shipment = {
    carrier: text(x.carrier).slice(0, 60) || null,
    trackingId: text(x.trackingId).slice(0, 60) || null,
    trackingUrl: text(x.trackingUrl) || null,
    expectedDate: text(x.expectedDate) || null,
    note: text(x.note).slice(0, 200) || null,
  };
  if (!hasShipment(x)) f.shipment = 'Add a courier, tracking number, link or a note such as “hand delivery”.';
  if (clean.trackingUrl && !isHttps(clean.trackingUrl)) f.trackingUrl = 'Enter a full https:// tracking link.';
  if (clean.expectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(clean.expectedDate))
    f.expectedDate = 'Use a date like 2026-11-04.';
  return Object.keys(f).length ? { fields: f } : { clean };
}

// ---------- listing draft ----------
export interface ListingDraft {
  title?: string;
  description?: string;
  category?: string;
  /** Paise, whole rupees. */
  price?: Paise;
  media?: unknown[];
  /** Search keywords such as "cotton" or "summer wear". Cleaned by `validateTags`. */
  tags?: string[];
  variants?: { id?: string; label?: string; stock?: number }[];
  bargaining?: { mode?: string; expiryMinutes?: number };
  /** Paise, whole rupees; null/undefined means "not set". */
  rules?: { autoAcceptAt?: Paise | null; autoDeclineBelow?: Paise | null; autoCounterAt?: Paise | null };
}

export function validateListingDraft(d: ListingDraft): { errors: Record<string, string>; rules: PrivateRules } {
  const e: Record<string, string> = {};
  const title = text(d.title);
  if (title.length < 3 || title.length > 80) e.title = 'Use 3–80 characters.';
  if (String(d.description ?? '').length > 600) e.description = 'Keep it under 600 characters.';
  if (!(CATEGORIES as readonly string[]).includes(d.category ?? '')) e.category = 'Choose a category.';
  const tagCheck = validateTags(d.tags);
  if (tagCheck.error) e.tags = tagCheck.error;
  if (!d.media || !d.media.length) e.media = 'Add at least one video or photo.';
  if (d.media && d.media.length > RULES.MAX_MEDIA_PER_LISTING) e.media = 'Up to 6 media items.';
  const price = d.price;
  const priceOk = typeof price === 'number' && isWholeRupees(price);
  if (!priceOk || price < RULES.MIN_PRICE_PAISE || price > RULES.MAX_PRICE_PAISE)
    e.price = 'Enter a whole-rupee price between ₹50 and ₹10,00,000.';
  const vs = d.variants ?? [];
  if (!vs.length) e.variants = 'Add at least one size or option.';
  const labels = new Set<string>();
  vs.forEach((v) => {
    const lab = text(v.label);
    if (!lab) e.variants = 'Every size needs a name.';
    if (labels.has(lab.toLowerCase())) e.variants = 'Size names must be unique.';
    labels.add(lab.toLowerCase());
    const stock = Number(v.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > 9999) e.variants = 'Stock must be a whole number from 0 to 9,999.';
  });
  const b = d.bargaining ?? {};
  if (!(BARGAIN_MODES as readonly string[]).includes(b.mode ?? '')) e.mode = 'Choose how buyers can bargain.';
  if (!(OFFER_EXPIRY_MINUTES as readonly number[]).includes(Number(b.expiryMinutes)))
    e.expiryMinutes = 'Choose how long an offer stays open: 30 minutes, 1, 3, 6 or 24 hours.';
  const r = d.rules ?? {};
  const A = r.autoAcceptAt ?? null;
  const D = r.autoDeclineBelow ?? null;
  const C = r.autoCounterAt ?? null;
  const mode = b.mode as BargainMode | undefined;
  if (mode === 'BOTH' && priceOk) {
    (
      [
        ['autoAcceptAt', A],
        ['autoDeclineBelow', D],
        ['autoCounterAt', C],
      ] as const
    ).forEach(([k, x]) => {
      if (x != null && (!isWholeRupees(x) || x <= 0 || x >= price))
        e[k] = 'Must be a whole-rupee amount below the listed price.';
    });
    if (A != null && D != null && !e.autoAcceptAt && !e.autoDeclineBelow && D >= A)
      e.autoDeclineBelow = 'Must be lower than your lowest price.';
    if (A != null && C != null && !e.autoAcceptAt && !e.autoCounterAt && C < A)
      e.autoCounterAt = 'Must be at or above your lowest price.';
    if (D != null && C != null && !e.autoCounterAt && !e.autoDeclineBelow && C <= D)
      e.autoCounterAt = 'Must be above the auto-decline amount.';
  }
  const rules: PrivateRules =
    mode === 'BOTH'
      ? { autoAcceptAt: A, autoDeclineBelow: D, autoCounterAt: C }
      : { autoAcceptAt: null, autoDeclineBelow: null, autoCounterAt: null };
  return { errors: e, rules };
}

// ---------- checkout channel (where the buyer completes the purchase) ----------
export interface CheckoutInput {
  channel?: string;
  productUrl?: string;
  mode?: string;
  rules: PrivateRules;
  dealCodes?: DealCodes | null;
  payment: PaymentProfile | null;
}
export function validateCheckout(i: CheckoutInput): Record<string, string> {
  const e: Record<string, string> = {};
  const channel = i.channel ?? 'DIRECT';
  if (channel !== 'DIRECT' && channel !== 'WEBSITE') e.channel = 'Choose where buyers complete the purchase.';
  else if (channel === 'DIRECT' && !directMethods(i.payment).length)
    e.channel = 'Add a UPI ID, QR code, bank account or payment link in your shop settings first.';
  else if (channel === 'WEBSITE') {
    if (!isHttps(i.productUrl)) e.productUrl = 'Enter the full https:// link to this product on your website.';
    if (i.mode === 'BOTH') {
      if (i.rules.autoAcceptAt != null) {
        const m = validateDealAccess(i.dealCodes?.accept, 'Code for your automatic price');
        if (m) e.acceptCode = m;
      }
      if (i.rules.autoCounterAt != null) {
        const m = validateDealAccess(i.dealCodes?.counter, 'Code for your automatic counter');
        if (m) e.counterCode = m;
      }
    }
  }
  return e;
}

/** A listing can be published only with stock on at least one size. */
export const publishStockError = (variants: { stock?: number }[] | undefined): string | null =>
  (variants ?? []).reduce((t, v) => t + (Number(v.stock) || 0), 0) < 1 ? 'Add stock to at least one size before publishing.' : null;

// ---------- media upload intent ----------
export interface MediaIntentInput {
  kind?: string;
  purpose?: string;
  mime?: string;
  size?: number;
  /** Reported by the phone for videos. The server cannot check it, so it is a guard rail, not a guarantee. */
  durationSec?: number | null;
}

/** Checks an upload request against the media limits (I-13). A UPI QR is always a photo. */
export function validateMediaIntent(i: MediaIntentInput): Record<string, string> {
  const e: Record<string, string> = {};
  const isImage = i.kind === 'image';
  const isVideo = i.kind === 'video';
  if (!isImage && !isVideo) e.kind = 'Choose a photo or a video.';
  if (!(MEDIA_PURPOSES as readonly string[]).includes(i.purpose ?? '')) e.purpose = 'Unknown upload purpose.';
  if (i.purpose === 'UPI_QR' && isVideo) e.kind = 'A UPI QR code must be a photo.';
  if ((i.purpose === 'REQUEST' || i.purpose === 'CHAT') && isVideo) e.kind = 'Use a photo here.';
  const mimes: readonly string[] = isImage ? IMAGE_MIMES : isVideo ? VIDEO_MIMES : [];
  if ((isImage || isVideo) && !mimes.includes(i.mime ?? '')) e.mime = isImage ? 'Use a JPEG, PNG or WebP photo.' : 'Use an MP4, MOV or WebM video.';
  const size = i.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) e.size = 'The file looks empty.';
  else if (isImage && size > RULES.MAX_PHOTO_BYTES) e.size = 'Photos can be up to 15 MB.';
  else if (isVideo && size > RULES.MAX_VIDEO_BYTES) e.size = 'Videos can be up to 80 MB.';
  if (isVideo && i.durationSec != null && !(i.durationSec > 0 && i.durationSec <= RULES.MAX_REEL_SECONDS + 1))
    e.durationSec = `Reels can be up to ${RULES.MAX_REEL_SECONDS} seconds.`;
  return e;
}
