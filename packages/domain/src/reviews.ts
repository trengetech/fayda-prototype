import { RULES } from './rules.js';
import { fail, type Result } from './types.js';

export interface ReviewInput {
  rating?: unknown;
  text?: string | null;
  /** undefined means "keep the existing media" when editing. */
  media?: unknown[];
}
/** D15 (founder, 31 Oct 2026): a review needs an order that reached CONFIRMED. Cancelling later does not take the right away. */
export const canReviewOrder = (o: { buyerId: string; confirmedAt: number | null }, userId: string): Result =>
  o.buyerId !== userId ? fail('NOT_FOUND', 'Order not found.') : o.confirmedAt == null ? fail('NOT_CONFIRMED', 'You can review once the seller has confirmed the order.') : { ok: true };

export function validateReview(i: ReviewInput): { errors: Record<string, string>; rating: number; text: string } {
  const f: Record<string, string> = {};
  const rating = Number(i.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) f.rating = 'Choose 1 to 5 stars.';
  const text = String(i.text ?? '').trim();
  if (text.length > 1000) f.text = 'Keep it under 1,000 characters.';
  else if (Number.isInteger(rating) && rating >= 1 && rating <= RULES.LOW_RATING_MAX && text.length < RULES.LOW_RATING_MIN_TEXT)
    f.text = 'Tell other buyers what went wrong (at least 10 characters).';
  if (i.media && i.media.length > RULES.MAX_MEDIA_PER_REVIEW) f.media = 'Up to 4 photos or videos.';
  return { errors: f, rating, text };
}

/** Average rating to 1 decimal place, or null with no reviews. */
export function ratingSummary(ratings: readonly number[]): { rating: number | null; reviewCount: number } {
  if (!ratings.length) return { rating: null, reviewCount: 0 };
  return { rating: Math.round((ratings.reduce((t, r) => t + r, 0) / ratings.length) * 10) / 10, reviewCount: ratings.length };
}
