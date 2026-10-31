import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import AddressesScreen from '../app/addresses';
import CheckoutScreen from '../app/checkout';
import { buyerListing, buyerOrder, fakeApi, json, managerWith, problem, renderWith, type Route } from './utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));

const LID = '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70';
let fetchMock: jest.Mock;
const signedIn = () => managerWith('buyer', fetchMock, { missing: [] });
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));
const pressLabel = (label: string) => act(async () => void fireEvent.press(screen.getByLabelText(label)));
const pressAt = (label: string, i: number) => act(async () => void fireEvent.press(screen.getAllByText(label)[i] as never));
const type = (label: string, text: string) => act(async () => void fireEvent.changeText(screen.getAllByLabelText(label).at(-1) as never, text));

const a1 = { id: 'a1', name: 'Asha', line1: '12 Road', line2: 'Madhapur', pin: '500081', city: 'Hyderabad', state: 'Telangana' };
const a2 = { id: 'a2', name: 'Asha Office', line1: '4 Tower', line2: 'Hitech City', pin: '500081', city: 'Hyderabad', state: 'Telangana' };
const profile = (addresses = [a1], defaultAddressId: string | null = 'a1') => ({
  name: 'Asha', addresses, defaultAddressId, contact: { phone: '9876543210', whatsapp: null }, agreementVersion: 'draft-2026-10', agreementAcceptedAt: 1, missing: [],
});
const fillNew = async () => {
  await type('Name on the delivery', 'Asha Office');
  await type('Flat, house or building', '4 Tower');
  await type('Area or street', 'Hitech City');
  await type('PIN code', '500081');
};

beforeEach(() => {
  fetchMock = jest.fn();
  [mockRouter.push, mockRouter.replace, mockRouter.back].forEach((m) => m.mockReset());
  mockParams = {};
});

describe('delivery addresses screen', () => {
  it('lists the addresses with the default marked, and offers no Delete for the only one', async () => {
    fakeApi({ 'GET /v1/buyer/profile': () => json(profile()) }, fetchMock);
    await renderWith(signedIn(), <AddressesScreen />);
    expect(await screen.findByText('12 Road, Madhapur')).toBeOnTheScreen();
    expect(screen.getByText('Default')).toBeOnTheScreen();
    expect(screen.queryByText('Delete')).not.toBeOnTheScreen();
    expect(screen.queryByText('Make default')).not.toBeOnTheScreen();
  });

  it('shows an error with Try again that recovers', async () => {
    let fail = true;
    fakeApi({ 'GET /v1/buyer/profile': () => (fail ? problem(500, 'INTERNAL', undefined, 'Server trouble.') : json(profile())) }, fetchMock);
    await renderWith(signedIn(), <AddressesScreen />);
    expect(await screen.findByText('Can’t load your addresses')).toBeOnTheScreen();
    fail = false;
    await press('Try again');
    expect(await screen.findByText('12 Road, Madhapur')).toBeOnTheScreen();
  });

  it('checks the address before sending it, naming the fields', async () => {
    const post = jest.fn();
    fakeApi({ 'GET /v1/buyer/profile': () => json(profile()), 'POST /v1/buyer/addresses': () => (post(), json(profile([a1, a2]), 201)) }, fetchMock);
    await renderWith(signedIn(), <AddressesScreen />);
    await screen.findByText('12 Road, Madhapur');
    await press('Add an address');
    await type('PIN code', '12');
    await type('Name on the delivery', 'A');
    await press('Save address');
    expect(await screen.findByText('Enter a 6-digit PIN code.')).toBeOnTheScreen();
    expect(screen.getByText('Enter the recipient’s name.')).toBeOnTheScreen();
    expect(post).not.toHaveBeenCalled();
  });

  it('adds an address and shows it in the list; "make default" is sent only when ticked', async () => {
    let body: unknown;
    let saved = false;
    fakeApi(
      {
        'GET /v1/buyer/profile': () => json(saved ? profile([a1, a2]) : profile()),
        'POST /v1/buyer/addresses': ({ body: b }) => ((body = b), (saved = true), json(profile([a1, a2]), 201)),
      },
      fetchMock,
    );
    await renderWith(signedIn(), <AddressesScreen />);
    await screen.findByText('12 Road, Madhapur');
    await press('Add an address');
    await fillNew();
    await press('Save address');
    expect(await screen.findByText('4 Tower, Hitech City')).toBeOnTheScreen();
    expect(body).toMatchObject({ name: 'Asha Office', pin: '500081', makeDefault: false });
  });

  it('edits an address', async () => {
    let body: unknown;
    let current = profile();
    fakeApi({ 'GET /v1/buyer/profile': () => json(current), 'PUT /v1/buyer/addresses/a1': ({ body: b }) => ((body = b), (current = profile([{ ...a1, line1: '99 New Road' }])), json(current)) }, fetchMock);
    await renderWith(signedIn(), <AddressesScreen />);
    await screen.findByText('12 Road, Madhapur');
    await press('Edit');
    await type('Flat, house or building', '99 New Road');
    await press('Save changes');
    expect(await screen.findByText('99 New Road, Madhapur')).toBeOnTheScreen();
    expect(body).toMatchObject({ line1: '99 New Road', pin: '500081' });
    expect(body).not.toHaveProperty('id');
  });

  it('asks before deleting, and Keep it deletes nothing', async () => {
    const del = jest.fn();
    let current = profile([a1, a2]);
    fakeApi({ 'GET /v1/buyer/profile': () => json(current), 'DELETE /v1/buyer/addresses/a2': () => (del(), (current = profile([a1])), json(current)) }, fetchMock);
    await renderWith(signedIn(), <AddressesScreen />);
    await screen.findByText('4 Tower, Hitech City');
    await pressAt('Delete', 1);
    expect(screen.getByText('Delete this address?')).toBeOnTheScreen();
    await press('Keep it');
    expect(del).not.toHaveBeenCalled();
    await pressAt('Delete', 1);
    await press('Yes, delete it');
    await waitFor(() => expect(screen.queryByText('4 Tower, Hitech City')).not.toBeOnTheScreen());
    expect(del).toHaveBeenCalledTimes(1);
  });

  it('makes another address the default', async () => {
    const post = jest.fn();
    let current = profile([a1, a2]);
    fakeApi({ 'GET /v1/buyer/profile': () => json(current), 'POST /v1/buyer/addresses/a2/default': () => (post(), (current = profile([a1, a2], 'a2')), json(current)) }, fetchMock);
    await renderWith(signedIn(), <AddressesScreen />);
    await screen.findByText('4 Tower, Hitech City');
    await press('Make default');
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Make default')).toBeOnTheScreen()); // now the other card offers it
  });

  it('shows the server’s message when it refuses (for example, the last address or the limit)', async () => {
    fakeApi({ 'GET /v1/buyer/profile': () => json(profile()), 'POST /v1/buyer/addresses': () => problem(400, 'VALIDATION', undefined, 'You can save up to 10 addresses. Delete one first.') }, fetchMock);
    await renderWith(signedIn(), <AddressesScreen />);
    await screen.findByText('12 Road, Madhapur');
    await press('Add an address');
    await fillNew();
    await press('Save address');
    expect(await screen.findByText('You can save up to 10 addresses. Delete one first.')).toBeOnTheScreen();
  });

  it('opened from checkout with no address, goes straight to the form, saves it as the default and goes back', async () => {
    mockParams = { pick: '1', add: '1' };
    let body: unknown;
    fakeApi({ 'GET /v1/buyer/profile': () => json(profile([], null)), 'POST /v1/buyer/addresses': ({ body: b }) => ((body = b), json(profile([a2], 'a2'), 201)) }, fetchMock);
    await renderWith(signedIn(), <AddressesScreen />);
    expect(await screen.findByText('Add your delivery address')).toBeOnTheScreen();
    await fillNew();
    await press('Save address');
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
    expect(body).toMatchObject({ makeDefault: true });
  });
});

describe('checkout and addresses', () => {
  const routes = (extra: Record<string, Route> = {}) => ({
    [`GET /v1/buyer/listings/${LID}`]: () => json(buyerListing({ variants: [{ id: 'v1', label: 'M', available: true, low: false }, { id: 'v2', label: 'L', available: true, low: false }] })),
    ...extra,
  });

  it('with no address, offers "Add address" that opens the form for checkout', async () => {
    mockParams = { listingId: LID };
    fakeApi(routes({ 'GET /v1/buyer/profile': () => json(profile([], null)) }), fetchMock);
    await renderWith(signedIn(), <CheckoutScreen />);
    await screen.findByText('No delivery address');
    await press('Add address');
    expect(mockRouter.push).toHaveBeenCalledWith('/addresses?pick=1&add=1');
    expect(screen.getByRole('button', { name: 'Place order · ₹1,500' })).toBeDisabled();
  });

  it('with addresses, has "Add or change address"', async () => {
    mockParams = { listingId: LID };
    fakeApi(routes({ 'GET /v1/buyer/profile': () => json(profile()) }), fetchMock);
    await renderWith(signedIn(), <CheckoutScreen />);
    await screen.findByText('Checkout');
    await press('Add or change address');
    expect(mockRouter.push).toHaveBeenCalledWith('/addresses?pick=1');
  });

  it('selects the address that was just added and orders to it', async () => {
    // Both screens share one cache, as they do in the app's stack: adding an address on one updates the other.
    mockParams = { listingId: LID, pick: '1', add: '1' };
    let order: unknown;
    let added = false;
    fakeApi(
      routes({
        // The server keeps naming a1 as the default, so only the "new address is selected" rule can pick a2.
        'GET /v1/buyer/profile': () => json(profile(added ? [a1, a2] : [a1], 'a1')),
        'POST /v1/buyer/addresses': () => ((added = true), json(profile([a1, a2], 'a1'), 201)),
        'POST /v1/buyer/orders': ({ body }) => ((order = body), json(buyerOrder(), 201)),
      }),
      fetchMock,
    );
    await renderWith(signedIn(), <><CheckoutScreen /><AddressesScreen /></>);
    await screen.findByText('Checkout');
    await pressLabel('L');
    await pressLabel('UPI');
    await fillNew();
    await press('Save address');
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    await press('Place order · ₹1,500');
    await waitFor(() => expect(order).toBeDefined());
    expect(order).toMatchObject({ addressId: 'a2', listingId: LID, paymentMethod: 'UPI' });
  });
});
