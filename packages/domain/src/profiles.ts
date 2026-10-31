import { CATEGORIES, CONFIRM_HOURS_OPTIONS, RULES, SHIP_DAYS_OPTIONS } from './rules.js';
import { isValidIndianMobile, normalizePhone } from './validators.js';

// ---------- links ----------
const urlParts = (u: unknown): { host: string; path: string } | null => {
  try {
    const x = new URL(String(u ?? '').trim());
    return x.protocol === 'https:' ? { host: x.hostname.toLowerCase().replace(/^www\./, ''), path: x.pathname } : null;
  } catch {
    return null;
  }
};
const isGoogleHost = (h: string): boolean => /^google\.[a-z.]{2,6}$/.test(h) || /^maps\.google\.[a-z.]{2,6}$/.test(h);

export function isMapsUrl(u: unknown): boolean {
  const p = urlParts(u);
  if (!p) return false;
  return (
    p.host === 'maps.app.goo.gl' ||
    (p.host === 'goo.gl' && p.path.startsWith('/maps')) ||
    (isGoogleHost(p.host) && (p.host.startsWith('maps.') || p.path.startsWith('/maps')))
  );
}
export function isGoogleProfileUrl(u: unknown): boolean {
  const p = urlParts(u);
  if (!p) return false;
  return isMapsUrl(u) || ['g.page', 'share.google', 'business.google.com', 'g.co'].includes(p.host) || (isGoogleHost(p.host) && p.path.length > 1);
}
export function isSocialUrl(u: unknown): boolean {
  const p = urlParts(u);
  if (!p || p.path.replace(/\//g, '').length < 2) return false;
  return ['instagram.com', 'facebook.com', 'm.facebook.com', 'fb.com'].includes(p.host);
}

// ---------- contact (phone and/or WhatsApp) ----------
export interface ContactInput {
  phone?: string | null;
  whatsapp?: string | null;
}
export interface Contact {
  phone: string | null;
  whatsapp: string | null;
}
/** At least one of phone or WhatsApp is required. `missingMessage` is shown when both are empty. */
export function validateContact(c: ContactInput | null | undefined, missingMessage: string): { errors: Record<string, string>; clean: Contact } {
  const e: Record<string, string> = {};
  const ph = normalizePhone(c?.phone);
  const wa = normalizePhone(c?.whatsapp);
  if (c?.phone && !isValidIndianMobile(ph)) e.contactPhone = 'Enter a valid 10-digit mobile number.';
  if (c?.whatsapp && !isValidIndianMobile(wa)) e.contactWhatsapp = 'Enter a valid 10-digit WhatsApp number.';
  if (!c?.phone && !c?.whatsapp) e.contact = missingMessage;
  return { errors: e, clean: { phone: c?.phone && isValidIndianMobile(ph) ? ph : null, whatsapp: c?.whatsapp && isValidIndianMobile(wa) ? wa : null } };
}

// ---------- buyer onboarding ----------
export interface BuyerOnboardingInput {
  contact?: ContactInput | null;
  agreementAccepted?: boolean;
}
export function validateBuyerOnboarding(i: BuyerOnboardingInput): { errors: Record<string, string>; contact: Contact } {
  const ct = validateContact(i.contact, 'Add a phone or WhatsApp number sellers can use for your orders.');
  const errors = { ...ct.errors };
  if (!i.agreementAccepted) errors.agreement = 'You need to accept the user agreement to continue.';
  return { errors, contact: ct.clean };
}

// ---------- seller onboarding (steps 1 and 2; payment is validated by validatePayment) ----------
export interface Sla {
  confirmHours: number;
  shipDays: number;
}
export interface SellerReachInput {
  categories?: string[] | null;
  mapsUrl?: string | null;
  googleProfileUrl?: string | null;
  socialUrl?: string | null;
  contact?: ContactInput | null;
  sla?: { confirmHours?: number | null; shipDays?: number | null } | null;
}
export interface SellerReach {
  categories: string[];
  mapsUrl: string;
  googleProfileUrl: string | null;
  socialUrl: string | null;
  contact: Contact;
  sla: Sla;
}
export function validateSellerReach(i: SellerReachInput): { errors: Record<string, string>; clean: SellerReach } {
  const f: Record<string, string> = {};
  const cats = CATEGORIES.filter((c) => (i.categories ?? []).includes(c));
  if (!cats.length) f.categories = 'Choose at least one category you sell.';
  const maps = String(i.mapsUrl ?? '').trim();
  if (!isMapsUrl(maps)) f.mapsUrl = 'Paste your shop’s Google Maps link (https://maps.app.goo.gl/… or https://www.google.com/maps/…).';
  const profile = String(i.googleProfileUrl ?? '').trim();
  if (profile && !isGoogleProfileUrl(profile)) f.googleProfileUrl = 'Paste a Google Business Profile link (https://g.page/…, https://maps.app.goo.gl/…).';
  const social = String(i.socialUrl ?? '').trim();
  if (social && !isSocialUrl(social)) f.socialUrl = 'Paste your Instagram or Facebook page link (https://instagram.com/yourshop).';
  const ct = validateContact(i.contact, 'Add a phone or WhatsApp number buyers can use for open orders.');
  Object.assign(f, ct.errors);
  const confirmHours = Number(i.sla?.confirmHours);
  const shipDays = Number(i.sla?.shipDays);
  if (!(CONFIRM_HOURS_OPTIONS as readonly number[]).includes(confirmHours)) f.confirmHours = 'Choose how soon you usually confirm payments.';
  if (!(SHIP_DAYS_OPTIONS as readonly number[]).includes(shipDays)) f.shipDays = 'Choose how soon you usually ship.';
  return { errors: f, clean: { categories: cats, mapsUrl: maps, googleProfileUrl: profile || null, socialUrl: social || null, contact: ct.clean, sla: { confirmHours, shipDays } } };
}

// ---------- profile completeness (accounts that predate these fields are asked to fill them in, not locked out) ----------
export interface BuyerProfileState {
  contact?: Contact | null;
  agreementVersion?: string | null;
  agreementAcceptedAt?: number | null;
}
export function missingBuyerFields(p: BuyerProfileState | null | undefined): string[] {
  const m: string[] = [];
  if (!p?.contact || (!p.contact.phone && !p.contact.whatsapp)) m.push('contact');
  if (!p?.agreementAcceptedAt || p.agreementVersion !== RULES.AGREEMENT_VERSION) m.push('agreement');
  return m;
}
export interface SellerProfileState {
  categories?: string[] | null;
  mapsUrl?: string | null;
  contact?: Contact | null;
  sla?: Sla | null;
}
export function missingSellerFields(p: SellerProfileState | null | undefined): string[] {
  const m: string[] = [];
  if (!p?.categories?.length) m.push('categories');
  if (!p?.mapsUrl || !isMapsUrl(p.mapsUrl)) m.push('mapsUrl');
  if (!p?.contact || (!p.contact.phone && !p.contact.whatsapp)) m.push('contact');
  if (!p?.sla) m.push('sla');
  return m;
}

// ---------- what the public may see of a seller ----------
export interface SellerProfile extends SellerReach {
  id: string;
  name: string;
  handle: string;
  area: string;
  city: string;
}
export interface PublicSellerProfile {
  id: string;
  name: string;
  handle: string;
  area: string;
  city: string;
  categories: string[];
  mapsUrl: string;
  googleProfileUrl: string | null;
  socialUrl: string | null;
  sla: Sla;
}
/** Allow-list: the seller's phone and WhatsApp can never reach a public payload through this function. */
export function publicSellerProfile(s: SellerProfile): PublicSellerProfile {
  return { id: s.id, name: s.name, handle: s.handle, area: s.area, city: s.city, categories: [...s.categories], mapsUrl: s.mapsUrl, googleProfileUrl: s.googleProfileUrl, socialUrl: s.socialUrl, sla: { ...s.sla } };
}

// ---------- seller shop basics (step 1) ----------
const HANDLE_RE = /^[a-z0-9_.]{3,24}$/;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const SELLER_TYPES = ['INDIVIDUAL', 'BUSINESS'] as const;
export type SellerType = (typeof SELLER_TYPES)[number];

export interface SellerShopInput {
  sellerType?: string;
  name?: string;
  handle?: string;
  area?: string;
  city?: string | null;
  gstin?: string | null;
  bio?: string | null;
}
export interface SellerShop {
  sellerType: SellerType;
  name: string;
  handle: string;
  area: string;
  city: string;
  gstin: string | null;
  bio: string;
}
export function validateSellerShop(i: SellerShopInput, handleTaken: boolean): { errors: Record<string, string>; clean: SellerShop } {
  const f: Record<string, string> = {};
  if (!(SELLER_TYPES as readonly string[]).includes(i.sellerType ?? '')) f.sellerType = 'Choose business or individual.';
  const name = String(i.name ?? '').trim();
  if (name.length < 2 || name.length > 60) f.name = 'Enter your shop name (2–60 characters).';
  const handle = String(i.handle ?? '').trim().toLowerCase();
  if (!HANDLE_RE.test(handle)) f.handle = 'Use 3–24 lowercase letters, numbers, dots or underscores.';
  else if (handleTaken) f.handle = 'That handle is taken.';
  const area = String(i.area ?? '').trim();
  if (!area) f.area = 'Enter your area or locality.';
  const gstin = String(i.gstin ?? '').trim().toUpperCase();
  if (gstin && !GSTIN_RE.test(gstin)) f.gstin = 'Enter a valid 15-character GSTIN, or leave it blank.';
  const bio = String(i.bio ?? '').trim();
  if (bio.length > 160) f.bio = 'Keep it under 160 characters.';
  return {
    errors: f,
    clean: { sellerType: i.sellerType as SellerType, name, handle, area, city: String(i.city ?? '').trim() || 'Hyderabad', gstin: gstin || null, bio },
  };
}
