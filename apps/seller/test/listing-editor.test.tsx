import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ListingScreen from '../app/listing/[id]';
import { fakeApi, json, managerWith, problem, renderWith, sellerListing, type Route } from './utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: { id?: string } = { id: 'new' };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
const mockPick = jest.fn();
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...a: unknown[]) => mockPick(...a) }));
const mockThumb = jest.fn();
jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: (...a: unknown[]) => mockThumb(...a) }));
const mockUpload = jest.fn();
const mockInfo = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  uploadAsync: (...a: unknown[]) => mockUpload(...a),
  getInfoAsync: (...a: unknown[]) => mockInfo(...a),
}));

let fetchMock: jest.Mock;
const signedIn = () => managerWith('seller', fetchMock, { missing: [] });
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));
const pressLabel = (label: string) => act(async () => void fireEvent.press(screen.getByLabelText(label)));
const type = (label: string, text: string) => act(async () => void fireEvent.changeText(screen.getByLabelText(label), text));
const posts = () => fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST' || c[1]?.method === 'PUT');

beforeEach(() => {
  fetchMock = jest.fn();
  mockParams = { id: 'new' };
  [mockRouter.push, mockRouter.replace, mockRouter.back, mockPick, mockThumb, mockUpload, mockInfo].forEach((m) => m.mockReset());
  mockUpload.mockResolvedValue({ status: 204 });
  mockInfo.mockResolvedValue({ exists: true, size: 5000 });
});

const photoAsset = (over: Record<string, unknown> = {}) => ({ uri: 'file:///p1.jpg', type: 'image', mimeType: 'image/jpeg', fileSize: 120_000, fileName: 'p1.jpg', ...over });
const intentRoute = (id: string): Route => () => json({ mediaId: id, upload: { method: 'PUT', url: `/v1/media/upload/${id}?token=t`, headers: { 'Content-Type': 'image/jpeg' } }, expiresAt: 1 }, 201);
const completeRoute = (id: string, kind = 'image'): Route => () => json({ id, kind, purpose: 'LISTING', status: 'READY', size: 1, url: `/v1/media/${id}` });

async function fillBasics() {
  await type('Title', 'Cotton kurta');
  await pressLabel('Ethnic wear');
  await type('Price', '1500');
  await type('Size or option', 'M');
  await type('Units in stock', '3');
}
async function addPhoto(id = 'a1a1a1a1-0000-4000-8000-000000000001') {
  mockPick.mockResolvedValueOnce({ canceled: false, assets: [photoAsset()] });
  await press('Add photos or videos');
  await screen.findByLabelText('Remove image 1');
  return id;
}

describe('new listing', () => {
  it('uploads a photo in three steps straight from the file, then attaches it to the listing', async () => {
    const id = 'a1a1a1a1-0000-4000-8000-000000000001';
    let saved: { body: unknown; headers: Record<string, string> } | undefined;
    fakeApi({
      'POST /v1/seller/media/intents': intentRoute(id),
      [`POST /v1/seller/media/${id}/complete`]: completeRoute(id),
      'POST /v1/seller/listings': (r) => { saved = { body: r.body, headers: r.headers }; return json(sellerListing({ status: 'ACTIVE' }), 201); },
    }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    await fillBasics();
    await addPhoto(id);

    expect(mockUpload).toHaveBeenCalledWith('http://api.test/v1/media/upload/' + id + '?token=t', 'file:///p1.jpg', expect.objectContaining({ httpMethod: 'PUT', headers: { 'Content-Type': 'image/jpeg' } }));
    const urls = fetchMock.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(['http://api.test/v1/seller/media/intents', `http://api.test/v1/seller/media/${id}/complete`]);

    await press('Publish');
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved?.body).toMatchObject({ title: 'Cotton kurta', category: 'Ethnic wear', price: 150000, media: [{ mediaId: id }], variants: [{ label: 'M', stock: 3 }], publish: true, checkout: { channel: 'DIRECT' }, rules: null });
    expect(saved?.headers['idempotency-key']).toMatch(/^save-/);
    expect(mockRouter.replace).toHaveBeenCalledWith('/listings');
  });

  it('refuses a too-big photo on the phone, before any network call', async () => {
    fakeApi({}, fetchMock);
    mockPick.mockResolvedValueOnce({ canceled: false, assets: [photoAsset({ fileSize: 16_000_000, fileName: 'huge.jpg' })] });
    await renderWith(signedIn(), <ListingScreen />);
    await press('Add photos or videos');
    expect(await screen.findByText('huge.jpg: Photos can be up to 15 MB.')).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Remove image 1')).not.toBeOnTheScreen();
  });

  it('makes a cover photo for a video on the phone and uploads both, keeping the poster id for the listing', async () => {
    const vid = 'b2b2b2b2-0000-4000-8000-000000000001';
    const pos = 'b2b2b2b2-0000-4000-8000-000000000002';
    const intents = [intentRoute(vid), intentRoute(pos)];
    let saved: unknown;
    fakeApi({
      'POST /v1/seller/media/intents': (r) => (intents.shift() as Route)(r),
      [`POST /v1/seller/media/${vid}/complete`]: completeRoute(vid, 'video'),
      [`POST /v1/seller/media/${pos}/complete`]: completeRoute(pos),
      'POST /v1/seller/listings': (r) => { saved = r.body; return json(sellerListing(), 201); },
    }, fetchMock);
    mockThumb.mockResolvedValue({ uri: 'file:///thumb.jpg', width: 10, height: 10 });
    mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///v.mp4', type: 'video', mimeType: 'video/mp4', fileSize: 20_000_000, duration: 30_000, fileName: 'v.mp4' }] });
    await renderWith(signedIn(), <ListingScreen />);
    await fillBasics();
    await press('Add photos or videos');
    await screen.findByLabelText('Remove video 1');
    expect(mockThumb).toHaveBeenCalledWith('file:///v.mp4', { time: 0 });
    expect(fetchMock.mock.calls[0][1].body).toContain('"durationSec":30');
    await press('Save draft');
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toMatchObject({ media: [{ mediaId: vid, posterMediaId: pos }], publish: false });
  });

  it('rejects a reel longer than a minute on the phone', async () => {
    fakeApi({}, fetchMock);
    mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///v.mp4', type: 'video', mimeType: 'video/mp4', fileSize: 1000, duration: 75_000, fileName: 'long.mp4' }] });
    await renderWith(signedIn(), <ListingScreen />);
    await press('Add photos or videos');
    expect(await screen.findByText('long.mp4: Reels can be up to 60 seconds.')).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('says what went wrong when an upload fails, and keeps nothing', async () => {
    fakeApi({ 'POST /v1/seller/media/intents': intentRoute('c3c3c3c3-0000-4000-8000-000000000001') }, fetchMock);
    mockUpload.mockResolvedValue({ status: 500 });
    mockPick.mockResolvedValueOnce({ canceled: false, assets: [photoAsset()] });
    await renderWith(signedIn(), <ListingScreen />);
    await press('Add photos or videos');
    expect(await screen.findByText(/p1.jpg: The upload did not go through/)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Remove image 1')).not.toBeOnTheScreen();
  });

  it('shows the server’s messages next to the right fields, and by section for sizes and photos', async () => {
    fakeApi({
      'POST /v1/seller/listings': () => problem(400, 'VALIDATION', { title: 'Use 3–80 characters.', price: 'Enter a whole-rupee price between ₹50 and ₹10,00,000.', media: 'Add at least one video or photo.', variants: 'Add at least one size or option.', channel: 'Add a UPI ID first.' }),
    }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    await press('Save draft');
    expect(await screen.findByText('Use 3–80 characters.')).toBeOnTheScreen();
    expect(screen.getByText('Enter a whole-rupee price between ₹50 and ₹10,00,000.')).toBeOnTheScreen();
    expect(screen.getByText('Add at least one video or photo.')).toBeOnTheScreen();
    expect(screen.getByText('Add at least one size or option.')).toBeOnTheScreen();
    expect(screen.getByText('Add a UPI ID first.')).toBeOnTheScreen();
    expect(screen.getByText('Check the highlighted fields.')).toBeOnTheScreen();
    expect(mockRouter.replace).not.toHaveBeenCalled();
  });

  it('will not send letters in the price or stock fields', async () => {
    fakeApi({}, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    await type('Price', '12x');
    await press('Save draft');
    expect(await screen.findAllByText('Use numbers only.')).not.toHaveLength(0);
    expect(posts()).toHaveLength(0);
  });

  it('reuses the same Idempotency-Key when the same save is retried, and a new one when the content changes', async () => {
    const keys: string[] = [];
    let fail = true;
    fakeApi({ 'POST /v1/seller/listings': (r) => { keys.push(r.headers['idempotency-key'] as string); return fail ? problem(503, 'SERVICE_UNAVAILABLE', undefined, 'Try again') : json(sellerListing(), 201); } }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    await fillBasics();
    await press('Save draft');
    await waitFor(() => expect(keys).toHaveLength(1));
    await screen.findByText('Try again');
    await press('Save draft');
    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys[1]).toBe(keys[0]);
    await type('Title', 'Cotton kurta v2');
    fail = false;
    await press('Save draft');
    await waitFor(() => expect(keys).toHaveLength(3));
    expect(keys[2]).not.toBe(keys[0]);
  });
});

describe('bargaining and checkout fields', () => {
  it('hides private rules for a fixed price, and sends rules in paise once offers are on', async () => {
    let saved: unknown;
    fakeApi({ 'POST /v1/seller/listings': (r) => { saved = r.body; return json(sellerListing(), 201); } }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    expect(screen.queryByText('Your private rules')).not.toBeOnTheScreen();
    await fillBasics();
    await pressLabel('Private offers');
    expect(screen.getByText('Your private rules')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Counter automatically with')).not.toBeOnTheScreen();
    await type('Accept automatically at or above', '1200');
    await press('More rules');
    await type('Counter automatically with', '1300');
    await type('Decline automatically below', '900');
    await press('Save draft');
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toMatchObject({ bargaining: { mode: 'PRIVATE', expiryHours: 24 }, rules: { autoAcceptAt: 120000, autoCounterAt: 130000, autoDeclineBelow: 90000 } });
  });

  it('asks for the product link and a code for each automatic price on a website listing', async () => {
    let saved: unknown;
    fakeApi({ 'POST /v1/seller/listings': (r) => { saved = r.body; return json(sellerListing(), 201); } }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    await fillBasics();
    await pressLabel('Private offers');
    await type('Accept automatically at or above', '1200');
    await pressLabel('My website');
    await type('Link to this product on your website', 'https://shop.example/p');
    await type('Code or link buyers use', 'FAYDA12');
    await press('Save draft');
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toMatchObject({ checkout: { channel: 'WEBSITE', productUrl: 'https://shop.example/p' }, dealCodes: { accept: { type: 'CODE', value: 'FAYDA12' }, counter: null } });
  });

  it('shows deal-code errors on the code field', async () => {
    fakeApi({ 'POST /v1/seller/listings': () => problem(400, 'VALIDATION', { acceptCode: 'Code for your automatic price: enter a coupon code or a discount link.' }) }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    await fillBasics();
    await pressLabel('Private offers');
    await type('Accept automatically at or above', '1200');
    await pressLabel('My website');
    await press('Save draft');
    expect(await screen.findByText('Code for your automatic price: enter a coupon code or a discount link.')).toBeOnTheScreen();
  });
});

describe('existing listings', () => {
  const id = '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70';
  beforeEach(() => { mockParams = { id }; });

  it('loads a draft with its sizes, keeps their ids when saving, and offers Publish and Delete', async () => {
    let saved: unknown;
    fakeApi({ [`GET /v1/seller/listings/${id}`]: () => json(sellerListing()), [`PUT /v1/seller/listings/${id}`]: (r) => { saved = r.body; return json(sellerListing(), 200); } }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByDisplayValue('Cotton kurta')).toBeOnTheScreen();
    expect(screen.getByLabelText('Price')).toHaveDisplayValue('1500');
    expect(screen.getByText('Delete draft')).toBeOnTheScreen();
    await type('Units in stock', '9');
    await press('Publish');
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved).toMatchObject({ variants: [{ id: 'v1', label: 'M', stock: 9 }], media: [{ mediaId: 'm1' }], publish: true });
  });

  it('deletes a draft only after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => buttons?.find((b) => b.text === 'Delete')?.onPress?.());
    const calls: string[] = [];
    fakeApi({ [`GET /v1/seller/listings/${id}`]: () => json(sellerListing()), [`DELETE /v1/seller/listings/${id}`]: () => { calls.push('delete'); return new Response(null, { status: 204 }); } }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByDisplayValue('Cotton kurta');
    await press('Delete draft');
    await waitFor(() => expect(calls).toEqual(['delete']));
    expect(alert).toHaveBeenCalledWith('Delete this draft?', expect.any(String), expect.any(Array));
    expect(mockRouter.replace).toHaveBeenCalledWith('/listings');
    alert.mockRestore();
  });

  it('keeps a live listing live on save, and can pause it', async () => {
    const live = sellerListing({ status: 'ACTIVE', publishedAt: 5 });
    let saved: unknown;
    let paused = false;
    fakeApi({
      [`GET /v1/seller/listings/${id}`]: () => json(live),
      [`PUT /v1/seller/listings/${id}`]: (r) => { saved = r.body; return json(live); },
      [`POST /v1/seller/listings/${id}/status`]: () => { paused = true; return json({ ...live, status: 'PAUSED' }); },
    }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByDisplayValue('Cotton kurta');
    expect(screen.queryByText('Publish')).not.toBeOnTheScreen();
    await press('Save changes');
    await waitFor(() => expect(saved).toMatchObject({ publish: true }));
    await press('Pause listing');
    await waitFor(() => expect(paused).toBe(true));
  });

  it('keeps a paused listing paused on save', async () => {
    let saved: unknown;
    fakeApi({ [`GET /v1/seller/listings/${id}`]: () => json(sellerListing({ status: 'PAUSED' })), [`PUT /v1/seller/listings/${id}`]: (r) => { saved = r.body; return json(sellerListing({ status: 'PAUSED' })); } }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByDisplayValue('Cotton kurta');
    expect(screen.getByText('Resume listing')).toBeOnTheScreen();
    await press('Save changes');
    await waitFor(() => expect(saved).toMatchObject({ publish: false }));
  });

  it('shows an error with a retry when the listing cannot be loaded', async () => {
    let fail = true;
    fakeApi({ [`GET /v1/seller/listings/${id}`]: () => (fail ? problem(404, 'NOT_FOUND', undefined, 'Listing not found.') : json(sellerListing())) }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByText('Can’t load this listing')).toBeOnTheScreen();
    fail = false;
    await press('Try again');
    expect(await screen.findByDisplayValue('Cotton kurta')).toBeOnTheScreen();
  });
});
