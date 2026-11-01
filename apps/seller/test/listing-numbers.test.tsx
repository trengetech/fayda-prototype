import { act, fireEvent, screen } from '@testing-library/react-native';
import DashboardScreen from '../app/(tabs)/index';
import { fakeApi, json, managerWith, renderWith } from './utils';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }), useLocalSearchParams: () => ({}) }));

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
});
const win = (days: number) => ({ days, views: 1, offersReceived: 1, offersAgreed: 0, ordersPlaced: 1, ordersConfirmed: 0, ordersDelivered: 0, likes: 1, saves: 1, comments: 1 });
const n = (over: Record<string, unknown> = {}) => ({ views: 0, likes: 0, saves: 0, comments: 0, offers: 0, orders: 0, conversionPct: null, ...over });
const record = { orders: 0, completed: 0, confirmed: 0, cancelled: 0, expired: 0, medianConfirmMs: null, rating: null, reviewCount: 0 };
const dashboard = (listings: unknown[]) => json({ windows: [win(7), win(30)], record, needsReply: 0, needsConfirm: 0, listings });

describe('dashboard: numbers per listing', () => {
  it('shows each listing with its counts and conversion, and switches between 7 and 30 days', async () => {
    fakeApi({
      'GET /v1/seller/dashboard': () =>
        dashboard([
          { id: 'l1', title: 'Block print kurta', status: 'ACTIVE', last7: n({ views: 4, orders: 1, conversionPct: 25 }), last30: n({ views: 40, likes: 6, saves: 3, comments: 2, offers: 5, orders: 4, conversionPct: 10 }) },
          { id: 'l2', title: 'Quiet shirt', status: 'PAUSED', last7: n(), last30: n() },
        ]),
    }, fetchMock);
    await renderWith(managerWith('seller', fetchMock, { missing: [] }), <DashboardScreen />);
    expect(await screen.findByText('Block print kurta')).toBeOnTheScreen();
    expect(screen.getByText('Quiet shirt (paused)')).toBeOnTheScreen();
    expect(screen.getByLabelText(/Block print kurta, last 30 days: 40 views, 6 likes, 3 saves, 2 comments, 5 offers, 4 orders/)).toBeOnTheScreen();
    expect(screen.getByText('Conversion: 10% (orders per 100 views)')).toBeOnTheScreen();
    expect(screen.getByText('Conversion: no views yet')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Show the last 7 days')));
    expect(screen.getByLabelText(/Block print kurta, last 7 days: 4 views/)).toBeOnTheScreen();
    expect(screen.getByText('Conversion: 25% (orders per 100 views)')).toBeOnTheScreen();
  });

  it('says so when there are no live listings', async () => {
    fakeApi({ 'GET /v1/seller/dashboard': () => dashboard([]) }, fetchMock);
    await renderWith(managerWith('seller', fetchMock, { missing: [] }), <DashboardScreen />);
    expect(await screen.findByText('No live listings yet.')).toBeOnTheScreen();
  });
});
