import { describe, expect, it } from 'vitest';
import { MAX_VARIANTS_PER_TERM, RANK_WEIGHTS, RELEVANCE_SCALE, expandSearchTerm, rankScore, type RankSignals } from '../src/index.js';

const base: RankSignals = { ageHours: 100, likes: 0, views30d: 0, stockUnits: 5, sellerAgeDays: 90, sellerOrders: 0, sellerCompleted: 0, sellerMedianConfirmHours: null };
const score = (o: Partial<RankSignals> = {}) => rankScore({ ...base, ...o });

describe('search synonyms', () => {
  it('puts the typed word first, then its spellings', () => {
    expect(expandSearchTerm('Kurti')[0]).toBe('kurti');
    expect(expandSearchTerm('kurti')).toContain('kurta');
    expect(expandSearchTerm('sari')).toContain('saree');
    expect(expandSearchTerm('saree')).toContain('sari');
    expect(expandSearchTerm('lehnga')).toContain('lehenga');
  });
  it('strips a plural and finds the group of the singular', () => {
    expect(expandSearchTerm('kurtas')).toContain('kurta');
    expect(expandSearchTerm('dresses')).toEqual(['dresses', 'dresse']);
    expect(expandSearchTerm('glass')).toEqual(['glass']);
  });
  it('leaves an unknown word alone and caps the list', () => {
    expect(expandSearchTerm('cotton-blend')).toEqual(['cotton-blend']);
    for (const w of ['kurti', 'sari', 'lehenga']) expect(expandSearchTerm(w).length).toBeLessThanOrEqual(MAX_VARIANTS_PER_TERM);
  });
});

describe('For You score', () => {
  it('is a whole number inside 0 to MAX_SCORE, always below the relevance scale', () => {
    const best = score({ ageHours: 0, likes: 1e9, views30d: 1e9, sellerOrders: 50, sellerCompleted: 50, sellerMedianConfirmHours: 1, sellerAgeDays: 0 });
    expect(Number.isInteger(best)).toBe(true);
    expect(best).toBeLessThanOrEqual(RANK_WEIGHTS.MAX_SCORE);
    expect(RANK_WEIGHTS.MAX_SCORE + RANK_WEIGHTS.FOLLOW_BOOST).toBeLessThan(RELEVANCE_SCALE);
    expect(score({ ageHours: 1e6 })).toBeGreaterThanOrEqual(0);
  });
  it('prefers newer, all else equal, and the recency halves at the half-life', () => {
    expect(score({ ageHours: 10 })).toBeGreaterThan(score({ ageHours: 200 }));
    const a = score({ ageHours: 100 });
    const b = score({ ageHours: 100 + RANK_WEIGHTS.RECENCY_HALF_LIFE_HOURS });
    expect(a - b).toBeGreaterThan(0);
  });
  it('rewards likes and views, with diminishing returns', () => {
    expect(score({ likes: 3 })).toBeGreaterThan(score({ likes: 0 }));
    expect(score({ views30d: 50 })).toBeGreaterThan(score({ views30d: 0 }));
    const gain1 = score({ likes: 10 }) - score({ likes: 0 });
    const gain2 = score({ likes: 1010 }) - score({ likes: 1000 });
    expect(gain2).toBeLessThan(gain1);
  });
  it('trusts a shop that delivers and confirms fast, and ignores a record with too few orders', () => {
    const good = score({ sellerOrders: 10, sellerCompleted: 10, sellerMedianConfirmHours: 2 });
    const poor = score({ sellerOrders: 10, sellerCompleted: 2, sellerMedianConfirmHours: 40 });
    expect(good).toBeGreaterThan(poor);
    expect(score({ sellerOrders: 2, sellerCompleted: 0 })).toBe(score({ sellerOrders: 0, sellerCompleted: 0 }));
  });
  it('sinks a sold-out listing but keeps it above zero', () => {
    const inStock = score({ likes: 20 });
    const gone = score({ likes: 20, stockUnits: 0 });
    expect(gone).toBeLessThan(inStock / 5);
    expect(gone).toBeGreaterThan(0);
  });
  it('gives a new listing and a new shop a head start that fades out', () => {
    expect(score({ ageHours: 1 })).toBeGreaterThan(score({ ageHours: 47 }));
    const fresh = score({ ageHours: 100, sellerAgeDays: 1 });
    const old = score({ ageHours: 100, sellerAgeDays: 100 });
    expect(fresh).toBeGreaterThan(old);
    expect(score({ ageHours: 100, sellerAgeDays: 1, sellerOrders: 5, sellerCompleted: 5 })).toBe(score({ ageHours: 100, sellerAgeDays: 100, sellerOrders: 5, sellerCompleted: 5 }));
  });
});
