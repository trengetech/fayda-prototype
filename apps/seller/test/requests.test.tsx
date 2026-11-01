import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import ListingScreen from '../app/listing/[id]';
import RequestsScreen from '../app/(tabs)/requests';
import { fakeApi, json, managerWith, renderWith, sellerListing, sellerRequest } from './utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
const mockPick = jest.fn();
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...a: unknown[]) => mockPick(...a) }));
jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));
const mockUpload = jest.fn();
const mockDownload = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  cacheDirectory: 'file:///cache/',
  uploadAsync: (...a: unknown[]) => mockUpload(...a),
  downloadAsync: (...a: unknown[]) => mockDownload(...a),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 5000 }),
}));

let fetchMock: jest.Mock;
const signedIn = () => managerWith('seller', fetchMock, { missing: [] });
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));
const type = (label: string, text: string) => act(async () => void fireEvent.changeText(screen.getAllByLabelText(label).at(-1) as never, text));
const posts = (path: RegExp) => fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST' && path.test(String(c[0])));
beforeEach(() => {
  fetchMock = jest.fn();
  mockPick.mockReset();
  mockUpload.mockReset();
  mockUpload.mockResolvedValue({ status: 204 });
  mockDownload.mockReset();
  Object.values(mockRouter).forEach((m) => m.mockClear());
  mockParams = {};
});

const RESP = 'c0c0c0c0-0000-4000-8000-000000000001';
const wanted = { id: RESP, status: 'WANTED', text: null, price: 450000, media: [{ id: 'rm9', kind: 'image', url: '/v1/media/rm9' }], threadId: 'thread-9', listingId: null };
const fresh = sellerRequest({ id: 'new-1', title: 'Red silk saree' });
const sent = sellerRequest({ id: 'sent-1', title: 'Blue kurta', response: { id: 'x1', status: 'SENT', text: null, price: null, media: [], threadId: null, listingId: null } });
const want = sellerRequest({ id: 'want-1', title: 'Green dupatta', response: { ...wanted, id: 'x2' } });

describe('requests', () => {
  it('splits new requests from the ones already answered', async () => {
    fakeApi({ 'GET /v1/seller/requests': () => json({ items: [fresh, sent, want], newCount: 1 }) }, fetchMock);
    await renderWith(signedIn(), <RequestsScreen />);
    expect(await screen.findByText('Red silk saree')).toBeOnTheScreen();
    expect(screen.getByLabelText('New (1)')).toBeOnTheScreen();
    expect(screen.getByText('Ethnic wear · Size Free · Budget ₹5,000 · Asha')).toBeOnTheScreen();
    expect(screen.queryByText('Blue kurta')).not.toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Responded')));
    expect(screen.getByText('Blue kurta')).toBeOnTheScreen();
    expect(screen.getByText('Sent, waiting for the buyer')).toBeOnTheScreen();
    expect(screen.getByText('The buyer wants this')).toBeOnTheScreen();
    await press('Open chat');
    expect(mockRouter.push).toHaveBeenCalledWith('/chat/thread-9');
    await press('Create listing');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/listing/[id]', params: { id: 'new', fromResponseId: 'x2' } });
  });

  it('will not send a response without a photo', async () => {
    fakeApi({ 'GET /v1/seller/requests': () => json({ items: [fresh], newCount: 1 }) }, fetchMock);
    await renderWith(signedIn(), <RequestsScreen />);
    await press((await screen.findByText('I have this — send a photo')).props.children);
    await press('Send to the buyer');
    expect(screen.getByText('Add a photo of the item you have.')).toBeOnTheScreen();
    expect(posts(/responses/)).toHaveLength(0);
  });

  it('uploads the photo as a request photo, then sends it with the price and message', async () => {
    const mediaId = 'd1d1d1d1-0000-4000-8000-000000000001';
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///s.jpg', type: 'image', mimeType: 'image/jpeg', fileSize: 1000 }] });
    let intent: unknown;
    let body: unknown;
    fakeApi({
      'GET /v1/seller/requests': () => json({ items: [fresh], newCount: 1 }),
      'POST /v1/seller/media/intents': (r) => { intent = r.body; return json({ mediaId, upload: { method: 'PUT', url: `/v1/media/upload/${mediaId}?token=t`, headers: { 'Content-Type': 'image/jpeg' } }, expiresAt: 1 }, 201); },
      [`POST /v1/seller/media/${mediaId}/complete`]: () => json({ id: mediaId, kind: 'image', purpose: 'REQUEST', status: 'READY', size: 1, url: `/v1/media/${mediaId}` }),
      'POST /v1/seller/requests/new-1/responses': (r) => { body = r.body; return json({ ...fresh, response: { id: 'x9', status: 'SENT', text: 'In stock', price: 450000, media: [], threadId: null, listingId: null } }, 201); },
    }, fetchMock);
    await renderWith(signedIn(), <RequestsScreen />);
    await press((await screen.findByText('I have this — send a photo')).props.children);
    await press('Add a photo');
    await screen.findByText('Photos of the item you have (1/4)');
    await type('Your price', '4500');
    await type('Message', 'In stock');
    await press('Send to the buyer');
    await waitFor(() => expect(body).toBeDefined());
    expect(intent).toMatchObject({ purpose: 'REQUEST', kind: 'image' });
    expect(body).toEqual({ text: 'In stock', price: 450000, mediaIds: [mediaId] });
  });

  it('rejects a price that is not a whole rupee amount', async () => {
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///s.jpg', type: 'image', mimeType: 'image/jpeg', fileSize: 1000 }] });
    const mediaId = 'd1d1d1d1-0000-4000-8000-000000000002';
    fakeApi({
      'GET /v1/seller/requests': () => json({ items: [sellerRequest({ id: 'price-1' })], newCount: 1 }),
      'POST /v1/seller/media/intents': () => json({ mediaId, upload: { method: 'PUT', url: `/v1/media/upload/${mediaId}?token=t`, headers: {} }, expiresAt: 1 }, 201),
      [`POST /v1/seller/media/${mediaId}/complete`]: () => json({ id: mediaId, kind: 'image', purpose: 'REQUEST', status: 'READY', size: 1, url: '/v1/media/x' }),
    }, fetchMock);
    await renderWith(signedIn(), <RequestsScreen />);
    await press((await screen.findByText('I have this — send a photo')).props.children);
    await press('Add a photo');
    await screen.findByText('Photos of the item you have (1/4)');
    await type('Your price', '12.5');
    await press('Send to the buyer');
    expect(screen.getByText('Enter a whole-rupee price, or leave it blank.')).toBeOnTheScreen();
    expect(posts(/responses/)).toHaveLength(0);
  });
});

describe('create a listing from a request', () => {
  it('starts filled in from the request and response, copies the photo, and publishes with fromResponseId', async () => {
    mockParams = { id: 'new', fromResponseId: RESP };
    const copied = 'e1e1e1e1-0000-4000-8000-000000000001';
    mockDownload.mockResolvedValue({ status: 200, uri: 'file:///cache/copy.jpg', mimeType: 'image/jpeg', headers: {} });
    let saved: { body: Record<string, unknown>; headers: Record<string, string> } | undefined;
    let intent: unknown;
    const request = sellerRequest({ id: 'prefill-1', title: 'Green dupatta', description: 'Plain silk', size: 'Free', response: wanted });
    fakeApi({
      'GET /v1/seller/requests': () => json({ items: [request], newCount: 0 }),
      'POST /v1/seller/media/intents': (r) => { intent = r.body; return json({ mediaId: copied, upload: { method: 'PUT', url: `/v1/media/upload/${copied}?token=t`, headers: { 'Content-Type': 'image/jpeg' } }, expiresAt: 1 }, 201); },
      [`POST /v1/seller/media/${copied}/complete`]: () => json({ id: copied, kind: 'image', purpose: 'LISTING', status: 'READY', size: 1, url: `/v1/media/${copied}` }),
      'POST /v1/seller/listings': (r) => { saved = { body: r.body as Record<string, unknown>, headers: r.headers }; return json(sellerListing({ status: 'ACTIVE' }), 201); },
    }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByText('Listing for a request')).toBeOnTheScreen();
    expect(screen.getByLabelText('Title').props.value).toBe('Green dupatta');
    expect(screen.getByLabelText('Price').props.value).toBe('4500');
    expect(screen.getByLabelText('Size or option').props.value).toBe('Free');
    // the buyer's photo was uploaded for the request, so it is downloaded and uploaded again as a listing photo
    await screen.findByLabelText('Remove image 1');
    expect(mockDownload).toHaveBeenCalledWith('http://api.test/v1/media/rm9', expect.stringContaining('file:///cache/'));
    expect(intent).toMatchObject({ purpose: 'LISTING', kind: 'image' });

    await type('Units in stock', '1');
    await press('Publish');
    await waitFor(() => expect(saved).toBeDefined());
    expect(saved?.body).toMatchObject({ title: 'Green dupatta', category: 'Ethnic wear', price: 450000, publish: true, fromResponseId: RESP, bargaining: { mode: 'BUY_NOW' }, media: [{ mediaId: copied }] });
    expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/chat/[id]', params: { id: 'thread-9', published: '1' } });
  });

  it('refuses to start from a response the buyer has not said they want', async () => {
    mockParams = { id: 'new', fromResponseId: 'x7' };
    const request = sellerRequest({ id: 'prefill-2', response: { id: 'x7', status: 'SENT', text: null, price: null, media: [], threadId: null, listingId: null } });
    fakeApi({ 'GET /v1/seller/requests': () => json({ items: [request], newCount: 0 }) }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByText('This request isn’t ready for a listing')).toBeOnTheScreen();
  });
});
