import { isWholeRupees, type Paise } from './money.js';
import { CATEGORIES, RULES } from './rules.js';
import { fail, type Result } from './types.js';

export type RequestStatus = 'OPEN' | 'CLOSED' | 'EXPIRED';
export type ResponseStatus = 'SENT' | 'WANTED' | 'DECLINED';

const priceOk = (p: Paise): boolean => isWholeRupees(p) && p >= RULES.MIN_PRICE_PAISE && p <= RULES.MAX_PRICE_PAISE;

export interface RequestInput {
  category?: string;
  title?: string;
  description?: string | null;
  size?: string | null;
  budget?: Paise | null;
  mediaCount: number;
}
export function validateRequest(i: RequestInput): Record<string, string> {
  const f: Record<string, string> = {};
  const title = String(i.title ?? '').trim();
  if (!(CATEGORIES as readonly string[]).includes(i.category ?? '')) f.category = 'Choose a category.';
  if (title.length < 3 || title.length > 80) f.title = 'Describe what you want in 3–80 characters.';
  if (String(i.description ?? '').trim().length > 500) f.description = 'Keep it under 500 characters.';
  if (i.budget != null && !priceOk(i.budget)) f.budget = 'Enter a whole-rupee budget, or leave it blank.';
  if (i.mediaCount < 1) f.media = 'Add at least one photo of what you’re looking for.';
  else if (i.mediaCount > RULES.MAX_MEDIA_PER_REQUEST) f.media = 'Up to 4 photos.';
  return f;
}

export const requestExpiry = (createdAt: number): number => createdAt + RULES.REQUEST_OPEN_MS;
/** The sweep expires OPEN requests once this is true. */
export const isRequestDue = (r: { status: RequestStatus; expiresAt: number }, now: number): boolean => r.status === 'OPEN' && now >= r.expiresAt;

/** Sellers to notify: those who sell the category, excluding the buyer's own shop. */
export const sellersReached = <T extends { userId: string; categories: readonly string[] }>(sellers: readonly T[], category: string, buyerUserId: string): T[] =>
  sellers.filter((s) => s.categories.includes(category) && s.userId !== buyerUserId);

export interface ResponseCheck {
  request: { status: RequestStatus; category: string; buyerId: string };
  seller: { userId: string; categories: readonly string[] };
  alreadyResponded: boolean;
  text?: string | null;
  price?: Paise | null;
  mediaCount: number;
}
export function validateResponse(c: ResponseCheck): Result {
  if (c.request.status !== 'OPEN') return fail('CLOSED', 'This request is closed.');
  if (c.request.buyerId === c.seller.userId) return fail('OWN_REQUEST', 'You can’t respond to your own request.');
  if (!c.seller.categories.includes(c.request.category)) return fail('NOT_IN_CATEGORY', 'This request is for a category you don’t sell.');
  if (c.alreadyResponded) return fail('ALREADY_RESPONDED', 'You’ve already responded to this request.');
  const f: Record<string, string> = {};
  if (String(c.text ?? '').trim().length > 500) f.text = 'Keep it under 500 characters.';
  if (c.price != null && !priceOk(c.price)) f.price = 'Enter a whole-rupee price, or leave it blank.';
  if (c.mediaCount < 1) f.media = 'Add a photo of the item you have.';
  else if (c.mediaCount > RULES.MAX_MEDIA_PER_REQUEST) f.media = 'Up to 4 photos.';
  return Object.keys(f).length ? fail('VALIDATION', 'Check the highlighted fields.', f) : { ok: true };
}

/** "I want this" / "Not for me": only the buyer of the request, only on a response still SENT. */
export function answerResponse(
  r: { status: ResponseStatus },
  request: { buyerId: string },
  userId: string,
  answer: 'WANTED' | 'DECLINED',
): Result<{ status: ResponseStatus; opensThread: boolean }> {
  if (request.buyerId !== userId) return fail('NOT_FOUND', 'Response not found.');
  if (r.status !== 'SENT') return fail('INVALID_STATE', r.status === 'WANTED' ? 'You already said you want this.' : 'You already answered this response.');
  return { ok: true, status: answer, opensThread: answer === 'WANTED' };
}

export function closeRequest(r: { status: RequestStatus; buyerId: string }, userId: string): Result {
  if (r.buyerId !== userId) return fail('NOT_FOUND', 'Request not found.');
  return r.status !== 'OPEN' ? fail('CLOSED', 'This request is already closed.') : { ok: true };
}

/** A listing published with `fromResponseId` is shared in the chat only if the response is WANTED and belongs to this seller. */
export const mayShareFromResponse = (x: { sellerId: string; status: ResponseStatus; threadId: string | null } | undefined, sellerId: string): boolean =>
  !!x && x.sellerId === sellerId && x.status === 'WANTED' && !!x.threadId;
