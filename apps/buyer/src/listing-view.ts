import type { BuyerListing } from '@fayda/contracts/schemas';

/** What the buyer is told about bargaining. It never says how low the seller will go, because the API never sends that. */
export const bargainingLabel = (b: BuyerListing['bargaining']): string => (b.acceptsOffers ? 'Open to offers' : 'Fixed price');

export type SizeNote = 'Sold out' | 'Few left' | null;
export const sizeNote = (v: BuyerListing['variants'][number]): SizeNote => (!v.available ? 'Sold out' : v.low ? 'Few left' : null);

/** The honest reason the Buy and Make offer buttons do nothing yet. */
export const NOT_YET = 'Buying and offers are not available yet. This is a preview of the listing only.';
