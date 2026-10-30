import { describe, expect, it } from 'vitest';
import { formatRupees, isWholeRupees, rupeesToPaise } from '../src/index.js';

describe('formatRupees', () => {
  it('uses Indian digit grouping', () => {
    expect(formatRupees(250_000_00)).toBe('₹2,50,000');
    expect(formatRupees(1_000_000_00)).toBe('₹10,00,000');
    expect(formatRupees(250_000)).toBe('₹2,500');
  });
  it('formats zero and small amounts', () => {
    expect(formatRupees(0)).toBe('₹0');
    expect(formatRupees(5_000)).toBe('₹50');
  });
  it('rounds fractions of a rupee to the nearest rupee', () => {
    expect(formatRupees(10_049)).toBe('₹100');
    expect(formatRupees(10_050)).toBe('₹101');
  });
});

describe('paise helpers', () => {
  it('converts rupees to paise', () => {
    expect(rupeesToPaise(2500)).toBe(250_000);
    expect(rupeesToPaise(19.99)).toBe(1_999);
  });
  it('accepts only whole-rupee integers', () => {
    expect(isWholeRupees(250_000)).toBe(true);
    expect(isWholeRupees(250_050)).toBe(false);
    expect(isWholeRupees(2500.5)).toBe(false);
  });
});
