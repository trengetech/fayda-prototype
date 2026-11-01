import { describe, expect, it } from 'vitest';
import { COMMENTS_PER_HOUR, COMMENT_MAX_CHARS, SAVE_LIMIT, formatAgo, formatCount, mayComment, mayLike, maySave, removalBy, validateComment } from '../src/index.js';

describe('comments', () => {
  it('trims, squeezes blank lines, and refuses empty and over-long text', () => {
    expect(validateComment('  Is it true to size?  ')).toEqual({ ok: true, text: 'Is it true to size?' });
    expect(validateComment('a\r\n\r\n\r\n\r\nb  \nc')).toEqual({ ok: true, text: 'a\n\nb\nc' });
    expect(validateComment('   \n ')).toMatchObject({ ok: false, code: 'EMPTY' });
    expect(validateComment(null)).toMatchObject({ ok: false, code: 'EMPTY' });
    expect(validateComment('x'.repeat(COMMENT_MAX_CHARS))).toMatchObject({ ok: true });
    expect(validateComment('x'.repeat(COMMENT_MAX_CHARS + 1))).toMatchObject({ ok: false, code: 'TOO_LONG' });
  });
  it('counts characters, not code units, so an emoji is one', () => {
    expect(validateComment('😀'.repeat(COMMENT_MAX_CHARS))).toMatchObject({ ok: true });
    expect(validateComment('😀'.repeat(COMMENT_MAX_CHARS + 1))).toMatchObject({ ok: false, code: 'TOO_LONG' });
  });
  it('needs a live listing and stays inside the hourly limit', () => {
    expect(mayComment({ listingStatus: 'ACTIVE', commentsInLastHour: COMMENTS_PER_HOUR - 1 })).toEqual({ ok: true });
    expect(mayComment({ listingStatus: 'ACTIVE', commentsInLastHour: COMMENTS_PER_HOUR })).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
    for (const s of ['DRAFT', 'PAUSED'] as const) expect(mayComment({ listingStatus: s, commentsInLastHour: 0 })).toMatchObject({ ok: false, code: 'NOT_AVAILABLE' });
    // The owner replying as the shop may answer on a paused listing, but never on a draft.
    expect(mayComment({ listingStatus: 'PAUSED', commentsInLastHour: 0, asOwner: true })).toEqual({ ok: true });
    expect(mayComment({ listingStatus: 'DRAFT', commentsInLastHour: 0, asOwner: true })).toMatchObject({ ok: false, code: 'NOT_AVAILABLE' });
    expect(mayComment({ listingStatus: 'PAUSED', commentsInLastHour: 20, asOwner: true })).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
  it('lets the author or the listing owner remove a comment, and nobody else', () => {
    expect(removalBy({ actorUserId: 'a', authorUserId: 'a', listingOwnerUserId: 's' })).toBe('AUTHOR');
    expect(removalBy({ actorUserId: 's', authorUserId: 'a', listingOwnerUserId: 's' })).toBe('SELLER');
    expect(removalBy({ actorUserId: 'x', authorUserId: 'a', listingOwnerUserId: 's' })).toBeNull();
    expect(removalBy({ actorUserId: 's', authorUserId: 's', listingOwnerUserId: 's' })).toBe('AUTHOR'); // the shop's own reply
  });
});

describe('likes and saves', () => {
  it('a like needs a live listing that is not yours', () => {
    expect(mayLike({ actorUserId: 'a', listingOwnerUserId: 's', listingStatus: 'ACTIVE' })).toEqual({ ok: true });
    expect(mayLike({ actorUserId: 's', listingOwnerUserId: 's', listingStatus: 'ACTIVE' })).toMatchObject({ ok: false, code: 'OWN_LISTING' });
    expect(mayLike({ actorUserId: 'a', listingOwnerUserId: 's', listingStatus: 'PAUSED' })).toMatchObject({ ok: false, code: 'NOT_AVAILABLE' });
  });
  it('a save needs a live listing that is not yours, and room under the limit', () => {
    const me = { actorUserId: 'a', listingOwnerUserId: 's' };
    expect(maySave({ ...me, listingStatus: 'ACTIVE', currentCount: SAVE_LIMIT - 1 })).toEqual({ ok: true });
    expect(maySave({ ...me, listingStatus: 'ACTIVE', currentCount: SAVE_LIMIT })).toMatchObject({ ok: false, code: 'SAVE_LIMIT' });
    expect(maySave({ ...me, listingStatus: 'DRAFT', currentCount: 0 })).toMatchObject({ ok: false, code: 'NOT_AVAILABLE' });
    expect(maySave({ actorUserId: 's', listingOwnerUserId: 's', listingStatus: 'ACTIVE', currentCount: 0 })).toMatchObject({ ok: false, code: 'OWN_LISTING' });
  });
});

describe('formatCount', () => {
  it('shortens thousands and millions, and never rounds up past the real number', () => {
    expect([0, 7, 999, 1000, 1049, 1250, 12_999, 999_999, 1_000_000, 2_340_000].map(formatCount)).toEqual(['0', '7', '999', '1k', '1k', '1.2k', '12.9k', '999.9k', '1M', '2.3M']);
    expect(formatCount(-3)).toBe('0');
    expect(formatCount(Number.NaN)).toBe('0');
  });
});

describe('formatAgo', () => {
  const now = Date.UTC(2026, 10, 1, 12, 0, 0);
  it('says how long ago, in the smallest sensible unit', () => {
    const ago = (ms: number) => formatAgo(now - ms, now);
    expect([ago(5_000), ago(59_999), ago(60_000), ago(59 * 60_000), ago(3_600_000), ago(23 * 3_600_000), ago(24 * 3_600_000), ago(6 * 86_400_000)]).toEqual(['just now', 'just now', '1 min ago', '59 min ago', '1 h ago', '23 h ago', '1 d ago', '6 d ago']);
    expect(ago(8 * 86_400_000)).toBe('24 Oct');
  });
  it('treats a time in the future (clock skew) as just now', () => {
    expect(formatAgo(now + 5000, now)).toBe('just now');
  });
});
