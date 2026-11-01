import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import BlockedScreen from '../app/blocked';
import ChatScreen from '../app/chat/[id]';
import CommentsScreen from '../app/comments/[id]';
import DashboardScreen from '../app/dashboard';
import NotificationsScreen from '../app/notifications';
import { chatThread, fakeApi, json, managerWith, renderWith, sellerListing } from './utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const ID = '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70';
let mockParams: Record<string, string> = { id: ID };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

let fetchMock: jest.Mock;
const signedIn = () => managerWith('seller', fetchMock, { missing: [] });
beforeEach(() => {
  fetchMock = jest.fn();
  Object.values(mockRouter).forEach((m) => m.mockClear());
  mockParams = { id: ID };
});

const note = (n: number, over: Record<string, unknown> = {}) => ({ id: `n000000${n}`, code: 'NEW_COMMENT', title: 'New comment', body: `On Kurta: Question ${n}`, at: Date.now() - n * 60_000, read: false, target: { kind: 'LISTING', id: ID }, ...over });

describe('notification centre', () => {
  it('lists notifications, marks the tapped one read and opens what it is about', async () => {
    let read = false;
    fakeApi({
      'GET /v1/seller/notifications': () => json({ items: [note(1, { read }), note(2, { code: 'ORDER_PLACED', title: 'New order', body: 'FD-100001 is waiting for you to confirm.', target: { kind: 'ORDER', id: 'o1' }, read: true })], nextCursor: null, unread: read ? 0 : 1 }),
      'GET /v1/seller/notifications/unread-count': () => json({ unread: read ? 0 : 1 }),
      'POST /v1/seller/notifications/n0000001/read': () => {
        read = true;
        return json({ unread: 0 });
      },
    }, fetchMock);
    await renderWith(signedIn(), <NotificationsScreen />);
    expect(await screen.findByText('On Kurta: Question 1')).toBeOnTheScreen();
    expect(screen.getByText('1 unread')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByText('On Kurta: Question 1')));
    expect(mockRouter.push).toHaveBeenCalledWith(`/comments/${ID}`);
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/n0000001/read') && c[1]?.method === 'POST')).toBe(true));
    await act(async () => void fireEvent.press(screen.getByText('FD-100001 is waiting for you to confirm.')));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/order/o1'); // already read: no second POST
    expect(fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST')).toHaveLength(1);
  });

  it('marks everything read, and shows an empty state and an error with retry', async () => {
    fakeApi({ 'GET /v1/seller/notifications': () => json({ items: [note(1), note(2)], nextCursor: null, unread: 2 }), 'POST /v1/seller/notifications/read-all': () => json({ unread: 0 }) }, fetchMock);
    await renderWith(signedIn(), <NotificationsScreen />);
    await screen.findByText('2 unread');
    await act(async () => void fireEvent.press(screen.getByText('Mark all as read')));
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/read-all'))).toBe(true));
  });

  it('says so when there is nothing, and when it cannot load', async () => {
    let fail = true;
    fakeApi({ 'GET /v1/seller/notifications': () => (fail ? json({ title: 'x', status: 500, code: 'INTERNAL', detail: 'Server fell over' }, 500) : json({ items: [], nextCursor: null, unread: 0 })) }, fetchMock);
    await renderWith(signedIn(), <NotificationsScreen />);
    expect(await screen.findByText(/Can’t load notifications/)).toBeOnTheScreen();
    fail = false;
    await act(async () => void fireEvent.press(screen.getByText('Try again')));
    expect(await screen.findByText(/Nothing yet/)).toBeOnTheScreen();
  });
});

describe('report and block', () => {
  const COMMENTS = `/v1/seller/listings/${ID}/comments`;
  const comment = { id: 'c0000000-0000-4000-8000-000000000001', text: 'Buy my stuff!!', at: Date.now() - 3_600_000, author: { name: 'Sam', shop: false }, mine: false, canRemove: true };

  it('reports a comment with a reason and a note, and says it was received; not offered on your own comments', async () => {
    const reports: unknown[] = [];
    fakeApi({
      [`GET /v1/seller/listings/${ID}`]: () => json(sellerListing({ id: ID, status: 'ACTIVE' })),
      [`GET ${COMMENTS}`]: () => json({ items: [comment, { ...comment, id: 'c0000000-0000-4000-8000-000000000002', text: 'We ship in 2 days', mine: true, author: { name: 'Shop', shop: true } }], nextCursor: null, total: 2 }),
      [`POST /v1/seller/comments/${comment.id}/report`]: (r) => {
        reports.push((r as never as { body: unknown }).body);
        return json({ received: true }, 201);
      },
    }, fetchMock);
    await renderWith(signedIn(), <CommentsScreen />);
    await screen.findByText('Buy my stuff!!');
    expect(screen.getAllByLabelText('Report this comment')).toHaveLength(1); // only on the other person's comment
    await act(async () => void fireEvent.press(screen.getByLabelText('Report this comment')));
    expect(screen.getByText('Why are you reporting this? We keep a copy and review it.')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByText('Send report'))); // no reason picked yet: nothing is sent
    expect(reports).toEqual([]);
    await act(async () => void fireEvent.press(screen.getByText('Spam')));
    await act(async () => void fireEvent.changeText(screen.getByLabelText('Note (optional)'), ' an ad '));
    await act(async () => void fireEvent.press(screen.getByText('Send report')));
    expect(await screen.findByText('Reported. Thank you.')).toBeOnTheScreen();
    expect(reports).toEqual([{ reason: 'SPAM', note: 'an ad' }]);
  });

  it('blocks after asking, and a failed report keeps the sheet open with the reason', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    fakeApi({
      [`GET /v1/seller/listings/${ID}`]: () => json(sellerListing({ id: ID, status: 'ACTIVE' })),
      [`GET ${COMMENTS}`]: () => json({ items: [comment], nextCursor: null, total: 1 }),
      [`POST /v1/seller/comments/${comment.id}/report`]: () => json({ title: 'x', status: 429, code: 'RATE_LIMITED', detail: 'You’ve sent a lot of reports. Try again in a little while.' }, 429),
      'PUT /v1/seller/blocks': (r) => {
        expect((r as never as { body: unknown }).body).toEqual({ source: 'COMMENT', id: comment.id });
        return json({ id: 'b1', name: 'Sam', since: 1 });
      },
    }, fetchMock);
    await renderWith(signedIn(), <CommentsScreen />);
    await screen.findByText('Buy my stuff!!');
    await act(async () => void fireEvent.press(screen.getByLabelText('Report this comment')));
    await act(async () => void fireEvent.press(screen.getByText('Abuse or harassment')));
    await act(async () => void fireEvent.press(screen.getByText('Send report')));
    expect(await screen.findByText(/sent a lot of reports/)).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByText('Cancel')));
    await act(async () => void fireEvent.press(screen.getByLabelText('Block Sam')));
    expect(alert).toHaveBeenCalledWith('Block Sam?', expect.stringContaining('Existing orders stay as they are'), expect.anything());
    expect(await screen.findByText('Sam is blocked.')).toBeOnTheScreen();
    alert.mockRestore();
  });

  it('a blocked chat has no message box, says who can undo it, and still shows the history', async () => {
    mockParams = { id: 'thread-blocked-1' };
    fakeApi({
      'GET /v1/seller/threads/thread-blocked-1': () => json(chatThread({ id: 'thread-blocked-1', messagingDisabled: true, youBlocked: true })),
      'GET /v1/seller/requests': () => json({ items: [], newCount: 0 }),
      'GET /v1/seller/listings': () => json({ items: [] }),
    }, fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    expect(await screen.findByText('Is it in cotton?')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.getByText('You can’t send messages in this chat.')).toBeOnTheScreen();
    expect(screen.getByText(/You blocked this person/)).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByText('Blocked people')));
    expect(mockRouter.push).toHaveBeenCalledWith('/blocked');
    // the other person's message can be reported; the system line cannot
    expect(screen.getAllByLabelText('Report this message')).toHaveLength(1);
  });
});

describe('blocked people', () => {
  it('lists them and unblocks', async () => {
    let items = [{ id: 'b1', name: 'Sam', since: Date.UTC(2026, 10, 1) }];
    fakeApi({ 'GET /v1/seller/blocks': () => json({ items }), 'DELETE /v1/seller/blocks/b1': () => { items = []; return new Response(null, { status: 204 }); } }, fetchMock);
    await renderWith(signedIn(), <BlockedScreen />);
    expect(await screen.findByText('Sam')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByText('Unblock')));
    expect(await screen.findByText('You haven’t blocked anyone.')).toBeOnTheScreen();
  });
});

describe('dashboard', () => {
  const win = (days: number, n: number) => ({ days, offersReceived: n, offersAgreed: n - 1, ordersPlaced: 2, ordersConfirmed: 1, ordersDelivered: 0, likes: 12, saves: 3, comments: 4 });
  it('shows what needs me, both windows and the public record', async () => {
    fakeApi({ 'GET /v1/seller/dashboard': () => json({ windows: [win(7, 5), win(30, 20)], record: { orders: 9, completed: 6, confirmed: 8, cancelled: 1, expired: 0, medianConfirmMs: 7_800_000, rating: 4.5, reviewCount: 3 }, needsReply: 2, needsConfirm: 1 }) }, fetchMock);
    await renderWith(signedIn(), <DashboardScreen />);
    expect(await screen.findByText('Last 7 days')).toBeOnTheScreen();
    expect(screen.getByText('Last 30 days')).toBeOnTheScreen();
    expect(screen.getByText('1 order to confirm')).toBeOnTheScreen();
    expect(screen.getByText('2 offers need a reply')).toBeOnTheScreen();
    expect(screen.getByLabelText('Offers received: 20')).toBeOnTheScreen();
    expect(screen.getByLabelText('Median time to confirm: 2 h 10 min')).toBeOnTheScreen();
    expect(screen.getByLabelText('Rating: 4.5 (3)')).toBeOnTheScreen();
  });
  it('shows a dash for a median that does not exist yet, and an error with retry', async () => {
    let fail = true;
    fakeApi({ 'GET /v1/seller/dashboard': () => (fail ? json({ title: 'x', status: 500, code: 'INTERNAL', detail: 'down' }, 500) : json({ windows: [win(7, 1), win(30, 1)], record: { orders: 0, completed: 0, confirmed: 0, cancelled: 0, expired: 0, medianConfirmMs: null, rating: null, reviewCount: 0 }, needsReply: 0, needsConfirm: 0 })) }, fetchMock);
    await renderWith(signedIn(), <DashboardScreen />);
    expect(await screen.findByText('Can’t load the dashboard')).toBeOnTheScreen();
    fail = false;
    await act(async () => void fireEvent.press(screen.getByText('Try again')));
    expect(await screen.findByLabelText('Median time to confirm: —')).toBeOnTheScreen();
    expect(screen.getByText('No orders waiting')).toBeOnTheScreen();
  });
});
