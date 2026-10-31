import type { SellerRequest } from '@fayda/contracts/schemas';
import { parseRupees } from '@fayda/domain';
import { RULES } from '@fayda/domain';
import { emptyValues, type EditorValues } from './listing-form';

export const REQUEST_TABS = ['New', 'Responded'] as const;
export type RequestTab = (typeof REQUEST_TABS)[number];
export const inRequestTab = (r: SellerRequest, t: RequestTab): boolean => (t === 'New' ? !r.response && r.status === 'OPEN' : !!r.response);

export const RESPONSE_LABEL = { SENT: 'Sent, waiting for the buyer', WANTED: 'The buyer wants this', DECLINED: 'Not for this buyer' } as const;

/** Checks a response before it is sent. The server repeats these checks. */
export function validateRespondForm(f: { mediaCount: number; price: string; text: string }): { errors: Record<string, string>; price: number | null } {
  const errors: Record<string, string> = {};
  if (f.mediaCount < 1) errors.media = 'Add a photo of the item you have.';
  else if (f.mediaCount > RULES.MAX_MEDIA_PER_REQUEST) errors.media = 'Up to 4 photos.';
  let price: number | null = null;
  if (f.price.trim() !== '') {
    const r = parseRupees(f.price);
    if (r == null || r < 1) errors.price = 'Enter a whole-rupee price, or leave it blank.';
    else price = r * 100;
  }
  if (f.text.trim().length > 500) errors.text = 'Keep it under 500 characters.';
  return { errors, price };
}

/** The editor's starting values for "Create listing" from a response the buyer wants: fixed price, one unit of the asked size. */
export function prefillFromRequest(r: SellerRequest): EditorValues {
  const v = emptyValues();
  return {
    ...v,
    title: r.title,
    description: r.description ?? '',
    category: r.category,
    price: r.response?.price != null ? String(Math.round(r.response.price / 100)) : '',
    variants: [{ label: r.size ?? '', stock: '' }],
    mode: 'BUY_NOW',
  };
}
