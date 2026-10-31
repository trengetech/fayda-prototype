import { act, fireEvent, screen, within } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';
import OrdersScreen from '../app/orders';
import OrderScreen from '../app/order/[id]';
import { fakeApi, json, managerWith, renderWith, sellerOrder } from './utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
const mockOpen = jest.spyOn(Linking, 'openURL');

let seq = 0;
let fetchMock: jest.Mock;
const signedIn = () => managerWith('seller', fetchMock, { missing: [] });
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));
const type = (label: string, text: string) => act(async () => void fireEvent.changeText(screen.getAllByLabelText(label).at(-1) as never, text));
const posts = () => fetchMock.mock.calls.filter((c) => c[1]?.method === 'POST');
beforeEach(() => {
  fetchMock = jest.fn();
  mockRouter.push.mockClear();
  mockOpen.mockReset();
  mockOpen.mockResolvedValue(true as never);
  // The query cache outlives a test, so every test (and every render in a test) uses its own order id.
  mockParams = { id: `order-${++seq}` };
});

const placed = sellerOrder();
const confirmed = sellerOrder({ id: 'o2', number: 'FD-100002', status: 'CONFIRMED', statusLabel: 'Confirmed', buyerName: 'Ravi', canConfirm: false, canShip: true, canDeliver: true, canCancel: true, confirmedAt: 5 });
const shipped = sellerOrder({ id: 'o3', number: 'FD-100003', status: 'SHIPPED', statusLabel: 'Shipped', buyerName: 'Meera', canConfirm: false, canShip: true, canDeliver: true, canCancel: false });
const delivered = sellerOrder({ id: 'o4', number: 'FD-100004', status: 'DELIVERED', statusLabel: 'Delivered', buyerName: 'Kiran', canConfirm: false, canShip: false, canDeliver: false, canCancel: false, buyerContact: null });
const list = (items: unknown[], extra = {}) => json({ items, needsConfirm: 1, unread: 2, ...extra });

/** The text column of an order row: the nearest ancestor of the title that has flex: 1. */
type Node = ReturnType<typeof screen.getByText>;
function textColumn(title: Node): Node {
  let n: Node | null = title.parent;
  while (n && StyleSheet.flatten(n.props.style)?.flex !== 1) n = n.parent;
  if (!n) throw new Error('no flex:1 text column above the title');
  return n;
}

describe('orders list', () => {
  it('groups orders into the four tabs with their counts', async () => {
    fakeApi({ 'GET /v1/seller/orders': () => list([placed, confirmed, shipped, delivered]) }, fetchMock);
    await renderWith(signedIn(), <OrdersScreen />);
    expect(await screen.findByLabelText('Needs confirming (1)')).toBeOnTheScreen();
    expect(screen.getByLabelText('Confirmed (1)')).toBeOnTheScreen();
    expect(screen.getByLabelText('Shipped (1)')).toBeOnTheScreen();
    expect(screen.getByLabelText('Closed (1)')).toBeOnTheScreen();
    expect(screen.getByText(/FD-100001/)).toBeOnTheScreen();
    expect(screen.queryByText(/FD-100002/)).not.toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Confirmed (1)')));
    expect(screen.getByText(/FD-100002/)).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Closed (1)')));
    expect(screen.getByText(/FD-100004/)).toBeOnTheScreen();
    expect(screen.getByText('Messages (2)')).toBeOnTheScreen();
  });

  it('keeps the status and unread labels in the text column, under the title (not in a squeezed side column)', async () => {
    fakeApi({ 'GET /v1/seller/orders': () => list([placed]) }, fetchMock);
    await renderWith(signedIn(), <OrdersScreen />);
    const title = await screen.findByText(placed.listing.title);
    const column = within(textColumn(title));
    expect(column.getByText(/FD-100001/)).toBeOnTheScreen();
    expect(column.getByText(/Confirm within/)).toBeOnTheScreen();
    expect(column.getByText(placed.statusLabel)).toBeOnTheScreen();
  });

  it('opens an order and shows a friendly message when a tab is empty', async () => {
    fakeApi({ 'GET /v1/seller/orders': () => list([placed]) }, fetchMock);
    await renderWith(signedIn(), <OrdersScreen />);
    await act(async () => void fireEvent.press(await screen.findByLabelText('Open order FD-100001')));
    expect(mockRouter.push).toHaveBeenCalledWith('/order/o1');
    await act(async () => void fireEvent.press(screen.getByLabelText('Shipped (0)')));
    expect(screen.getByText('No shipped orders')).toBeOnTheScreen();
  });
});

describe('order screen', () => {
  it('shows only the buttons the server allows, and the right confirm wording per channel', async () => {
    fakeApi({ [`GET /v1/seller/orders/${mockParams.id}`]: () => json(placed) }, fetchMock);
    const first = await renderWith(signedIn(), <OrderScreen />);
    expect(await screen.findByText('Payment received')).toBeOnTheScreen();
    expect(screen.getByText('Cancel this order')).toBeOnTheScreen();
    expect(screen.queryByText('Mark delivered')).not.toBeOnTheScreen();
    expect(screen.getByText(/Confirm within/)).toBeOnTheScreen();
    await first.unmount();

    fetchMock = jest.fn();
    mockParams = { id: `order-${++seq}` };
    fakeApi({ [`GET /v1/seller/orders/${mockParams.id}`]: () => json(sellerOrder({ channel: 'WEBSITE', address: null, paymentMethod: null, dealAccess: { type: 'CODE', value: 'SAVE20' }, listing: { ...placed.listing, channel: 'WEBSITE' } })) }, fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    expect(await screen.findByText('Order received')).toBeOnTheScreen();
    expect(screen.getByText('Coupon code: SAVE20')).toBeOnTheScreen();
    expect(screen.queryByText('Deliver to')).not.toBeOnTheScreen();
  });

  it('shows no action card when nothing can be done', async () => {
    fakeApi({ [`GET /v1/seller/orders/${mockParams.id}`]: () => json(delivered) }, fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    expect(await screen.findByText('Delivered')).toBeOnTheScreen();
    expect(screen.queryByText('Next step')).not.toBeOnTheScreen();
    expect(screen.queryByText('Cancel this order')).not.toBeOnTheScreen();
  });

  it('confirms with one tap and sends an idempotency key', async () => {
    fakeApi({ [`GET /v1/seller/orders/${mockParams.id}`]: () => json(placed), [`POST /v1/seller/orders/${mockParams.id}/confirm`]: () => json({ ...placed, status: 'CONFIRMED', canConfirm: false }) }, fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await press((await screen.findByText('Payment received')).props.children);
    const [, init] = posts()[0]!;
    expect(init.headers['idempotency-key']).toMatch(/^confirm-o1-/);
    expect(JSON.parse(init.body)).toEqual({ shipment: null });
  });

  it('cancelling needs a reason, then sends it', async () => {
    fakeApi({ [`GET /v1/seller/orders/${mockParams.id}`]: () => json(placed), [`POST /v1/seller/orders/${mockParams.id}/cancel`]: () => json({ ...placed, status: 'CANCELLED', canConfirm: false, canCancel: false }) }, fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await screen.findByText('Cancel this order');
    await press('Cancel this order');
    await press('Yes, cancel the order');
    expect(screen.getByText('Choose a reason.')).toBeOnTheScreen();
    expect(posts()).toHaveLength(0);
    // a direct order offers "payment not received", not the website lookup reason
    expect(screen.queryByLabelText('No matching order on the website')).not.toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Out of stock')));
    await press('Yes, cancel the order');
    expect(JSON.parse(posts()[0]![1].body)).toEqual({ reason: 'OUT_OF_STOCK', note: null });
  });

  it('checks shipment details before sending them', async () => {
    fakeApi({ [`GET /v1/seller/orders/${mockParams.id}`]: () => json(confirmed), [`POST /v1/seller/orders/${mockParams.id}/ship`]: () => json({ ...confirmed, status: 'SHIPPED' }) }, fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await screen.findByText('Add shipment details');
    await press('Add shipment details');
    await press('Save shipment details');
    expect(screen.getByText(/Add a courier, tracking number, link or a note/)).toBeOnTheScreen();
    await type('Tracking link', 'http://insecure.example');
    await type('Expected delivery date', 'tomorrow');
    await press('Save shipment details');
    expect(screen.getByText('Enter a full https:// tracking link.')).toBeOnTheScreen();
    expect(screen.getByText('Use a date like 2026-11-04.')).toBeOnTheScreen();
    expect(posts()).toHaveLength(0);
    await type('Tracking link', 'https://track.example/abc');
    await type('Expected delivery date', '2026-11-04');
    await type('Courier', 'Delhivery');
    await press('Save shipment details');
    expect(JSON.parse(posts()[0]![1].body)).toEqual({ courier: 'Delhivery', trackingNo: null, trackingUrl: 'https://track.example/abc', expectedDate: '2026-11-04', note: null });
  });

  it('shows the buyer’s contact while the order is open, and hides the numbers after it closes', async () => {
    fakeApi({ [`GET /v1/seller/orders/${mockParams.id}`]: () => json(placed) }, fetchMock);
    const first = await renderWith(signedIn(), <OrderScreen />);
    expect(await screen.findByText('WhatsApp')).toBeOnTheScreen();
    expect(screen.getByText('Call')).toBeOnTheScreen();
    await press('WhatsApp');
    expect(mockOpen).toHaveBeenCalledWith('https://wa.me/919000000001?text=Hi%2C%20this%20is%20about%20order%20FD-100001.');
    await press('Call');
    expect(mockOpen).toHaveBeenCalledWith('tel:+919000000001');
    await screen.findByText('Chat in app');
    await press('Chat in app');
    expect(mockRouter.push).toHaveBeenCalledWith('/chat/t1');
    await first.unmount();

    fetchMock = jest.fn();
    mockParams = { id: `order-${++seq}` };
    fakeApi({ [`GET /v1/seller/orders/${mockParams.id}`]: () => json(delivered) }, fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    expect(await screen.findByText(/only the chat remains/)).toBeOnTheScreen();
    expect(screen.queryByText('WhatsApp')).not.toBeOnTheScreen();
    expect(screen.queryByText('Call')).not.toBeOnTheScreen();
  });

  it('tells the seller the number when no app can open a link', async () => {
    mockOpen.mockRejectedValue(new Error('no app'));
    fakeApi({ [`GET /v1/seller/orders/${mockParams.id}`]: () => json(placed) }, fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await press((await screen.findByText('WhatsApp')).props.children);
    expect(await screen.findByText('WhatsApp isn’t available. The number is 9000000001.')).toBeOnTheScreen();
    const setString = jest.requireMock('expo-clipboard').setStringAsync as jest.Mock;
    setString.mockClear();
    await press('Copy number');
    expect(setString).toHaveBeenCalledWith('9000000001');
    expect(screen.getByText('Copied')).toBeOnTheScreen();
  });

  it('shows the buyer’s review', async () => {
    fakeApi({ [`GET /v1/seller/orders/${mockParams.id}`]: () => json(sellerOrder({ review: { id: 'rv1', rating: 4, text: 'Lovely fabric', media: [], createdAt: 1, editedAt: null } })) }, fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    expect(await screen.findByText('Lovely fabric')).toBeOnTheScreen();
    expect(screen.getByText('Verified order')).toBeOnTheScreen();
  });
});
