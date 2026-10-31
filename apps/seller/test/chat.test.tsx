import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import ChatScreen from '../app/chat/[id]';
import MessagesScreen from '../app/messages';
import { chatThread, fakeApi, json, managerWith, problem, renderWith, sellerListing, sellerRequest } from './utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
const mockPick = jest.fn();
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...a: unknown[]) => mockPick(...a) }));
const mockUpload = jest.fn();
jest.mock('expo-file-system/legacy', () => ({ FileSystemUploadType: { BINARY_CONTENT: 0 }, uploadAsync: (...a: unknown[]) => mockUpload(...a), getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 5000 }) }));

let seq = 0;
let fetchMock: jest.Mock;
const signedIn = () => managerWith('seller', fetchMock, { missing: [] });
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));
const type = (label: string, text: string) => act(async () => void fireEvent.changeText(screen.getAllByLabelText(label).at(-1) as never, text));
const sends = () => fetchMock.mock.calls.filter((c) => /\/messages$/.test(String(c[0])) && c[1]?.method === 'POST');
beforeEach(() => {
  fetchMock = jest.fn();
  mockPick.mockReset();
  mockUpload.mockReset();
  mockUpload.mockResolvedValue({ status: 204 });
  Object.values(mockRouter).forEach((m) => m.mockClear());
  // The query cache outlives a test, so every test uses its own thread id.
  mockParams = { id: `thread-${++seq}` };
});
const T = () => mockParams.id as string;
const threadRoutes = (thread: unknown, extra: Record<string, () => Response> = {}) => ({
  [`GET /v1/seller/threads/${T()}`]: () => json(thread),
  'GET /v1/seller/requests': () => json({ items: [], newCount: 0 }),
  'GET /v1/seller/listings': () => json({ items: [] }),
  ...extra,
});

describe('messages list', () => {
  it('lists chats with their unread counts and opens one', async () => {
    fakeApi({ 'GET /v1/seller/threads': () => json({ items: [{ ...chatThread({ id: 'tt1', unread: 2, lastMessage: 'Is it in cotton?' }), messages: undefined }], unread: 2 }) }, fetchMock);
    await renderWith(signedIn(), <MessagesScreen />);
    expect(await screen.findByText('2 new')).toBeOnTheScreen();
    expect(screen.getByText('Is it in cotton?')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Open chat FD-100001 · Cotton kurta')));
    expect(mockRouter.push).toHaveBeenCalledWith('/chat/tt1');
  });
});

describe('chat screen', () => {
  it('shows the timeline including the system message, and marks the chat read when it has unread messages', async () => {
    let read = 0;
    fakeApi(threadRoutes(chatThread({ id: T(), unread: 1 }), { [`POST /v1/seller/threads/${T()}/read`]: () => { read++; return json(chatThread({ id: T(), unread: 0 })); } }), fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    expect(await screen.findByText('Order FD-100001 placed.')).toBeOnTheScreen();
    expect(screen.getByText('Is it in cotton?')).toBeOnTheScreen();
    await waitFor(() => expect(read).toBe(1));
  });

  it('keeps the same clientKey when a send is retried, and uses a new one for the next message', async () => {
    let attempt = 0;
    fakeApi(threadRoutes(chatThread({ id: T() }), { [`POST /v1/seller/threads/${T()}/messages`]: () => (++attempt === 1 ? problem(500, 'INTERNAL', undefined, 'Server fell over') : json(chatThread({ id: T() }))) }), fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    await screen.findByText('Is it in cotton?');
    await type('Message', 'Yes, pure cotton');
    await press('Send');
    expect(await screen.findByText('Server fell over')).toBeOnTheScreen();
    await press('Send');
    await waitFor(() => expect(sends()).toHaveLength(2));
    const [a, b] = sends().map((c) => JSON.parse(c[1].body));
    expect(a.clientKey).toBeTruthy();
    expect(b.clientKey).toBe(a.clientKey);
    expect(a.text).toBe('Yes, pure cotton');
    // the box is cleared once the message went through; a different message gets its own key
    await type('Message', 'Anything else?');
    await press('Send');
    await waitFor(() => expect(sends()).toHaveLength(3));
    expect(JSON.parse(sends()[2]![1].body).clientKey).not.toBe(a.clientKey);
  });

  it('will not send an empty message', async () => {
    fakeApi(threadRoutes(chatThread({ id: T() })), fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    await screen.findByText('Is it in cotton?');
    await press('Send');
    expect(screen.getByText('Write a message first.')).toBeOnTheScreen();
    expect(sends()).toHaveLength(0);
  });

  it('shares only live listings', async () => {
    const live = sellerListing({ id: 'a0a0a0a0-0000-4000-8000-000000000001', status: 'ACTIVE', title: 'Live kurta' });
    const draft = sellerListing({ id: 'a0a0a0a0-0000-4000-8000-000000000002', status: 'DRAFT', title: 'Draft kurta' });
    const paused = sellerListing({ id: 'a0a0a0a0-0000-4000-8000-000000000003', status: 'PAUSED', title: 'Paused kurta' });
    fakeApi(threadRoutes(chatThread({ id: T() }), { 'GET /v1/seller/listings': () => json({ items: [live, draft, paused] }), [`POST /v1/seller/threads/${T()}/messages`]: () => json(chatThread({ id: T() })) }), fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    await screen.findByText('Is it in cotton?');
    await press('Share a listing');
    expect(await screen.findByText(/Live kurta/)).toBeOnTheScreen();
    expect(screen.queryByText(/Draft kurta/)).not.toBeOnTheScreen();
    expect(screen.queryByText(/Paused kurta/)).not.toBeOnTheScreen();
    await press('Live kurta · ₹1,500');
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(JSON.parse(sends()[0]![1].body)).toMatchObject({ listingId: live.id });
  });

  it('sends a photo through a CHAT upload', async () => {
    const mediaId = 'b1b1b1b1-0000-4000-8000-000000000001';
    mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///c.jpg', type: 'image', mimeType: 'image/jpeg', fileSize: 1000 }] });
    let intent: unknown;
    fakeApi(threadRoutes(chatThread({ id: T() }), {
      'POST /v1/seller/media/intents': (r: never) => { intent = (r as { body: unknown }).body; return json({ mediaId, upload: { method: 'PUT', url: `/v1/media/upload/${mediaId}?token=t`, headers: { 'Content-Type': 'image/jpeg' } }, expiresAt: 1 }, 201); },
      [`POST /v1/seller/media/${mediaId}/complete`]: () => json({ id: mediaId, kind: 'image', purpose: 'CHAT', status: 'READY', size: 1, url: `/v1/media/${mediaId}` }),
      [`POST /v1/seller/threads/${T()}/messages`]: () => json(chatThread({ id: T() })),
    } as never), fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    await screen.findByText('Is it in cotton?');
    await press('Add a photo');
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(intent).toMatchObject({ purpose: 'CHAT', kind: 'image' });
    expect(JSON.parse(sends()[0]![1].body)).toMatchObject({ mediaId });
  });

  it('in a request chat shows the request, and Create listing opens the editor for that response', async () => {
    const response = { id: 'c0c0c0c0-0000-4000-8000-000000000001', status: 'WANTED', text: null, price: 450000, media: [], threadId: T(), listingId: null };
    const request = sellerRequest({ id: 'req-1', response });
    fakeApi(threadRoutes(chatThread({ id: T(), kind: 'REQUEST', orderId: null, requestId: 'req-1', title: 'Red silk saree' }), { 'GET /v1/seller/requests': () => json({ items: [request], newCount: 0 }) }), fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    expect(await screen.findByText('Request: Red silk saree')).toBeOnTheScreen();
    await press('Create listing');
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/listing/[id]', params: { id: 'new', fromResponseId: response.id } });
    expect(screen.queryByText('View order')).not.toBeOnTheScreen();
  });

  it('shows the published toast after a listing made for the request', async () => {
    mockParams = { id: `thread-${++seq}`, published: '1' };
    fakeApi(threadRoutes(chatThread({ id: T() })), fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    expect(await screen.findByText('Published and shared in the chat')).toBeOnTheScreen();
  });
});
