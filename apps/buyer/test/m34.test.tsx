import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Linking, StyleSheet } from 'react-native';
import { pickFiles } from '../src/upload';
import AgreementScreen from '../app/agreement';
import ChatScreen from '../app/chat/[id]';
import CheckoutScreen from '../app/checkout';
import ContactScreen from '../app/contact';
import MessagesScreen from '../app/messages';
import NegotiationScreen from '../app/negotiation/[id]';
import OrderScreen from '../app/order/[id]';
import OrdersScreen from '../app/(tabs)/orders';
import NewRequestScreen from '../app/request/new';
import RequestScreen from '../app/request/[id]';
import RequestsScreen from '../app/requests';
import { buyerListing, buyerNegotiation, buyerOrder, buyerRequest, confirmedOrder, fakeApi, json, managerWith, problem, renderWith, thread, type Route } from './utils';

const clipboard = () => jest.requireMock('expo-clipboard').setStringAsync as jest.Mock;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
const mockPick = jest.fn();
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...a: unknown[]) => mockPick(...a) }));
const mockUpload = jest.fn();
const mockInfo = jest.fn();
jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0 },
  uploadAsync: (...a: unknown[]) => mockUpload(...a),
  getInfoAsync: (...a: unknown[]) => mockInfo(...a),
}));

const LID = '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70';
let fetchMock: jest.Mock;
const signedIn = () => managerWith('buyer', fetchMock, { missing: [] });
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));
const pressLabel = (label: string) => act(async () => void fireEvent.press(screen.getByLabelText(label)));
const type = (label: string, text: string) => act(async () => void fireEvent.changeText(screen.getAllByLabelText(label).at(-1) as never, text));
const profile = () => ({
  name: 'Asha', addresses: [{ id: 'a1', name: 'Asha', line1: '12 Road', line2: '', pin: '500081', city: 'Hyderabad', state: 'Telangana' }], defaultAddressId: 'a1',
  contact: { phone: '9876543210', whatsapp: null }, agreementVersion: 'draft-2026-10', agreementAcceptedAt: 1, missing: [],
});
const order = (o: Record<string, unknown>) => ({ 'GET /v1/buyer/orders/o1': () => json(o) });

beforeEach(() => {
  fetchMock = jest.fn();
  [mockRouter.push, mockRouter.replace, mockRouter.back, mockPick, mockUpload, mockInfo].forEach((m) => m.mockReset());
  mockParams = { id: 'o1' };
});
afterEach(() => jest.restoreAllMocks());

describe('order screen (view only)', () => {
  it('shows loading, then an error with Try again that recovers', async () => {
    let fail = true;
    fakeApi({ 'GET /v1/buyer/orders/o1': () => (fail ? problem(404, 'NOT_FOUND', undefined, 'Order not found.') : json(buyerOrder())) }, fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    expect(await screen.findByText('Can’t load this order')).toBeOnTheScreen();
    fail = false;
    await press('Try again');
    expect(await screen.findByText('Cotton kurta')).toBeOnTheScreen();
  });

  it('shows the payment card with the order number as the note, only when the API sends payment', async () => {
    fakeApi(order(buyerOrder()), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    expect(await screen.findByText('Pay Kiran Studio directly')).toBeOnTheScreen();
    expect(screen.getAllByText('FD-100001').length).toBeGreaterThan(0);
    expect(screen.getByText('kiran@okbank')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Pay in a UPI app' })).toBeOnTheScreen();
    expect(screen.getByLabelText('The seller’s UPI QR code').props.source).toMatchObject({ uri: 'http://api.test/v1/buyer/orders/o1/payment-qr' });
  });

  it('shows no payment card once the order is confirmed', async () => {
    fakeApi(order(confirmedOrder()), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await screen.findByText('Cotton kurta');
    expect(screen.queryByText(/Pay .* directly/)).not.toBeOnTheScreen();
    expect(screen.queryByText('Pay in a UPI app')).not.toBeOnTheScreen();
  });

  it('opens the UPI app with the link from the API', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    fakeApi(order(buyerOrder()), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await screen.findByText('Pay Kiran Studio directly');
    await press('Pay in a UPI app');
    expect(open).toHaveBeenCalledWith(buyerOrder().payment.upiUri);
    expect(screen.queryByText(/No UPI app could open/)).not.toBeOnTheScreen();
  });

  it('says so, and shows the UPI ID and note to use, when no UPI app can open', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('no handler'));
    fakeApi(order(buyerOrder()), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await screen.findByText('Pay Kiran Studio directly');
    await press('Pay in a UPI app');
    expect(await screen.findByText(/No UPI app could open. Pay to the UPI ID kiran@okbank .* write FD-100001 as the note/)).toBeOnTheScreen();
  });

  it('copies the order number and the UPI ID with one tap, and says Copied', async () => {
    fakeApi(order(buyerOrder()), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await screen.findByText('Pay Kiran Studio directly');
    clipboard().mockClear();
    const [noteCopy, upiCopy] = screen.getAllByText('Copy');
    await act(async () => void fireEvent.press(noteCopy as never));
    expect(clipboard()).toHaveBeenLastCalledWith('FD-100001');
    expect(screen.getByText('Copied')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(upiCopy as never));
    expect(clipboard()).toHaveBeenLastCalledWith('kiran@okbank');
  });

  it('says Couldn’t copy if the phone refuses the clipboard', async () => {
    fakeApi(order(buyerOrder()), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await screen.findByText('Pay Kiran Studio directly');
    clipboard().mockRejectedValueOnce(new Error('denied'));
    await act(async () => void fireEvent.press(screen.getAllByText('Copy')[0] as never));
    expect(screen.getByText('Couldn’t copy')).toBeOnTheScreen();
  });

  it('shows bank details for a bank order, and no UPI button', async () => {
    fakeApi(order(buyerOrder({ paymentMethod: 'BANK', payment: { method: 'BANK', note: 'FD-100001', amount: 150000, payeeName: 'Kiran Studio', upiId: null, upiUri: null, upiQrUrl: null, bank: { holder: 'Kiran R', account: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC' }, paymentLink: null } })), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    expect(await screen.findByText('123456789012')).toBeOnTheScreen();
    expect(screen.getByText('HDFC0001234')).toBeOnTheScreen();
    expect(screen.queryByText('Pay in a UPI app')).not.toBeOnTheScreen();
  });

  it('has nothing that moves the order forward: no confirm, ship, deliver, cancel or buy buttons', async () => {
    fakeApi(order(buyerOrder()), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await screen.findByText('Cotton kurta');
    for (const t of [/^confirm/i, /ship/i, /deliver/i, /cancel/i, /mark/i, /^buy$/i, /place order/i, /payment received/i])
      expect(screen.queryByRole('button', { name: t })).not.toBeOnTheScreen();
    expect(fetchMock.mock.calls.every((c) => (c[1]?.method ?? 'GET') === 'GET')).toBe(true);
  });

  it('shows the timeline up to what the seller has done, and a cancelled order with its reason', async () => {
    fakeApi(order(buyerOrder({ status: 'CANCELLED', statusLabel: 'Cancelled', payment: null, cancelText: 'Payment not received' })), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    expect(await screen.findByText('Cancelled by seller')).toBeOnTheScreen();
    expect(screen.getByText('Payment not received')).toBeOnTheScreen();
  });

  it('shows the seller’s contact while the order is open: chat with unread badge, WhatsApp with the order number, Call', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    fakeApi(order(buyerOrder({ unread: 2 })), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await screen.findByText('Cotton kurta');
    expect(screen.getByText('2 new')).toBeOnTheScreen();
    expect(screen.getByText(/usually confirms in 2 h/)).toBeOnTheScreen();
    expect(screen.getByText(/★ 4.5 \(12\)/)).toBeOnTheScreen();
    await press('WhatsApp');
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^https:\/\/wa\.me\/919000000002\?text=.*FD-100001/));
    await press('Call');
    expect(open).toHaveBeenCalledWith('tel:+919000000002');
    await press('Chat in app');
    expect(mockRouter.push).toHaveBeenCalledWith('/chat/t1');
  });

  it('hides the phone and WhatsApp when the API sends no contact, but keeps chat', async () => {
    fakeApi(order(buyerOrder({ status: 'DELIVERED', statusLabel: 'Delivered', payment: null, seller: { ...buyerOrder().seller, contact: null } })), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await screen.findByText('Cotton kurta');
    expect(screen.queryByText('WhatsApp')).not.toBeOnTheScreen();
    expect(screen.queryByText('Call')).not.toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Chat in app' })).toBeOnTheScreen();
  });

  it('shows the number to copy when WhatsApp cannot open', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('none'));
    fakeApi(order(buyerOrder()), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await screen.findByText('Cotton kurta');
    await press('WhatsApp');
    expect(await screen.findByText(/The number is 9000000002/)).toBeOnTheScreen();
    clipboard().mockClear();
    await press('Copy number');
    expect(clipboard()).toHaveBeenCalledWith('9000000002');
    expect(screen.getByText('Copied')).toBeOnTheScreen();
  });

  it('shows the website deal code, with Buy again going to checkout for the same size', async () => {
    fakeApi(order(buyerOrder({ channel: 'WEBSITE', payment: null, address: null, dealAccess: { type: 'CODE', value: 'KURTA14' } })), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    expect(await screen.findByText('KURTA14')).toBeOnTheScreen();
    await press('Buy again');
    expect(mockRouter.push).toHaveBeenCalledWith(`/checkout?listingId=${LID}&variantId=v1`);
  });
});

describe('reviewing from the order screen', () => {
  it('offers no review form until the order can be reviewed', async () => {
    fakeApi(order(buyerOrder()), fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await screen.findByText('Cotton kurta');
    expect(screen.queryByText('Rate this seller')).not.toBeOnTheScreen();
  });

  it('asks for a reason on a low rating, then posts rating, text and photos with an idempotency key', async () => {
    const puts: { body: unknown; headers: Record<string, string> }[] = [];
    let state = confirmedOrder();
    fakeApi({ 'GET /v1/buyer/orders/o1': () => json(state), 'PUT /v1/buyer/orders/o1/review': ({ body, headers }) => (puts.push({ body, headers }), (state = confirmedOrder({ review: { id: 'r1', rating: 2, text: 'Arrived late and torn', media: [], createdAt: 9, editedAt: null }, canReview: false })), json(state)) }, fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await screen.findByText('Rate this seller');
    await pressLabel('2 stars');
    await press('Post review');
    expect(await screen.findByText(/at least 10 characters/)).toBeOnTheScreen();
    expect(puts).toHaveLength(0);
    await type('Your review', 'Arrived late and torn');
    await press('Post review');
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]?.body).toEqual({ rating: 2, text: 'Arrived late and torn', mediaIds: [] });
    expect(puts[0]?.headers['idempotency-key']).toMatch(/.{8,}/);
    expect(await screen.findByText('Your review')).toBeOnTheScreen();
    expect(screen.getByText('Edit review')).toBeOnTheScreen();
  });

  it('editing a posted review leaves the photos alone unless they are changed', async () => {
    const puts: unknown[] = [];
    const posted = confirmedOrder({ review: { id: 'r1', rating: 5, text: 'Lovely', media: [{ id: 'x1', kind: 'image', url: '/v1/media/x1' }], createdAt: 9, editedAt: null }, canReview: false });
    fakeApi({ ...order(posted), 'PUT /v1/buyer/orders/o1/review': ({ body }) => (puts.push(body), json(posted)) }, fetchMock);
    await renderWith(signedIn(), <OrderScreen />);
    await press((await screen.findByText('Edit review')).props.children as string);
    await type('Your review', 'Lovely, thank you');
    await press('Save changes');
    await waitFor(() => expect(puts).toHaveLength(1));
    expect(puts[0]).toEqual({ rating: 5, text: 'Lovely, thank you' });
  });
});

describe('checkout', () => {
  const routes = (extra: Record<string, Route> = {}) => ({
    [`GET /v1/buyer/listings/${LID}`]: () => json(buyerListing({ variants: [{ id: 'v1', label: 'M', available: true, low: false }, { id: 'v2', label: 'L', available: true, low: false }, { id: 'v3', label: 'S', available: false, low: false }] })),
    'GET /v1/buyer/profile': () => json(profile()),
    ...extra,
  });

  it('needs a size and a payment method; sells only sizes in stock; shows the price and no cash on delivery', async () => {
    mockParams = { listingId: LID };
    fakeApi(routes(), fetchMock);
    await renderWith(signedIn(), <CheckoutScreen />);
    await screen.findByText('Cotton kurta');
    expect(screen.queryByLabelText('S')).not.toBeOnTheScreen();
    expect(screen.getByText(/no cash on delivery/i)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Place order · ₹1,500' })).toBeDisabled();
    await pressLabel('L');
    expect(screen.getByRole('button', { name: 'Place order · ₹1,500' })).toBeDisabled();
    await pressLabel('UPI');
    expect(screen.getByRole('button', { name: 'Place order · ₹1,500' })).toBeEnabled();
  });

  it('places the order without a price, then opens it; a retry after a failure reuses the same idempotency key', async () => {
    mockParams = { listingId: LID };
    const sent: { body: unknown; headers: Record<string, string> }[] = [];
    let fail = true;
    fakeApi(routes({ 'POST /v1/buyer/orders': ({ body, headers }) => (sent.push({ body, headers }), fail ? problem(400, 'VALIDATION', undefined, 'Try again in a moment.') : json(buyerOrder(), 201)) }), fetchMock);
    await renderWith(signedIn(), <CheckoutScreen />);
    await screen.findByText('Cotton kurta');
    await pressLabel('L');
    await pressLabel('UPI');
    await press('Place order · ₹1,500');
    expect(await screen.findByText('Try again in a moment.')).toBeOnTheScreen();
    fail = false;
    await press('Place order · ₹1,500');
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0]?.body).toEqual({ listingId: LID, variantId: 'v2', addressId: 'a1', paymentMethod: 'UPI' });
    expect(sent[0]?.body).not.toHaveProperty('price');
    expect(sent[1]?.headers['idempotency-key']).toBe(sent[0]?.headers['idempotency-key']);
    expect(mockRouter.replace).toHaveBeenCalledWith('/order/o1');
  });

  it('places an agreed offer at the agreed price using the negotiation, with the size fixed', async () => {
    mockParams = { negotiationId: 'n1', listingId: LID, variantId: 'v1' };
    const sent: unknown[] = [];
    fakeApi(
      routes({
        'GET /v1/buyer/negotiations/n1': () => json(buyerNegotiation({ status: 'AGREED', statusLabel: 'Agreed', agreement: { price: 140000, deadline: Date.now() + 40_000_000, dealAccess: null } })),
        'POST /v1/buyer/orders': ({ body }) => (sent.push(body), json(buyerOrder({ priceSource: 'NEGOTIATED', price: 140000 }), 201)),
      }),
      fetchMock,
    );
    await renderWith(signedIn(), <CheckoutScreen />);
    await screen.findByText(/Agreed price held for you/);
    expect(screen.getAllByText('₹1,400').length).toBeGreaterThan(0);
    expect(screen.getByText('− ₹100')).toBeOnTheScreen(); // saved by bargaining
    await pressLabel('Bank transfer');
    await press('Place order · ₹1,400');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ negotiationId: 'n1', addressId: 'a1', paymentMethod: 'BANK' });
  });

  it('shows an error with Try again when checkout cannot start', async () => {
    mockParams = { listingId: LID };
    fakeApi(routes({ 'GET /v1/buyer/profile': () => problem(500, 'INTERNAL', undefined, 'Server trouble') }), fetchMock);
    await renderWith(signedIn(), <CheckoutScreen />);
    expect(await screen.findByText('Can’t start checkout')).toBeOnTheScreen();
    expect(screen.getByText('Server trouble')).toBeOnTheScreen();
  });
});

describe('placing an agreed offer from the negotiation screen', () => {
  const agreed = (channel: 'DIRECT' | 'WEBSITE') =>
    buyerNegotiation({ status: 'AGREED', statusLabel: 'Agreed', channel, canWithdraw: false, agreement: { price: 140000, deadline: Date.now() + 40_000_000, dealAccess: channel === 'WEBSITE' ? { type: 'CODE', value: 'KURTA14' } : null } });

  it('a direct agreement goes to checkout with the negotiation', async () => {
    mockParams = { id: 'n1' };
    fakeApi({ 'GET /v1/buyer/negotiations/n1': () => json(agreed('DIRECT')) }, fetchMock);
    await renderWith(signedIn(), <NegotiationScreen />);
    await screen.findByText('Continue · ₹1,400');
    await press('Continue · ₹1,400');
    expect(mockRouter.push).toHaveBeenCalledWith(`/checkout?negotiationId=n1&listingId=${LID}&variantId=v1`);
  });

  it('a website agreement records the order with just the negotiation id, then opens it', async () => {
    mockParams = { id: 'n1' };
    const sent: unknown[] = [];
    fakeApi({ 'GET /v1/buyer/negotiations/n1': () => json(agreed('WEBSITE')), 'POST /v1/buyer/orders': ({ body }) => (sent.push(body), json(buyerOrder({ channel: 'WEBSITE', payment: null }), 201)) }, fetchMock);
    await renderWith(signedIn(), <NegotiationScreen />);
    await screen.findByText('I’ve used the code. Record my order');
    await press('I’ve used the code. Record my order');
    await waitFor(() => expect(sent).toEqual([{ negotiationId: 'n1' }]));
    expect(mockRouter.replace).toHaveBeenCalledWith('/order/o1');
  });
});

/** The text column of an order row: the nearest ancestor of the title that has flex: 1. */
type Node = ReturnType<typeof screen.getByText>;
function textColumn(title: Node): Node {
  let n: Node | null = title.parent;
  while (n && StyleSheet.flatten(n.props.style)?.flex !== 1) n = n.parent;
  if (!n) throw new Error('no flex:1 text column above the title');
  return n;
}

describe('my orders', () => {
  const list = [
    buyerOrder({ unread: 3 }),
    confirmedOrder({ id: 'o2', number: 'FD-100002' }),
    buyerOrder({ id: 'o3', number: 'FD-100003', status: 'CANCELLED', statusLabel: 'Cancelled', payment: null, buyAgain: null }),
  ];
  it('lists orders with an unread badge, filters them, and offers Buy again and Rate', async () => {
    fakeApi({ 'GET /v1/buyer/orders': () => json({ items: list, unread: 3 }) }, fetchMock);
    await renderWith(signedIn(), <OrdersScreen />);
    expect(await screen.findByText(/FD-100001/)).toBeOnTheScreen();
    expect(screen.getByText('3 new messages')).toBeOnTheScreen();
    expect(screen.getAllByText('Rate seller')).toHaveLength(1); // only the confirmed order can be rated
    await pressLabel('Closed');
    expect(screen.queryByText(/FD-100001/)).not.toBeOnTheScreen();
    expect(screen.getByText(/FD-100003/)).toBeOnTheScreen();
    await pressLabel('All');
    await press('Rate seller');
    expect(mockRouter.push).toHaveBeenCalledWith('/order/o2?rate=1');
  });

  it('keeps the status and unread labels in the text column, under the title (not in a squeezed side column)', async () => {
    fakeApi({ 'GET /v1/buyer/orders': () => json({ items: [buyerOrder({ unread: 3, statusLabel: 'Waiting for the seller to confirm your payment' })], unread: 3 }) }, fetchMock);
    await renderWith(signedIn(), <OrdersScreen />);
    const title = await screen.findByText(list[0]!.listing.title);
    const column = within(textColumn(title));
    expect(column.getByText('Waiting for the seller to confirm your payment')).toBeOnTheScreen();
    expect(column.getByText('3 new messages')).toBeOnTheScreen();
    expect(column.getByText(/FD-100001/)).toBeOnTheScreen();
  });

  it('shows an empty state and an error state with Try again', async () => {
    let fail = true;
    fakeApi({ 'GET /v1/buyer/orders': () => (fail ? problem(500, 'INTERNAL', undefined, 'Oops') : json({ items: [], unread: 0 })) }, fetchMock);
    await renderWith(signedIn(), <OrdersScreen />);
    expect(await screen.findByText('Can’t load your orders')).toBeOnTheScreen();
    fail = false;
    await press('Try again');
    expect(await screen.findByText('No orders yet')).toBeOnTheScreen();
  });
});

describe('messages and chat', () => {
  it('lists chats with unread badges', async () => {
    fakeApi({ 'GET /v1/buyer/threads': () => json({ items: [{ ...thread({ unread: 2 }), messages: undefined }], unread: 2 }) }, fetchMock);
    await renderWith(signedIn(), <MessagesScreen />);
    expect(await screen.findByText('FD-100001 · Cotton kurta')).toBeOnTheScreen();
    expect(screen.getByText('2 new')).toBeOnTheScreen();
    await pressLabel('Open chat: FD-100001 · Cotton kurta');
    expect(mockRouter.push).toHaveBeenCalledWith('/chat/t1');
  });

  it('shows the timeline with the system message, and marks the chat read when there are unread messages', async () => {
    mockParams = { id: 't1' };
    let reads = 0;
    fakeApi({ 'GET /v1/buyer/threads/t1': () => json(thread({ unread: 1 })), 'POST /v1/buyer/threads/t1/read': () => (reads++, json(thread({ unread: 0 }))) }, fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    expect(await screen.findByText('Order FD-100001 placed. Chat here about this order.')).toBeOnTheScreen();
    expect(screen.getByText('Hello, thanks for the order')).toBeOnTheScreen();
    await waitFor(() => expect(reads).toBe(1));
  });

  it('does not mark read when there is nothing unread', async () => {
    mockParams = { id: 't1' };
    fakeApi({ 'GET /v1/buyer/threads/t1': () => json(thread()) }, fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    await screen.findByText('Hello, thanks for the order');
    expect(fetchMock.mock.calls.some((c) => String(c[0]).endsWith('/read'))).toBe(false);
  });

  it('sends text with a client key, and a retry after a failure reuses the key', async () => {
    mockParams = { id: 't1' };
    const sent: { body: { clientKey: string; text: string } }[] = [];
    let fail = true;
    fakeApi({ 'GET /v1/buyer/threads/t1': () => json(thread()), 'POST /v1/buyer/threads/t1/messages': ({ body }) => (sent.push({ body: body as never }), fail ? problem(400, 'VALIDATION', undefined, 'Not sent') : json(thread(), 201)) }, fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    await screen.findByText('Hello, thanks for the order');
    await type('Message', 'Is it still in M?');
    await press('Send');
    expect(await screen.findByText('Not sent')).toBeOnTheScreen();
    fail = false;
    await press('Send');
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[0]?.body.text).toBe('Is it still in M?');
    expect(sent[1]?.body.clientKey).toBe(sent[0]?.body.clientKey);
    expect(sent[0]?.body.clientKey.length).toBeGreaterThanOrEqual(8);
  });

  it('opens a listing card from the seller with View and buy', async () => {
    mockParams = { id: 't1' };
    const withCard = thread({ messages: [{ id: 'm3', from: 'OTHER', type: 'LISTING', text: null, media: null, listing: { id: LID, title: 'Green saree', price: 450000, coverUrl: null }, at: 4 }] });
    fakeApi({ 'GET /v1/buyer/threads/t1': () => json(withCard) }, fetchMock);
    await renderWith(signedIn(), <ChatScreen />);
    await screen.findByLabelText('Open Green saree');
    await act(async () => void fireEvent.press(screen.getByLabelText('Open Green saree')));
    expect(mockRouter.push).toHaveBeenCalledWith(`/listing/${LID}`);
  });
});

describe('asking sellers', () => {
  const mediaRoutes = (id: string): Record<string, Route> => ({
    'POST /v1/buyer/media/intents': () => json({ mediaId: id, upload: { method: 'PUT', url: `/v1/media/upload/${id}?token=t`, headers: { 'Content-Type': 'image/jpeg' } }, expiresAt: Date.now() + 900_000 }, 201),
    [`POST /v1/buyer/media/${id}/complete`]: () => json({ id, kind: 'image', purpose: 'REQUEST', status: 'READY', size: 1000, url: `/v1/media/${id}` }),
  });
  const MID = 'c3c3c3c3-0000-4000-8000-000000000001';

  it('checks the form before sending: category, title and at least one photo', async () => {
    fakeApi({}, fetchMock);
    await renderWith(signedIn(), <NewRequestScreen />);
    await press('Send to sellers');
    expect(await screen.findByText('Choose a category.')).toBeOnTheScreen();
    expect(screen.getByText(/3–80 characters/)).toBeOnTheScreen();
    expect(screen.getByText(/at least one photo/)).toBeOnTheScreen();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows how many sellers it will reach, uploads a photo, and sends the request in paise', async () => {
    const sent: { body: unknown; headers: Record<string, string> }[] = [];
    fakeApi({ ...mediaRoutes(MID), 'GET /v1/buyer/requests/reach?category=Ethnic%20wear': () => json({ count: 3 }), 'POST /v1/buyer/requests': ({ body, headers }) => (sent.push({ body, headers }), json(buyerRequest(), 201)) }, fetchMock);
    mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///p.jpg', type: 'image', mimeType: 'image/jpeg', fileSize: 1000, fileName: 'p.jpg' }] });
    mockUpload.mockResolvedValue({ status: 200 });
    mockInfo.mockResolvedValue({ exists: true, size: 1000 });
    await renderWith(signedIn(), <NewRequestScreen />);
    await pressLabel('Ethnic wear');
    expect(await screen.findByText('Send to 3 sellers')).toBeOnTheScreen();
    await type('What are you looking for?', 'Green silk saree');
    await type('Budget', '5000');
    await press('Add photo');
    await screen.findByLabelText('Remove image');
    await press('Send to 3 sellers');
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.body).toEqual({ category: 'Ethnic wear', title: 'Green silk saree', description: null, size: null, budget: 500000, mediaIds: [MID] });
    expect(sent[0]?.headers['idempotency-key']).toMatch(/.{8,}/);
    expect(mockRouter.replace).toHaveBeenCalledWith('/request/r1');
  });

  it('lists requests with how many sellers replied', async () => {
    fakeApi({ 'GET /v1/buyer/requests': () => json({ items: [buyerRequest()] }) }, fetchMock);
    await renderWith(signedIn(), <RequestsScreen />);
    expect(await screen.findByText('Green silk saree')).toBeOnTheScreen();
    expect(screen.getByText(/sent to 3 sellers/)).toBeOnTheScreen();
    expect(screen.getByText('1 response')).toBeOnTheScreen();
  });

  it('shows replies with the seller’s rating, price and message; I want this opens the chat', async () => {
    mockParams = { id: 'r1' };
    let state = buyerRequest();
    const want: string[] = [];
    fakeApi({
      'GET /v1/buyer/requests/r1': () => json(state),
      'POST /v1/buyer/responses/resp1/want': ({ headers }) => (want.push(headers['idempotency-key'] as string), (state = buyerRequest({ responses: [{ ...buyerRequest().responses[0], status: 'WANTED', threadId: 't9' }] })), json(state)),
    }, fetchMock);
    await renderWith(signedIn(), <RequestScreen />);
    expect(await screen.findByLabelText('Rated 4.5 from 12 reviews')).toBeOnTheScreen();
    expect(screen.getByText('₹4,500')).toBeOnTheScreen();
    expect(screen.getByText('I have this')).toBeOnTheScreen();
    await press('I want this');
    await waitFor(() => expect(want).toHaveLength(1));
    expect(mockRouter.push).toHaveBeenCalledWith('/chat/t9');
    expect(await screen.findByText(/Open chat/)).toBeOnTheScreen();
  });

  it('says no to a reply, and closes the request', async () => {
    mockParams = { id: 'r1' };
    const calls: string[] = [];
    fakeApi({
      'GET /v1/buyer/requests/r1': () => json(buyerRequest()),
      'POST /v1/buyer/responses/resp1/decline': () => (calls.push('decline'), json(buyerRequest())),
      'POST /v1/buyer/requests/r1/close': () => (calls.push('close'), json(buyerRequest({ status: 'CLOSED' }))),
    }, fetchMock);
    await renderWith(signedIn(), <RequestScreen />);
    await screen.findByText('I have this');
    await press('Not for me');
    await press('Close request');
    await waitFor(() => expect(calls).toEqual(['decline', 'close']));
  });
});

describe('contact for orders and the agreement', () => {
  it('shows the saved numbers and saves a change', async () => {
    const saved: unknown[] = [];
    fakeApi({ 'GET /v1/buyer/profile': () => json(profile()), 'PATCH /v1/buyer/profile/contact': ({ body }) => (saved.push(body), json(profile())) }, fetchMock);
    await renderWith(signedIn(), <ContactScreen />);
    await screen.findByLabelText('Phone');
    await type('WhatsApp', '9123456789');
    await press('Save');
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toEqual({ contact: { phone: '9876543210', whatsapp: '9123456789' } });
    expect(await screen.findByText('Saved.')).toBeOnTheScreen();
  });

  it('shows the server’s message when the numbers are refused', async () => {
    fakeApi({ 'GET /v1/buyer/profile': () => json(profile()), 'PATCH /v1/buyer/profile/contact': () => problem(400, 'VALIDATION', { phone: 'Enter a 10-digit mobile number.' }, 'Check the highlighted fields.') }, fetchMock);
    await renderWith(signedIn(), <ContactScreen />);
    await screen.findByLabelText('Phone');
    await press('Save');
    expect(await screen.findByText('Enter a 10-digit mobile number.')).toBeOnTheScreen();
  });

  it('shows the agreement as a draft', async () => {
    fakeApi({}, fetchMock);
    await renderWith(signedIn(), <AgreementScreen />);
    expect(screen.getAllByText(/draft/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/has not been reviewed by a lawyer/)).toBeOnTheScreen();
  });
});

describe('picking photos', () => {
  beforeEach(() => [mockPick, mockInfo].forEach((m) => m.mockReset()));
  it('declares the size of the file it will upload, not the size the picker reports for the original', async () => {
    // quality < 1 makes the picker write a re-encoded copy: the asset still says 1000 bytes, the copy on disk is 640.
    mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///cache/ImagePicker/x.jpg', type: 'image', mimeType: 'image/png', fileSize: 1000, fileName: 'orig.png' }] });
    mockInfo.mockResolvedValueOnce({ exists: true, size: 640 });
    const [file] = await pickFiles({ video: false, max: 1 });
    expect(file).toMatchObject({ size: 640, mime: 'image/jpeg' });
    expect(mockInfo).toHaveBeenCalledWith('file:///cache/ImagePicker/x.jpg');
  });
  it('falls back to the picker size if the file cannot be measured', async () => {
    mockPick.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///p.jpg', type: 'image', mimeType: 'image/jpeg', fileSize: 1000 }] });
    mockInfo.mockResolvedValueOnce({ exists: false });
    expect((await pickFiles({ video: false, max: 1 }))[0]?.size).toBe(1000);
  });
});
