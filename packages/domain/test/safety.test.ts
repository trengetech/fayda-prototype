import { describe, expect, it } from 'vitest';
import { REPORTS_PER_HOUR, mayBlock, mayCommentOn, mayMessage, mayReport, validateReport } from '../src/index.js';

describe('validateReport', () => {
  it('takes a known reason and trims the note', () => {
    expect(validateReport({ reason: 'SPAM', note: '  rude  ' })).toEqual({ ok: true, reason: 'SPAM', note: 'rude' });
    expect(validateReport({ reason: 'ABUSE', note: '   ' })).toEqual({ ok: true, reason: 'ABUSE', note: null });
  });
  it('refuses an unknown reason and a note over 300 characters (emoji count as one)', () => {
    expect(validateReport({ reason: 'RUDE' })).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(validateReport({ reason: 'OTHER', note: '😀'.repeat(300) }).ok).toBe(true);
    expect(validateReport({ reason: 'OTHER', note: 'a'.repeat(301) })).toMatchObject({ ok: false, code: 'VALIDATION' });
  });
});

describe('mayReport', () => {
  it('refuses your own words', () => {
    expect(mayReport({ reporterUserId: 'a', authorUserId: 'a', reportsInLastHour: 0 })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
  });
  it('allows REPORTS_PER_HOUR reports an hour, then limits', () => {
    expect(mayReport({ reporterUserId: 'a', authorUserId: 'b', reportsInLastHour: REPORTS_PER_HOUR - 1 }).ok).toBe(true);
    expect(mayReport({ reporterUserId: 'a', authorUserId: 'b', reportsInLastHour: REPORTS_PER_HOUR })).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
});

describe('blocking', () => {
  it('you cannot block yourself', () => {
    expect(mayBlock({ blockerUserId: 'a', targetUserId: 'a' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(mayBlock({ blockerUserId: 'a', targetUserId: 'b' }).ok).toBe(true);
  });
  it('a seller’s block stops commenting on that seller’s listings only; the owner is never blocked from their own listing', () => {
    const ownerBlocked = new Set(['x']);
    expect(mayCommentOn({ commenterUserId: 'x', listingOwnerUserId: 's', ownerBlocked })).toMatchObject({ ok: false, code: 'BLOCKED' });
    expect(mayCommentOn({ commenterUserId: 'y', listingOwnerUserId: 's', ownerBlocked }).ok).toBe(true);
    expect(mayCommentOn({ commenterUserId: 's', listingOwnerUserId: 's', ownerBlocked: new Set(['s']) }).ok).toBe(true);
  });
  it('a block either way ends new messages', () => {
    expect(mayMessage({ blockedEitherWay: true })).toMatchObject({ ok: false, code: 'BLOCKED' });
    expect(mayMessage({ blockedEitherWay: false }).ok).toBe(true);
  });
});
