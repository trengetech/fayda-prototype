import type { ListingInput, SellerListing } from '@fayda/contracts/schemas';
import { z } from '@fayda/contracts/schemas';
import { OFFER_EXPIRY_MINUTES, RULES } from '@fayda/domain';

export const MODES = ['BUY_NOW', 'BOTH'] as const;
export type Mode = (typeof MODES)[number];
export const MODE_LABEL: Record<Mode, string> = { BUY_NOW: 'Buy now only', BOTH: 'Buy now + offers' };
export const MODE_HINT: Record<Mode, string> = {
  BUY_NOW: 'Buyers pay the listed price. No bargaining.',
  BOTH: 'Buyers can buy at the listed price, or send you a private offer.',
};
/** How long a buyer's offer waits for a reply, in minutes. */
export const EXPIRY_MINUTES = OFFER_EXPIRY_MINUTES;
export const expiryLabel = (m: number): string => (m < 60 ? `${m} min` : m === 60 ? '1 hour' : `${m / 60} hours`);

/** One photo or video on a listing. `previewUri` is a local file while editing, or the API address once saved. */
export interface EditorMedia {
  mediaId: string;
  kind: 'image' | 'video';
  previewUri: string;
  posterMediaId: string | null;
}

/** What the form holds. Money is typed in rupees, as text, and turned into paise only when saving. */
export interface EditorValues {
  title: string;
  description: string;
  category: string;
  price: string;
  variants: { id?: string; label: string; stock: string }[];
  mode: Mode;
  expiryMinutes: number;
  autoAcceptAt: string;
  autoCounterAt: string;
  autoDeclineBelow: string;
  channel: 'DIRECT' | 'WEBSITE';
  productUrl: string;
  acceptType: 'CODE' | 'LINK';
  acceptValue: string;
  counterType: 'CODE' | 'LINK';
  counterValue: string;
}

const digits = z.string().regex(/^\d*$/, 'Use numbers only.');
/** Shape only (the phone checks the form is well-formed); the real rules and messages come from the server. */
export const EditorSchema = z.object({
  title: z.string().max(200),
  description: z.string().max(2000),
  category: z.string(),
  price: digits.max(8, 'That is too large.'),
  variants: z.array(z.object({ id: z.string().optional(), label: z.string().max(60), stock: digits.max(5, 'Use up to 9,999.') })).max(30),
  mode: z.enum(MODES),
  expiryMinutes: z.number(),
  autoAcceptAt: digits.max(8),
  autoCounterAt: digits.max(8),
  autoDeclineBelow: digits.max(8),
  channel: z.enum(['DIRECT', 'WEBSITE']),
  productUrl: z.string().max(500),
  acceptType: z.enum(['CODE', 'LINK']),
  acceptValue: z.string().max(500),
  counterType: z.enum(['CODE', 'LINK']),
  counterValue: z.string().max(500),
});

export const emptyValues = (): EditorValues => ({
  title: '',
  description: '',
  category: '',
  price: '',
  variants: [{ label: '', stock: '' }],
  mode: 'BUY_NOW',
  expiryMinutes: RULES.DEFAULT_EXPIRY_MINUTES,
  autoAcceptAt: '',
  autoCounterAt: '',
  autoDeclineBelow: '',
  channel: 'DIRECT',
  productUrl: '',
  acceptType: 'CODE',
  acceptValue: '',
  counterType: 'CODE',
  counterValue: '',
});

const rupeesText = (paise: number | null): string => (paise == null ? '' : String(Math.round(paise / 100)));
/** Empty text means "not set" (null); anything else is whole rupees to paise. */
const paiseOrNull = (text: string): number | null => (text.trim() === '' ? null : Number(text) * 100);

export function fromListing(l: SellerListing): { values: EditorValues; media: EditorMedia[] } {
  return {
    values: {
      title: l.title,
      description: l.description,
      category: l.category,
      price: rupeesText(l.price),
      variants: l.variants.length ? l.variants.map((v) => ({ id: v.id, label: v.label, stock: String(v.stock) })) : [{ label: '', stock: '' }],
      mode: l.bargaining.mode as Mode,
      expiryMinutes: l.bargaining.expiryMinutes,
      autoAcceptAt: rupeesText(l.rules.autoAcceptAt),
      autoCounterAt: rupeesText(l.rules.autoCounterAt),
      autoDeclineBelow: rupeesText(l.rules.autoDeclineBelow),
      channel: l.checkout.channel,
      productUrl: l.checkout.productUrl ?? '',
      acceptType: l.dealCodes.accept?.type ?? 'CODE',
      acceptValue: l.dealCodes.accept?.value ?? '',
      counterType: l.dealCodes.counter?.type ?? 'CODE',
      counterValue: l.dealCodes.counter?.value ?? '',
    },
    media: l.media.map((m) => ({ mediaId: m.mediaId, kind: m.kind, previewUri: m.kind === 'video' ? (m.posterUrl ?? m.url) : m.url, posterMediaId: m.posterMediaId })),
  };
}

/** Builds the API request. A fixed-price listing sends no private rules; website deal codes go only where they apply. */
export function toInput(v: EditorValues, media: EditorMedia[], publish: boolean): ListingInput {
  const priced = v.mode === 'BOTH';
  const website = v.channel === 'WEBSITE';
  const deal = (type: 'CODE' | 'LINK', value: string) => (value.trim() ? { type, value: value.trim() } : null);
  return {
    title: v.title.trim(),
    description: v.description.trim(),
    category: v.category,
    price: Number(v.price || 0) * 100,
    media: media.map((m) => ({ mediaId: m.mediaId, ...(m.kind === 'video' && m.posterMediaId ? { posterMediaId: m.posterMediaId } : {}) })),
    variants: v.variants.filter((x) => x.label.trim() !== '' || x.stock !== '').map((x) => ({ ...(x.id ? { id: x.id } : {}), label: x.label.trim(), stock: Number(x.stock || 0) })),
    bargaining: { mode: v.mode, expiryMinutes: v.expiryMinutes },
    rules: priced ? { autoAcceptAt: paiseOrNull(v.autoAcceptAt), autoCounterAt: paiseOrNull(v.autoCounterAt), autoDeclineBelow: paiseOrNull(v.autoDeclineBelow) } : null,
    checkout: { channel: v.channel, ...(website ? { productUrl: v.productUrl.trim() } : {}) },
    dealCodes: website && priced ? { accept: deal(v.acceptType, v.acceptValue), counter: deal(v.counterType, v.counterValue) } : null,
    publish,
  };
}

/**
 * The Idempotency-Key for a save. The same content from the same editor session gets the same key, so pressing Save again
 * after a lost reply cannot create a second listing; changed content gets a new key (the server refuses a reused key with
 * a different body).
 */
export function saveKey(sessionNonce: string, input: ListingInput): string {
  let h = 5381;
  const text = JSON.stringify(input);
  for (let i = 0; i < text.length; i++) h = ((h * 33) ^ text.charCodeAt(i)) >>> 0;
  return `save-${sessionNonce}-${h.toString(36)}`;
}

export const newNonce = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

/** Server field names to the form's field names, so an error appears next to the right input. */
export const FIELD_MAP: Record<string, string> = { mode: 'mode', expiryMinutes: 'expiryMinutes', autoAcceptAt: 'autoAcceptAt', autoCounterAt: 'autoCounterAt', autoDeclineBelow: 'autoDeclineBelow', acceptCode: 'acceptValue', counterCode: 'counterValue' };
