/**
 * Social rules: likes, saves and comments on a listing. Pure; the API runs the queries, these decide what is allowed,
 * so the apps and the server cannot disagree. Follows are in `discovery.ts`.
 */

export const COMMENT_MAX_CHARS = 300;
/** Per person, across all listings, in any rolling hour. Stops floods; a real question never comes close. */
export const COMMENTS_PER_HOUR = 20;
export const SAVE_LIMIT = 1000;
export const LIKE_TARGETS = ['LISTING'] as const;
export type LikeTarget = (typeof LIKE_TARGETS)[number];
export const SAVE_TARGETS = ['LISTING'] as const;
export type SaveTarget = (typeof SAVE_TARGETS)[number];

type ListingState = 'DRAFT' | 'ACTIVE' | 'PAUSED';
export type SocialFailure = 'EMPTY' | 'TOO_LONG' | 'NOT_AVAILABLE' | 'OWN_LISTING' | 'RATE_LIMITED' | 'SAVE_LIMIT' | 'FORBIDDEN';
type Refusal = { ok: false; code: SocialFailure; message: string };
const refuse = (code: SocialFailure, message: string): Refusal => ({ ok: false, code, message });

/** What a person typed as a comment: trimmed, with runs of blank lines squeezed, 1 to 300 characters. */
export function validateComment(raw: string | null | undefined): { ok: true; text: string } | Refusal {
  const text = String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return refuse('EMPTY', 'Write a comment first.');
  if ([...text].length > COMMENT_MAX_CHARS) return refuse('TOO_LONG', `Keep comments under ${COMMENT_MAX_CHARS} characters.`);
  return { ok: true, text };
}

/** Only a live listing takes new comments, likes and saves; the person must be inside the hourly comment limit. */
/** A buyer needs a live listing. The owner replying as the shop may also answer on a paused one (a question can arrive just before it is paused). Nobody comments on a draft. */
export function mayComment(c: { listingStatus: ListingState; commentsInLastHour: number; asOwner?: boolean }): { ok: true } | Refusal {
  if (c.listingStatus === 'DRAFT' || (c.listingStatus !== 'ACTIVE' && !c.asOwner)) return refuse('NOT_AVAILABLE', 'This listing isn’t available.');
  if (c.commentsInLastHour >= COMMENTS_PER_HOUR) return refuse('RATE_LIMITED', 'You’re commenting very quickly. Try again in a little while.');
  return { ok: true };
}

/** A like needs a live listing that is not your own (a shop liking itself would only inflate its numbers). Removing a like is always allowed. */
export function mayLike(c: { actorUserId: string; listingOwnerUserId: string; listingStatus: ListingState }): { ok: true } | Refusal {
  if (c.listingStatus !== 'ACTIVE') return refuse('NOT_AVAILABLE', 'This listing isn’t available.');
  if (c.actorUserId === c.listingOwnerUserId) return refuse('OWN_LISTING', 'You can’t like your own listing.');
  return { ok: true };
}

/** A save needs a live listing that is not your own (a shop saving itself would only inflate its numbers) and room under the limit. Removing a save is always allowed. */
export function maySave(c: { actorUserId: string; listingOwnerUserId: string; listingStatus: ListingState; currentCount: number }): { ok: true } | Refusal {
  if (c.listingStatus !== 'ACTIVE') return refuse('NOT_AVAILABLE', 'This listing isn’t available.');
  if (c.actorUserId === c.listingOwnerUserId) return refuse('OWN_LISTING', 'You can’t save your own listing.');
  if (c.currentCount >= SAVE_LIMIT) return refuse('SAVE_LIMIT', `You can save up to ${SAVE_LIMIT} listings. Remove one first.`);
  return { ok: true };
}

/** Who may take a comment down: its author, or the owner of the listing it is on. Anyone else may not. */
export function removalBy(c: { actorUserId: string; authorUserId: string; listingOwnerUserId: string }): 'AUTHOR' | 'SELLER' | null {
  if (c.actorUserId === c.authorUserId) return 'AUTHOR';
  if (c.actorUserId === c.listingOwnerUserId) return 'SELLER';
  return null;
}

/** 999 stays 999; 1,000 and up shorten to 1k, 1.2k, 12k, 1.2M. For counts under a heart or a speech bubble. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.floor(n));
  const short = (v: number, unit: string) => `${(Math.floor(v * 10) / 10).toString().replace(/\.0$/, '')}${unit}`;
  return n < 1_000_000 ? short(n / 1000, 'k') : short(n / 1_000_000, 'M');
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a date such as "12 Oct". For comment times; `now` is passed in so it can be tested. */
export function formatAgo(then: number, now: number): string {
  const s = Math.max(0, Math.floor((now - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d ago`;
  const date = new Date(then);
  return `${date.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()]}`;
}
