/**
 * For You scoring (I-39): a plain, explainable formula, no ML. Pure and integer, so the same inputs always give the same score
 * and a page cursor can carry it exactly. The weights are provisional (DECISIONS I-39) and live in one place, `RANK_WEIGHTS`.
 *
 * Saves are deliberately not an input: a save is private to the buyer (I-28), and using it would let it leak into what others see.
 */
export const RANK_WEIGHTS = {
  /** Points a brand-new listing gets for recency, halving every `RECENCY_HALF_LIFE_HOURS`. */
  RECENCY_MAX: 3000,
  RECENCY_HALF_LIFE_HOURS: 96,
  /** Likes and views are logged (diminishing returns) so a popular listing cannot bury everything else. */
  LIKES_PER_DOUBLING: 300,
  LIKES_CAP: 1800,
  VIEWS_PER_DOUBLING: 120,
  VIEWS_CAP: 1000,
  /** The seller's public record: delivered share of orders, once there are enough orders to mean something. */
  RECORD_MAX: 1000,
  RECORD_MIN_ORDERS: 3,
  /** A seller with no record yet is treated as in the middle, so a new shop is neither punished nor favoured by it. */
  RECORD_UNKNOWN: 500,
  FAST_CONFIRM_HOURS: 6,
  FAST_CONFIRM_BONUS: 200,
  OK_CONFIRM_HOURS: 24,
  OK_CONFIRM_BONUS: 100,
  /** A listing in stock gets this; one sold out has its whole score cut to `SOLD_OUT_PERCENT`. */
  IN_STOCK_BONUS: 300,
  SOLD_OUT_PERCENT: 10,
  /** Fairness: a listing under `NEW_LISTING_HOURS` old, and a shop under `NEW_SELLER_DAYS` old, get a head start that fades out. */
  NEW_LISTING_BONUS: 600,
  NEW_LISTING_HOURS: 48,
  NEW_SELLER_BONUS: 300,
  NEW_SELLER_DAYS: 14,
  /** Added at request time, per buyer, when they follow the shop. Not stored. */
  FOLLOW_BOOST: 1500,
  /** The score is kept inside 0 to MAX_SCORE, which is below RELEVANCE_SCALE so it can sit under a relevance number. */
  MAX_SCORE: 9999,
} as const;

export interface RankSignals {
  ageHours: number;
  likes: number;
  /** Product-page opens in the last 30 days (I-35). */
  views30d: number;
  /** Units in stock across all sizes. */
  stockUnits: number;
  sellerAgeDays: number;
  /** The shop's public record (`SellerStats`): orders placed, delivered or confirmed, and the median time to confirm. */
  sellerOrders: number;
  sellerCompleted: number;
  sellerMedianConfirmHours: number | null;
}

const W = RANK_WEIGHTS;
const log2 = (n: number) => Math.log2(1 + Math.max(0, n));

/** The parts of a score, so a ranking can be explained and tuned. They add up to `rankScore` (before the sold-out cut). */
export function rankParts(s: RankSignals): Record<'recency' | 'likes' | 'views' | 'record' | 'stock' | 'newListing' | 'newSeller', number> {
  const age = Math.max(0, s.ageHours);
  const recency = W.RECENCY_MAX * Math.pow(0.5, age / W.RECENCY_HALF_LIFE_HOURS);
  const likes = Math.min(W.LIKES_CAP, W.LIKES_PER_DOUBLING * log2(s.likes));
  const views = Math.min(W.VIEWS_CAP, W.VIEWS_PER_DOUBLING * log2(s.views30d));
  let record: number = W.RECORD_UNKNOWN;
  if (s.sellerOrders >= W.RECORD_MIN_ORDERS) {
    record = W.RECORD_MAX * (s.sellerCompleted / s.sellerOrders);
    const h = s.sellerMedianConfirmHours;
    if (h != null) record += h <= W.FAST_CONFIRM_HOURS ? W.FAST_CONFIRM_BONUS : h <= W.OK_CONFIRM_HOURS ? W.OK_CONFIRM_BONUS : 0;
  }
  const stock = s.stockUnits > 0 ? W.IN_STOCK_BONUS : 0;
  const newListing = age >= W.NEW_LISTING_HOURS ? 0 : W.NEW_LISTING_BONUS * (1 - age / W.NEW_LISTING_HOURS);
  const newSeller = s.sellerOrders === 0 && s.sellerAgeDays < W.NEW_SELLER_DAYS ? W.NEW_SELLER_BONUS * (1 - s.sellerAgeDays / W.NEW_SELLER_DAYS) : 0;
  return { recency, likes, views, record, stock, newListing, newSeller };
}

/** The stored score: a whole number from 0 to MAX_SCORE. A sold-out listing keeps a tenth of it, so it sinks but is still findable. */
export function rankScore(s: RankSignals): number {
  const parts = rankParts(s);
  let total = Object.values(parts).reduce((a, b) => a + b, 0);
  if (s.stockUnits <= 0) total = (total * W.SOLD_OUT_PERCENT) / 100;
  return Math.max(0, Math.min(W.MAX_SCORE, Math.round(total)));
}
