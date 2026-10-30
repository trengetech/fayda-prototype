/** All money is integer paise (1 rupee = 100 paise). */
export type Paise = number;

export const rupeesToPaise = (rupees: number): Paise => Math.round(rupees * 100);

export const isWholeRupees = (paise: Paise): boolean => Number.isInteger(paise) && paise % 100 === 0;

/** Formats paise as ₹ with Indian digit grouping, e.g. 25000000 -> "₹2,50,000". Fractions round to the nearest rupee. */
export function formatRupees(paise: Paise): string {
  return '₹' + Math.round(paise / 100).toLocaleString('en-IN');
}
