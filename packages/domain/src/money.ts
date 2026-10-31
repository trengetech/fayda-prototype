/** All money is integer paise (1 rupee = 100 paise). */
export type Paise = number;

export const rupeesToPaise = (rupees: number): Paise => Math.round(rupees * 100);

export const isWholeRupees = (paise: Paise): boolean => Number.isInteger(paise) && paise % 100 === 0;

/** Formats paise as ₹ with Indian digit grouping, e.g. 25000000 -> "₹2,50,000". Fractions round to the nearest rupee. */
export function formatRupees(paise: Paise): string {
  return '₹' + Math.round(paise / 100).toLocaleString('en-IN');
}

/** Whole rupees from what a person typed ("1,250", " ₹ 900 "), or null if it is not a positive whole number of at most 7 digits. */
export function parseRupees(text: string): number | null {
  const t = text.replace(/[,\s₹]/g, '');
  if (!/^\d{1,7}$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
}

/** The price after a whole-number percent off, rounded to the nearest rupee, in paise. For "10% off" shortcuts in the offer sheet. */
export function priceAfterPercentOff(listPrice: Paise, percent: number): Paise {
  return Math.round((listPrice * (100 - percent)) / 100 / 100) * 100;
}
