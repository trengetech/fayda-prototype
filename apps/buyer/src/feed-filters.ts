import type { FeedParams } from '@fayda/api-client';
import { parseRupees, rupeesToPaise, validateFeedFilters, type FeedSort } from '@fayda/domain';

/** What the filter panel holds. Prices are what the person typed (rupees); `filtersToParams` turns them into paise. */
export interface Filters {
  category: string | null;
  size: string | null;
  acceptsOffers: boolean;
  sort: FeedSort;
  minRupees: string;
  maxRupees: string;
}

export const NO_FILTERS: Filters = { category: null, size: null, acceptsOffers: false, sort: 'NEWEST', minRupees: '', maxRupees: '' };

export const SORT_LABELS: Record<FeedSort, string> = { NEWEST: 'Newest', PRICE_LOW: 'Price: low to high', PRICE_HIGH: 'Price: high to low' };

/** How many filters are set (sort counts only when it is not the default). Shown on the Filters button. */
export const activeFilterCount = (f: Filters): number =>
  [f.category, f.size, f.acceptsOffers || null, f.sort !== 'NEWEST' || null, f.minRupees.trim() || null, f.maxRupees.trim() || null].filter(Boolean).length;

/**
 * The query to send, or per-field messages when what was typed is not usable. Uses the same rules as the server
 * (`validateFeedFilters`), so the person is told here and the request is never sent half-wrong.
 */
export function filtersToParams(q: string, f: Filters): { params: Omit<FeedParams, 'cursor'>; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const money = (text: string, key: 'minPrice' | 'maxPrice'): number | undefined => {
    if (!text.trim()) return undefined;
    const rupees = parseRupees(text);
    if (rupees == null) {
      errors[key] = 'Enter a whole number of rupees.';
      return undefined;
    }
    return rupeesToPaise(rupees);
  };
  const minPrice = money(f.minRupees, 'minPrice');
  const maxPrice = money(f.maxRupees, 'maxPrice');
  Object.assign(errors, validateFeedFilters({ category: f.category, minPrice: minPrice ?? null, maxPrice: maxPrice ?? null, size: f.size }));
  const params: Omit<FeedParams, 'cursor'> = {
    scope: 'FOR_YOU',
    sort: f.sort,
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.size ? { size: f.size } : {}),
    ...(f.acceptsOffers ? { acceptsOffers: true } : {}),
    ...(minPrice != null && !errors.minPrice ? { minPrice } : {}),
    ...(maxPrice != null && !errors.maxPrice ? { maxPrice } : {}),
  };
  return { params, errors };
}
