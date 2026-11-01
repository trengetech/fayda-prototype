import type { SellerListing } from '@fayda/contracts/schemas';
import { EditorSchema, emptyValues, fromListing, saveKey, toInput, type EditorMedia, type EditorValues } from '../src/listing-form';

const photo: EditorMedia = { mediaId: 'm1', kind: 'image', previewUri: 'file:///a.jpg', posterMediaId: null };
const video: EditorMedia = { mediaId: 'm2', kind: 'video', previewUri: 'file:///b.jpg', posterMediaId: 'p2' };
const filled = (over: Partial<EditorValues> = {}): EditorValues => ({
  ...emptyValues(), title: ' Cotton kurta ', description: ' Block print ', category: 'Ethnic wear', price: '1500',
  variants: [{ label: 'M', stock: '3' }, { id: 'v2', label: ' L ', stock: '2' }, { label: '', stock: '' }], ...over,
});

describe('toInput', () => {
  it('turns rupees into paise, trims text, and drops the blank size row', () => {
    const i = toInput(filled(), [photo], false);
    expect(i).toMatchObject({ title: 'Cotton kurta', description: 'Block print', price: 150000, publish: false });
    expect(i.variants).toEqual([{ label: 'M', stock: 3 }, { id: 'v2', label: 'L', stock: 2 }]);
    expect(i.checkout).toEqual({ channel: 'DIRECT' });
  });

  it('sends a cover poster only for videos', () => {
    expect(toInput(filled(), [photo, video], true).media).toEqual([{ mediaId: 'm1' }, { mediaId: 'm2', posterMediaId: 'p2' }]);
  });

  it('sends no private rules or deal codes for a fixed price, even if the fields hold values', () => {
    const i = toInput(filled({ autoAcceptAt: '1200', acceptValue: 'X', channel: 'WEBSITE', productUrl: 'https://s.example/p' }), [photo], true);
    expect(i.rules).toBeNull();
    expect(i.dealCodes).toBeNull();
  });

  it('sends rules in paise with blanks as null, and deal codes only for website listings', () => {
    const direct = toInput(filled({ mode: 'BOTH', autoAcceptAt: '1200', autoCounterAt: '', autoDeclineBelow: '800', acceptValue: 'X' }), [photo], true);
    expect(direct.rules).toEqual({ autoAcceptAt: 120000, autoCounterAt: null, autoDeclineBelow: 80000 });
    expect(direct.dealCodes).toBeNull();
    const web = toInput(filled({ mode: 'BOTH', channel: 'WEBSITE', productUrl: ' https://s.example/p ', autoAcceptAt: '1200', acceptType: 'LINK', acceptValue: ' https://s.example/p?c=1 ', counterValue: '' }), [photo], true);
    expect(web.checkout).toEqual({ channel: 'WEBSITE', productUrl: 'https://s.example/p' });
    expect(web.dealCodes).toEqual({ accept: { type: 'LINK', value: 'https://s.example/p?c=1' }, counter: null });
  });

  it('turns an empty price into 0, so the server explains what is wrong', () => {
    expect(toInput(filled({ price: '' }), [photo], false).price).toBe(0);
  });
});

describe('fromListing', () => {
  const saved: SellerListing = {
    id: 'l1', status: 'ACTIVE', title: 'Kurta', description: 'D', category: 'Ethnic wear', tags: ['cotton', 'summer wear'], price: 150000,
    media: [{ mediaId: 'm1', kind: 'image', url: '/v1/media/m1', posterMediaId: null, posterUrl: null }, { mediaId: 'm2', kind: 'video', url: '/v1/media/m2', posterMediaId: 'p2', posterUrl: '/v1/media/p2' }],
    variants: [{ id: 'v1', label: 'M', stock: 3 }], bargaining: { mode: 'BOTH', expiryMinutes: 360 },
    rules: { autoAcceptAt: 110000, autoDeclineBelow: null, autoCounterAt: 130000 }, checkout: { channel: 'WEBSITE', productUrl: 'https://s.example/p' },
    dealCodes: { accept: { type: 'CODE', value: 'A1B' }, counter: null }, publishedAt: 1, updatedAt: 2, stats: { likes: 0, saves: 0, comments: 0 },
  };
  it('round-trips through the form back to the same request', () => {
    const { values, media } = fromListing(saved);
    expect(values).toMatchObject({ price: '1500', autoAcceptAt: '1100', autoCounterAt: '1300', autoDeclineBelow: '', acceptValue: 'A1B', mode: 'BOTH', expiryMinutes: 360 });
    expect(media.map((m) => m.previewUri)).toEqual(['/v1/media/m1', '/v1/media/p2']); // a video previews as its poster
    const back = toInput(values, media, false);
    expect(back).toMatchObject({ price: 150000, rules: { autoAcceptAt: 110000, autoCounterAt: 130000, autoDeclineBelow: null } });
    expect(back.variants).toEqual([{ id: 'v1', label: 'M', stock: 3 }]);
    expect(values.tags).toBe('cotton, summer wear');
    expect(back.tags).toEqual(['cotton', 'summer wear']);
  });
  it('sends cleaned tags, and an empty box sends an empty list so old tags are cleared', () => {
    expect(toInput(filled({ tags: ' Cotton, #Summer wear ,, cotton ' }), [photo], false).tags).toEqual(['cotton', 'summer wear']);
    expect(toInput(filled({ tags: '' }), [photo], false).tags).toEqual([]);
  });
  it('shows one blank size row for a listing with none', () => {
    expect(fromListing({ ...saved, variants: [] }).values.variants).toEqual([{ label: '', stock: '' }]);
  });
});

describe('saveKey', () => {
  it('repeats for the same content and session, and changes with the content or the session', () => {
    const a = toInput(filled(), [photo], false);
    expect(saveKey('s1', a)).toBe(saveKey('s1', toInput(filled(), [photo], false)));
    expect(saveKey('s1', a)).not.toBe(saveKey('s1', toInput(filled({ title: 'Other' }), [photo], false)));
    expect(saveKey('s1', a)).not.toBe(saveKey('s2', a));
    expect(saveKey('s1', a).length).toBeGreaterThanOrEqual(8);
  });
});

describe('EditorSchema', () => {
  it('accepts a normal form and refuses letters in money and stock fields', () => {
    expect(EditorSchema.safeParse(filled()).success).toBe(true);
    expect(EditorSchema.safeParse(filled({ price: '12a' })).success).toBe(false);
    expect(EditorSchema.safeParse(filled({ variants: [{ label: 'M', stock: '-1' }] })).success).toBe(false);
  });
});
