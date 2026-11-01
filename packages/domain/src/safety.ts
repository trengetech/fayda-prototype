/**
 * Safety rules (I-31): reporting a comment or chat message, and blocking a person. Pure; the API runs the queries.
 * Google Play expects both for any app with user-generated content.
 */

export const REPORT_REASONS = ['SPAM', 'ABUSE', 'SCAM', 'OTHER'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  SPAM: 'Spam',
  ABUSE: 'Abuse or harassment',
  SCAM: 'Misleading or a scam',
  OTHER: 'Something else',
};
export const REPORT_NOTE_MAX_CHARS = 300;
/** Per person, across everything, in any rolling hour. */
export const REPORTS_PER_HOUR = 10;

export type SafetyFailure = 'VALIDATION' | 'FORBIDDEN' | 'RATE_LIMITED' | 'BLOCKED';
type Refusal = { ok: false; code: SafetyFailure; message: string };
const refuse = (code: SafetyFailure, message: string): Refusal => ({ ok: false, code, message });

/** The note is optional: trimmed, at most 300 characters (counted as characters), empty becomes none. */
export function validateReport(input: { reason: string; note?: string | null }): { ok: true; reason: ReportReason; note: string | null } | Refusal {
  if (!(REPORT_REASONS as readonly string[]).includes(input.reason)) return refuse('VALIDATION', 'Pick a reason.');
  const note = String(input.note ?? '').trim();
  if ([...note].length > REPORT_NOTE_MAX_CHARS) return refuse('VALIDATION', `Keep the note under ${REPORT_NOTE_MAX_CHARS} characters.`);
  return { ok: true, reason: input.reason as ReportReason, note: note || null };
}

/** You cannot report your own words, and a person is held to a number of reports an hour. */
export function mayReport(c: { reporterUserId: string; authorUserId: string; reportsInLastHour: number }): { ok: true } | Refusal {
  if (c.reporterUserId === c.authorUserId) return refuse('FORBIDDEN', 'You can’t report your own message.');
  if (c.reportsInLastHour >= REPORTS_PER_HOUR) return refuse('RATE_LIMITED', 'You’ve sent a lot of reports. Try again in a little while.');
  return { ok: true };
}

/** You cannot block yourself. */
export function mayBlock(c: { blockerUserId: string; targetUserId: string }): { ok: true } | Refusal {
  if (c.blockerUserId === c.targetUserId) return refuse('FORBIDDEN', 'You can’t block yourself.');
  return { ok: true };
}

/**
 * May this person comment on this seller's listing? Not if the seller has blocked them. A buyer blocking someone only hides
 * that person's comments from the buyer; it never stops anyone posting.
 */
export function mayCommentOn(c: { commenterUserId: string; listingOwnerUserId: string; ownerBlocked: ReadonlySet<string> }): { ok: true } | Refusal {
  if (c.commenterUserId !== c.listingOwnerUserId && c.ownerBlocked.has(c.commenterUserId)) return refuse('BLOCKED', 'You can’t comment on this shop’s listings.');
  return { ok: true };
}

/** A block in either direction ends new chat messages between two people. Existing orders and their records stay readable. */
export function mayMessage(c: { blockedEitherWay: boolean }): { ok: true } | Refusal {
  return c.blockedEitherWay ? refuse('BLOCKED', 'You can’t message this person.') : { ok: true };
}
