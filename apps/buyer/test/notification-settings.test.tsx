import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import NotificationSettingsScreen from '../app/notification-settings';
import NotificationsScreen from '../app/notifications';
import { fakeApi, json, managerWith, renderWith } from './utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}) }));

let fetchMock: jest.Mock;
const signedIn = () => managerWith('buyer', fetchMock, { missing: [] });
beforeEach(() => {
  fetchMock = jest.fn();
  Object.values(mockRouter).forEach((m) => m.mockClear());
});
const note = (n: number) => ({ id: `n000000${n}`, code: 'NEW_MESSAGE', title: 'New message', body: `Message number ${n}`, at: Date.now() - 60_000, read: false, target: null });
const setting = (category: string, label: string, over: Record<string, unknown> = {}) => ({ category, label, push: true, inApp: true, alwaysOn: false, ...over });
const SETTINGS = { items: [setting('ORDERS', 'Orders', { alwaysOn: true }), setting('CHAT', 'Messages')] };
const called = (m: string, suffix: string) => fetchMock.mock.calls.some((c) => (c[1]?.method ?? 'GET') === m && String(c[0]).endsWith(suffix));

describe('buyer notification centre: delete and clear', () => {
  it('deletes one notification, and clears all only after asking', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    fakeApi({
      'GET /v1/buyer/notifications': () => json({ items: [note(1), note(2)], nextCursor: null, unread: 2 }),
      'DELETE /v1/buyer/notifications/n0000001': () => json({ unread: 1 }),
      'DELETE /v1/buyer/notifications': () => json({ unread: 0 }),
    }, fetchMock);
    await renderWith(signedIn(), <NotificationsScreen />);
    expect(await screen.findByText('Message number 1')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getAllByLabelText(/Delete notification/)[0]!));
    await waitFor(() => expect(called('DELETE', '/notifications/n0000001')).toBe(true));
    expect(mockRouter.push).not.toHaveBeenCalled(); // deleting does not open it
    await act(async () => void fireEvent.press(screen.getByText('Clear all')));
    expect(alert).toHaveBeenCalledWith('Clear all notifications?', expect.any(String), expect.any(Array));
    await waitFor(() => expect(called('DELETE', '/buyer/notifications')).toBe(true));
    alert.mockRestore();
  });

  it('cancelling the confirmation deletes nothing', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    fakeApi({ 'GET /v1/buyer/notifications': () => json({ items: [note(1)], nextCursor: null, unread: 1 }) }, fetchMock);
    await renderWith(signedIn(), <NotificationsScreen />);
    await screen.findByText('Message number 1');
    await act(async () => void fireEvent.press(screen.getByText('Clear all')));
    expect(alert).toHaveBeenCalled();
    expect(called('DELETE', '/buyer/notifications')).toBe(false);
    alert.mockRestore();
  });

  it('links to the settings screen', async () => {
    fakeApi({ 'GET /v1/buyer/notifications': () => json({ items: [], nextCursor: null, unread: 0 }) }, fetchMock);
    await renderWith(signedIn(), <NotificationsScreen />);
    await act(async () => void fireEvent.press(await screen.findByText('Notification settings')));
    expect(mockRouter.push).toHaveBeenCalledWith('/notification-settings');
  });
});

describe('buyer notification settings', () => {
  it('lists the kinds; Orders are locked on; switching one sends that kind’s choice', async () => {
    const sent: unknown[] = [];
    fakeApi({
      'GET /v1/buyer/notifications/settings': () => json(SETTINGS),
      'PUT /v1/buyer/notifications/settings/CHAT': (r) => {
        sent.push((r as never as { body: unknown }).body);
        return json({ items: [SETTINGS.items[0], setting('CHAT', 'Messages', { push: false })] });
      },
    }, fetchMock);
    await renderWith(signedIn(), <NotificationSettingsScreen />);
    expect(await screen.findByText('Orders (always on)')).toBeOnTheScreen();
    expect(screen.getByTestId('push-ORDERS').props.disabled).toBe(true);
    expect(screen.getByTestId('inapp-ORDERS').props.disabled).toBe(true);
    await act(async () => void fireEvent(screen.getByTestId('push-CHAT'), 'valueChange', false));
    await waitFor(() => expect(sent).toEqual([{ push: false, inApp: true }]));
  });

  it('shows an error with a retry when the settings cannot load', async () => {
    fakeApi({ 'GET /v1/buyer/notifications/settings': () => json({ code: 'INTERNAL', title: 'x', status: 500 }, 500) }, fetchMock);
    await renderWith(signedIn(), <NotificationSettingsScreen />);
    expect(await screen.findByText('Try again')).toBeOnTheScreen();
  });
});
