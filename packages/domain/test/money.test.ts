import { describe, expect, it } from 'vitest';
import { formatRupees, isWholeRupees, rupeesToPaise, timeLeft, parseRupees, priceAfterPercentOff } from '../src/index.js';

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

describe('timeLeft', () => {
  const t = (ms: number) => timeLeft(1_000_000 + ms, 1_000_000);
  it('reads as a countdown', () => {
    expect(t(-1)).toBe('expired');
    expect(t(30_000)).toBe('less than a minute');
    expect(t(30 * 60_000)).toBe('30 min');
    expect(t(60 * 60_000)).toBe('1 h');
    expect(t(125 * 60_000)).toBe('2 h 5 min');
    expect(t(26 * 3_600_000)).toBe('1 d 2 h');
  });
});

describe('parseRupees and priceAfterPercentOff', () => {
  it('reads whole rupees and nothing else', () => {
    expect(parseRupees('1,250')).toBe(1250);
    expect(parseRupees(' ₹ 900 ')).toBe(900);
    for (const bad of ['', '0', '12.50', '-5', 'abc', '12345678']) expect(parseRupees(bad)).toBeNull();
  });
  it('rounds a percent-off price to a whole rupee, in paise', () => {
    expect(priceAfterPercentOff(150000, 20)).toBe(120000);
    expect(priceAfterPercentOff(99900, 15)).toBe(84900); // 849.15 rounds to ₹849
    expect(priceAfterPercentOff(150000, 0)).toBe(150000);
  });
});
