import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import BlockedScreen from '../app/blocked';
import ChatScreen from '../app/chat/[id]';
import NotificationsScreen from '../app/notifications';
import { fakeApi, json, managerWith, renderWith, thread } from './utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-file-system/legacy', () => ({ FileSystemUploadType: { BINARY_CONTENT: 0 }, uploadAsync: jest.fn(), getInfoAsync: jest.fn() }));

let fetchMock: jest.Mock;
const signedIn = () => managerWith('buyer', fetchMock, { missing: [] });
beforeEach(() => {
  fetchMock = jest.fn();
  Object.values(mockRouter).forEach((m) => m.mockClear());
});
const note = (n: number, over: Record<string, unknown> = {}) => ({ id: `n000000${n}`, code: 'SELLER_COUNTERED', title: 'The seller replied', body: 'The seller countered with ₹1,200.', at: Date.now() - n * 60_000, read: false, target: { kind: 'NEGOTIATION', id: 'neg1' }, ...over });

describe('buyer notification centre', () => {
  it('opens the offer a notification is about and marks it read', async () => {
    fakeApi({
      'GET /v1/buyer/notifications': () => json({ items: [note(1), note(2, { code: 'ORDER_SHIPPED', title: 'Order shipped', body: 'FD-100001 is on its way.', target: { kind: 'ORDER', id: 'o9' }, read: true })], nextCursor: null, unread: 1 }),
      'POST /v1/buyer/notifications/n0000001/read': () => json({ unread: 0 }),
    }, fetchMock);
    await renderWith(signedIn(), <NotificationsScreen />);
    expect(await screen.findByText('The seller countered with ₹1,200.')).toBeOnTheScreen();
    expect(screen.getByText('1 unread')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByText('The seller countered with ₹1,200.')));
    expect(mockRouter.push).toHaveBeenCalledWith('/negotiation/neg1');
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/n0000001/read'))).toBe(true));
    await act(async () => void fireEvent.press(screen.getByText('FD-100001 is on its way.')));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/order/o9');
  });
});

describe('buyer chat safety', () => {
  it('reports the seller’s message with a reason; not offered on the system line', async () => {
    mockParams = { id: 'bt-1' };
    const sent: unknown[] = [];
    fakeApi({
      'GET /v1/buyer/threads/bt-1': () => json(thread({ id: 'bt-1', messagingDisabled: false, youBlocked: false })),
      'POST /v1/buyer/threads/bt-1/messages/m2/report': (r) => {
        sent.push((r as never as { body: unknown }).body);
        return json({ received: true }, 201);
      },
    }, fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    await screen.findByText('Hello, thanks for the order');
    expect(screen.getAllByLabelText('Report this message')).toHaveLength(1);
    await act(async () => void fireEvent.press(screen.getByLabelText('Report this message')));
    await act(async () => void fireEvent.press(screen.getByText('Misleading or a scam')));
    await act(async () => void fireEvent.press(screen.getByText('Send report')));
    expect(await screen.findByText('Reported. Thank you.')).toBeOnTheScreen();
    expect(sent).toEqual([{ reason: 'SCAM', note: null }]);
  });

  it('when the seller blocked, the box is gone, the history stays, and nothing says who blocked', async () => {
    mockParams = { id: 'bt-2' };
    fakeApi({ 'GET /v1/buyer/threads/bt-2': () => json(thread({ id: 'bt-2', messagingDisabled: true, youBlocked: false })) }, fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    expect(await screen.findByText('Hello, thanks for the order')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.getByText('You can’t send messages in this chat.')).toBeOnTheScreen();
    expect(screen.queryByText(/blocked/i)).toBeNull();
    expect(screen.queryByText('Blocked people')).toBeNull();
  });
});

describe('buyer blocked people', () => {
  it('shows an empty state', async () => {
    fakeApi({ 'GET /v1/buyer/blocks': () => json({ items: [] }) }, fetchMock);
    await renderWith(signedIn(), <BlockedScreen />);
    expect(await screen.findByText('You haven’t blocked anyone.')).toBeOnTheScreen();
  });
});
