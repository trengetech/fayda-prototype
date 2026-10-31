import { describe, expect, it } from 'vitest';
import {
  DAY,
  RULES,
  answerResponse,
  buyAgain,
  canReviewOrder,
  closeRequest,
  contactForOrder,
  isGoogleProfileUrl,
  isMapsUrl,
  isRequestDue,
  isSocialUrl,
  mayShareFromResponse,
  missingBuyerFields,
  missingSellerFields,
  publicSellerProfile,
  ratingSummary,
  requestExpiry,
  sellerStats,
  sellersReached,
  unreadCount,
  validateBuyerOnboarding,
  validateMessage,
  validateRequest,
  validateResponse,
  validateReview,
  validateSellerReach,
  type Order,
  type SellerProfile,
} from '../src/index.js';

const okReach = { categories: ['Ethnic wear'], mapsUrl: 'https://maps.app.goo.gl/abc', contact: { whatsapp: '9000099998' }, sla: { confirmHours: 6, shipDays: 2 } };

describe('Seller onboarding validates categories, Google Maps link, social links, contact and declared timings', () => {
  it('requires every new field', () => {
    const { errors } = validateSellerReach({});
    for (const k of ['categories', 'mapsUrl', 'contact', 'confirmHours', 'shipDays']) expect(errors[k], k).toBeTruthy();
  });
  it('rejects bad links, numbers and timings', () => {
    const { errors } = validateSellerReach({
      categories: ['Ethnic wear'],
      mapsUrl: 'https://example.com/map',
      googleProfileUrl: 'https://example.com',
      socialUrl: 'https://twitter.com/x',
      contact: { phone: '123' },
      sla: { confirmHours: 3, shipDays: 4 },
    });
    for (const k of ['mapsUrl', 'googleProfileUrl', 'socialUrl', 'contactPhone', 'confirmHours', 'shipDays']) expect(errors[k], k).toBeTruthy();
  });
  it('recognises Maps, Google profile and social links', () => {
    for (const m of ['https://maps.app.goo.gl/abc', 'https://www.google.com/maps/place/X', 'https://maps.google.co.in/?q=1', 'https://goo.gl/maps/xyz']) expect(isMapsUrl(m), m).toBe(true);
    expect(isMapsUrl('http://maps.app.goo.gl/abc')).toBe(false);
    expect(isGoogleProfileUrl('https://g.page/sana')).toBe(true);
    expect(isSocialUrl('https://www.instagram.com/sana.studio') && isSocialUrl('https://facebook.com/sana')).toBe(true);
    expect(isSocialUrl('https://instagram.com/')).toBe(false);
  });
  it('accepts a valid shop and cleans the values', () => {
    const r = validateSellerReach({ ...okReach, socialUrl: ' https://instagram.com/sana.studio ', contact: { whatsapp: '+91 90000 99998' } });
    expect(r.errors).toEqual({});
    expect(r.clean.contact).toEqual({ phone: null, whatsapp: '9000099998' });
    expect(r.clean.socialUrl).toBe('https://instagram.com/sana.studio');
  });
});

describe('Buyer onboarding requires the user agreement and a phone or WhatsApp contact', () => {
  it('needs both', () => {
    const e = validateBuyerOnboarding({}).errors;
    expect(e.agreement && e.contact).toBeTruthy();
  });
  it('passes with either number and the agreement', () => {
    expect(validateBuyerOnboarding({ contact: { phone: '9700012345' }, agreementAccepted: true }).errors).toEqual({});
    expect(validateBuyerOnboarding({ contact: { whatsapp: '9700012345' }, agreementAccepted: true }).errors).toEqual({});
  });
  it('flags older accounts as incomplete instead of blocking them', () => {
    expect(missingBuyerFields({})).toEqual(['contact', 'agreement']);
    expect(missingBuyerFields({ contact: { phone: '9700012345', whatsapp: null }, agreementAcceptedAt: 1, agreementVersion: 'old' })).toEqual(['agreement']);
    expect(missingBuyerFields({ contact: { phone: '9700012345', whatsapp: null }, agreementAcceptedAt: 1, agreementVersion: RULES.AGREEMENT_VERSION })).toEqual([]);
    expect(missingSellerFields({})).toEqual(['categories', 'mapsUrl', 'contact', 'sla']);
    expect(missingSellerFields({ ...okReach, contact: { phone: '9000099998', whatsapp: null }, sla: { confirmHours: 6, shipDays: 2 } })).toEqual([]);
  });
});

describe('Order chat: only the two parties can write, unread counts, listing cards by seller only', () => {
  const t = { buyerUserId: 'b1', sellerUserId: 's1', sellerId: 'sel1' };
  const live = { id: 'l1', sellerId: 'sel1', status: 'ACTIVE' };
  it('rejects outsiders and empty or long text', () => {
    expect(validateMessage(t, 'b2', { text: 'hi' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(validateMessage(t, 'b1', { text: '  ' })).toMatchObject({ code: 'EMPTY' });
    expect(validateMessage(t, 'b1', { text: 'x'.repeat(1001) })).toMatchObject({ code: 'TOO_LONG' });
    expect(validateMessage(t, 'b1', { text: 'Paid, note ORD-1' })).toMatchObject({ ok: true, side: 'BUYER' });
  });
  it('lets only the seller share one of their own live listings', () => {
    expect(validateMessage(t, 'b1', { listing: live })).toMatchObject({ code: 'INVALID_LISTING' });
    expect(validateMessage(t, 's1', { listing: { ...live, status: 'PAUSED' } })).toMatchObject({ code: 'INVALID_LISTING' });
    expect(validateMessage(t, 's1', { listing: { ...live, sellerId: 'other' } })).toMatchObject({ code: 'INVALID_LISTING' });
    expect(validateMessage(t, 's1', { listing: live })).toMatchObject({ ok: true, message: { type: 'LISTING', listingId: 'l1' } });
  });
  it('counts only the other side’s messages after the read time, never system messages', () => {
    const m = [
      { from: 'SYSTEM' as const, at: 1 },
      { from: 'BUYER' as const, at: 5 },
      { from: 'SELLER' as const, at: 8 },
    ];
    expect(unreadCount(m, 0, 'SELLER')).toBe(1);
    expect(unreadCount(m, 5, 'SELLER')).toBe(0);
    expect(unreadCount(m, 0, 'BUYER')).toBe(1);
  });
});

describe('Contact details: only on open orders, never public', () => {
  const c = { phone: '9000011111', whatsapp: null };
  it('shows the other party’s number only while the order is open', () => {
    for (const s of ['PLACED', 'CONFIRMED', 'SHIPPED'] as const) expect(contactForOrder(s, c)).toEqual(c);
    for (const s of ['DELIVERED', 'CANCELLED', 'EXPIRED'] as const) expect(contactForOrder(s, c)).toBeNull();
  });
  it('keeps the numbers out of the public seller profile', () => {
    const s: SellerProfile = { id: 'sel1', name: 'Shop', handle: 'shop', area: 'Banjara Hills', city: 'Hyderabad', ...okReach, categories: ['Ethnic wear'], googleProfileUrl: null, socialUrl: null, contact: { phone: '9000011111', whatsapp: '9000022222' }, sla: { confirmHours: 6, shipDays: 2 } };
    const json = JSON.stringify(publicSellerProfile(s));
    expect(json).not.toContain('9000011111');
    expect(json).not.toContain('9000022222');
    expect(json).not.toContain('contact');
    expect(publicSellerProfile(s).sla.confirmHours).toBe(6);
  });
});

describe('Reviews: buyer of a confirmed order only, 1–5 stars, low ratings need a reason', () => {
  it('limits reviews to the buyer, and to orders that reached CONFIRMED', () => {
    expect(canReviewOrder({ buyerId: 'b1', confirmedAt: 10 }, 'b2')).toMatchObject({ code: 'NOT_FOUND' });
    expect(canReviewOrder({ buyerId: 'b1', confirmedAt: null }, 'b1')).toMatchObject({ code: 'NOT_CONFIRMED' });
    expect(canReviewOrder({ buyerId: 'b1', confirmedAt: 10 }, 'b1')).toEqual({ ok: true });
  });
  it('validates stars, text and media', () => {
    expect(validateReview({ rating: 6 }).errors.rating).toBeTruthy();
    expect(validateReview({ rating: 1, text: 'bad' }).errors.text).toBeTruthy();
    expect(validateReview({ rating: 2, text: '' }).errors.text).toBeTruthy();
    expect(validateReview({ rating: 3, text: '' }).errors).toEqual({});
    expect(validateReview({ rating: 5, text: 'Great', media: [1, 2, 3, 4] }).errors).toEqual({});
    expect(validateReview({ rating: 5, media: [1, 2, 3, 4, 5] }).errors.media).toBeTruthy();
  });
  it('averages ratings to one decimal and adds them to seller stats', () => {
    expect(ratingSummary([])).toEqual({ rating: null, reviewCount: 0 });
    expect(ratingSummary([2, 4])).toEqual({ rating: 3, reviewCount: 2 });
    expect(ratingSummary([5, 4, 4])).toEqual({ rating: 4.3, reviewCount: 3 });
    const o = { createdAt: 0, confirmedAt: 5, status: 'DELIVERED' } as unknown as Order;
    expect(sellerStats([o], [5, 4])).toMatchObject({ rating: 4.5, reviewCount: 2, completed: 1 });
    expect(sellerStats([o]).rating).toBeNull();
  });
});

describe('Buy again: offered when the listing is live and the size is in stock', () => {
  it('goes to checkout for the same size, else the product page', () => {
    const l = { id: 'l1', status: 'ACTIVE', channel: 'DIRECT' as const };
    expect(buyAgain(l, 'v1', { v1: 0, v2: 3 })).toMatchObject({ variantId: null, anyAvailable: true });
    expect(buyAgain(l, 'v1', { v1: 0 })).toMatchObject({ variantId: null, anyAvailable: false });
    expect(buyAgain(l, 'v1', { v1: 2 })).toMatchObject({ variantId: 'v1' });
  });
  it('is hidden when the listing is paused, and website listings never skip the product page', () => {
    expect(buyAgain({ id: 'l1', status: 'PAUSED', channel: 'DIRECT' }, 'v1', { v1: 5 })).toBeNull();
    expect(buyAgain(null, 'v1', { v1: 5 })).toBeNull();
    expect(buyAgain({ id: 'l1', status: 'ACTIVE', channel: 'WEBSITE' }, 'v1', { v1: 5 })).toMatchObject({ variantId: null, channel: 'WEBSITE' });
  });
});

describe('Requests: reach sellers in the category, need photos, response → want → chat → listing shared', () => {
  it('needs a category, a title and at least one photo', () => {
    expect(validateRequest({ category: 'Footwear', title: 'Kolhapuris size 8', mediaCount: 0 }).media).toBeTruthy();
    expect(validateRequest({ category: 'Nope', title: 'x', mediaCount: 1 })).toMatchObject({ category: expect.any(String), title: expect.any(String) });
    expect(validateRequest({ category: 'Ethnic wear', title: 'Mustard dupatta', budget: 150_000, mediaCount: 1 })).toEqual({});
    expect(validateRequest({ category: 'Ethnic wear', title: 'Mustard dupatta', budget: 150_050, mediaCount: 1 }).budget).toBeTruthy();
  });
  it('reaches sellers in the category except the buyer’s own shop', () => {
    const sellers = [
      { userId: 'u1', categories: ['Ethnic wear', 'Accessories'] },
      { userId: 'u2', categories: ['Footwear'] },
      { userId: 'buyer', categories: ['Ethnic wear'] },
    ];
    expect(sellersReached(sellers, 'Ethnic wear', 'buyer').map((s) => s.userId)).toEqual(['u1']);
  });
  const req = { status: 'OPEN' as const, category: 'Ethnic wear', buyerId: 'buyer' };
  const seller = { userId: 'u1', categories: ['Ethnic wear'] };
  it('lets only in-category sellers respond once, with a photo, while the request is open', () => {
    expect(validateResponse({ request: req, seller, alreadyResponded: false, mediaCount: 0 })).toMatchObject({ code: 'VALIDATION', fields: { media: expect.any(String) } });
    expect(validateResponse({ request: req, seller, alreadyResponded: false, price: 139_900, mediaCount: 1 })).toEqual({ ok: true });
    expect(validateResponse({ request: req, seller, alreadyResponded: true, mediaCount: 1 })).toMatchObject({ code: 'ALREADY_RESPONDED' });
    expect(validateResponse({ request: req, seller: { userId: 'u2', categories: ['Footwear'] }, alreadyResponded: false, mediaCount: 1 })).toMatchObject({ code: 'NOT_IN_CATEGORY' });
    expect(validateResponse({ request: { ...req, status: 'CLOSED' }, seller, alreadyResponded: false, mediaCount: 1 })).toMatchObject({ code: 'CLOSED' });
    expect(validateResponse({ request: req, seller: { ...seller, userId: 'buyer' }, alreadyResponded: false, mediaCount: 1 })).toMatchObject({ code: 'OWN_REQUEST' });
  });
  it('lets only the request’s buyer answer, once; "I want this" opens a chat thread', () => {
    expect(answerResponse({ status: 'SENT' }, { buyerId: 'buyer' }, 'other', 'WANTED')).toMatchObject({ code: 'NOT_FOUND' });
    expect(answerResponse({ status: 'SENT' }, { buyerId: 'buyer' }, 'buyer', 'WANTED')).toEqual({ ok: true, status: 'WANTED', opensThread: true });
    expect(answerResponse({ status: 'SENT' }, { buyerId: 'buyer' }, 'buyer', 'DECLINED')).toEqual({ ok: true, status: 'DECLINED', opensThread: false });
    expect(answerResponse({ status: 'WANTED' }, { buyerId: 'buyer' }, 'buyer', 'DECLINED')).toMatchObject({ code: 'INVALID_STATE' });
  });
  it('shares a created listing only for a WANTED response owned by that seller', () => {
    expect(mayShareFromResponse({ sellerId: 'sel1', status: 'WANTED', threadId: 'th1' }, 'sel1')).toBe(true);
    expect(mayShareFromResponse({ sellerId: 'sel1', status: 'SENT', threadId: null }, 'sel1')).toBe(false);
    expect(mayShareFromResponse({ sellerId: 'sel2', status: 'WANTED', threadId: 'th1' }, 'sel1')).toBe(false);
    expect(mayShareFromResponse(undefined, 'sel1')).toBe(false);
  });
  it('closes by the buyer and expires after 7 days', () => {
    expect(closeRequest({ status: 'OPEN', buyerId: 'buyer' }, 'buyer')).toEqual({ ok: true });
    expect(closeRequest({ status: 'OPEN', buyerId: 'buyer' }, 'x')).toMatchObject({ code: 'NOT_FOUND' });
    expect(closeRequest({ status: 'CLOSED', buyerId: 'buyer' }, 'buyer')).toMatchObject({ code: 'CLOSED' });
    const r = { status: 'OPEN' as const, expiresAt: requestExpiry(1000) };
    expect(isRequestDue(r, 1000 + 7 * DAY - 1)).toBe(false);
    expect(isRequestDue(r, 1000 + 7 * DAY)).toBe(true);
    expect(isRequestDue({ ...r, status: 'CLOSED' }, 1000 + 8 * DAY)).toBe(false);
  });
});
