import { act, fireEvent, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import StatusScreen from '../app/index';
import ShopScreen from '../app/shop';
import { fakeApi, json, managerWith, renderWith } from './utils';

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({ Link: ({ children }: { children: React.ReactElement }) => children, useRouter: () => mockRouter }));
const mockOpen = jest.spyOn(Linking, 'openURL');

let fetchMock: jest.Mock;
const signedIn = () => managerWith('seller', fetchMock, { missing: [] });
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));
beforeEach(() => {
  fetchMock = jest.fn();
  mockRouter.push.mockClear();
  mockOpen.mockReset();
  mockOpen.mockResolvedValue(true as never);
});

const profile = {
  id: 's1', sellerType: 'BUSINESS', name: 'Kiran Studio', handle: 'kiran', area: 'Banjara Hills', city: 'Hyderabad', gstin: null, bio: '',
  categories: ['Ethnic wear', 'Accessories'], mapsUrl: 'https://maps.app.goo.gl/abc', googleProfileUrl: null, socialUrl: 'https://instagram.com/kiran',
  contact: { phone: '9000000002', whatsapp: null }, sla: { confirmHours: 6, shipDays: 2 }, payment: null, conductAcceptedAt: 1, missing: [],
};
const record = { orders: 12, completed: 9, confirmed: 11, cancelled: 1, expired: 2, medianConfirmMs: 3 * 3_600_000, rating: 4.5, reviewCount: 4 };
const review = { id: 'v1', rating: 5, text: 'Lovely fabric', media: [{ id: 'mm1', kind: 'image', url: '/v1/media/mm1' }], buyerName: 'Asha', listingTitle: 'Cotton kurta', createdAt: 1, verified: true };

describe('shop screen', () => {
  it('shows what buyers see, the public record against the declared time, and the reviews', async () => {
    fakeApi({ 'GET /v1/seller/profile': () => json(profile), 'GET /v1/seller/record': () => json(record), 'GET /v1/seller/reviews': () => json({ items: [review], rating: 4.5, reviewCount: 4 }) }, fetchMock);
    await renderWith(signedIn(), <ShopScreen />);
    expect(await screen.findByText('Kiran Studio')).toBeOnTheScreen();
    expect(screen.getByText('Confirms payment within 6 h · ships within 2 days')).toBeOnTheScreen();
    expect(screen.getByText('Contact on open orders: Phone')).toBeOnTheScreen();
    expect(await screen.findByText('9 delivered of 12 orders')).toBeOnTheScreen();
    expect(screen.getByText('Median time to confirm: 3 h (you declare 6 h)')).toBeOnTheScreen();
    expect(screen.getByText('Cancelled: 1 · Unconfirmed (expired): 2')).toBeOnTheScreen();
    expect(screen.getByText('Rating 4.5 ★ (4)')).toBeOnTheScreen();
    expect(await screen.findByText('Lovely fabric')).toBeOnTheScreen();
    expect(screen.getByText('Verified order')).toBeOnTheScreen();
    expect(screen.queryByText('Google profile')).not.toBeOnTheScreen();
    await press('Instagram / Facebook');
    expect(mockOpen).toHaveBeenCalledWith('https://instagram.com/kiran');
  });

  it('says so when there are no reviews or confirmed orders yet', async () => {
    fakeApi({ 'GET /v1/seller/profile': () => json({ ...profile, id: 's2' }), 'GET /v1/seller/record': () => json({ ...record, orders: 0, completed: 0, medianConfirmMs: null, rating: null, reviewCount: 0, cancelled: 0, expired: 0 }), 'GET /v1/seller/reviews': () => json({ items: [], rating: null, reviewCount: 0 }) }, fetchMock);
    await renderWith(signedIn(), <ShopScreen />);
    expect(await screen.findByText(/no confirmed orders yet/)).toBeOnTheScreen();
    expect(screen.getAllByText('No reviews yet').length).toBeGreaterThan(0);
  });
});

describe('home screen', () => {
  it('shows what needs the seller: orders to confirm, unread messages, new requests', async () => {
    fakeApi({
      'GET /v1/health': () => json({ status: 'ok', database: { status: 'up', latencyMs: 1 }, time: '2026-10-31T10:00:00.000Z' }),
      'GET /v1/meta': () => json({ environment: 'development', version: '0.0.1', providers: [] }),
      'GET /v1/seller/negotiations': () => json({ items: [], needsReply: 0 }),
      'GET /v1/seller/orders': () => json({ items: [], needsConfirm: 3, unread: 0 }),
      'GET /v1/seller/threads': () => json({ items: [], unread: 2 }),
      'GET /v1/seller/requests': () => json({ items: [], newCount: 1 }),
    }, fetchMock);
    await renderWith(signedIn(), <StatusScreen />);
    expect(await screen.findByText('3 orders need confirming')).toBeOnTheScreen();
    expect(screen.getByText('2 unread messages')).toBeOnTheScreen();
    expect(screen.getByText('1 new buyer request')).toBeOnTheScreen();
    expect(screen.getByText('Orders (3 to confirm)')).toBeOnTheScreen();
    expect(screen.getByText('Messages (2)')).toBeOnTheScreen();
    await press('Messages (2)');
    expect(mockRouter.push).toHaveBeenCalledWith('/messages');
  });
});
