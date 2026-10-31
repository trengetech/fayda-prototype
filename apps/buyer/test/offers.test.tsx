import { act, fireEvent, screen } from '@testing-library/react-native';
import MyOffersScreen from '../app/offers';
import NegotiationScreen from '../app/negotiation/[id]';
import ListingScreen from '../app/listing/[id]';
import { buyerListing, buyerNegotiation, fakeApi, json, managerWith, problem, renderWith, sellerCountered } from './utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({}), VideoView: () => null }));

const LID = '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70';
let fetchMock: jest.Mock;
const signedIn = () => managerWith('buyer', fetchMock, { missing: [] });
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));
const type = (label: string, text: string) => act(async () => void fireEvent.changeText(screen.getAllByLabelText(label).at(-1) as never, text));
beforeEach(() => {
  fetchMock = jest.fn();
  mockRouter.push.mockClear();
  mockParams = { id: 'n1' };
});

describe('making an offer from the product page', () => {
  const open = async (routes: Parameters<typeof fakeApi>[0] = {}) => {
    mockParams = { id: LID };
    fakeApi({ [`GET /v1/buyer/listings/${LID}`]: () => json(buyerListing({ variants: [{ id: 'v1', label: 'M', available: true, low: false }, { id: 'v2', label: 'L', available: true, low: false }, { id: 'v3', label: 'S', available: false, low: false }] })), ...routes }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByText('Cotton kurta');
    await press('Make offer');
  };

  it('needs a size and an amount, offers only sizes in stock, and says how long the seller has', async () => {
    await open();
    expect(screen.getByLabelText('M')).toBeOnTheScreen();
    expect(screen.getByLabelText('L')).toBeOnTheScreen();
    expect(screen.queryByLabelText('S')).not.toBeOnTheScreen(); // sold out
    expect(screen.getByText(/expire after 24 hours/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();
    await act(async () => void fireEvent.press(screen.getByLabelText('M')));
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeDisabled();
    await type('Your offer', '1,000');
    expect(screen.getByRole('button', { name: 'Send offer' })).toBeEnabled();
  });

  it('sends the offer in paise with an idempotency key, then opens the negotiation', async () => {
    const sent: { body: unknown; headers: Record<string, string> }[] = [];
    await open({ [`POST /v1/buyer/listings/${LID}/offers`]: ({ body, headers }) => (sent.push({ body, headers }), json(buyerNegotiation(), 201)) });
    await act(async () => void fireEvent.press(screen.getByLabelText('L')));
    await type('Your offer', '1000');
    await press('Send offer');
    await screen.findByText('Make an offer').catch(() => null);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({ variantId: 'v2', amount: 100000 });
    expect(sent[0]?.headers['idempotency-key']).toMatch(/.{8,}/);
    expect(mockRouter.push).toHaveBeenCalledWith('/negotiation/n1');
  });

  it('turns a percent off into rupees, and shows it before sending', async () => {
    const sent: unknown[] = [];
    await open({ [`POST /v1/buyer/listings/${LID}/offers`]: ({ body }) => (sent.push(body), json(buyerNegotiation(), 201)) });
    await act(async () => void fireEvent.press(screen.getByLabelText('M')));
    await act(async () => void fireEvent.press(screen.getByLabelText('Discount (%)')));
    await act(async () => void fireEvent.press(screen.getByLabelText('20% off')));
    expect(screen.getByText('Your offer: ₹1,200')).toBeOnTheScreen();
    await press('Send offer');
    expect(sent).toEqual([{ variantId: 'v1', amount: 120000 }]);
  });

  it('shows the server’s refusal and keeps the same key when the same offer is retried', async () => {
    const keys: string[] = [];
    await open({ [`POST /v1/buyer/listings/${LID}/offers`]: ({ headers }) => (keys.push(headers['idempotency-key'] as string), problem(422, 'BELOW_PLATFORM_FLOOR', undefined, 'Offers must be at least ₹150 (10% of the listed price).')) });
    await act(async () => void fireEvent.press(screen.getByLabelText('M')));
    await type('Your offer', '100');
    await press('Send offer');
    expect(await screen.findByText('Offers must be at least ₹150 (10% of the listed price).')).toBeOnTheScreen();
    await press('Send offer');
    await screen.findByText('Offers must be at least ₹150 (10% of the listed price).');
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(mockRouter.push).not.toHaveBeenCalled();
    await type('Your offer', '200'); // a different offer is a different attempt
    await press('Send offer');
    await screen.findByText('Offers must be at least ₹150 (10% of the listed price).');
    expect(keys[2]).not.toBe(keys[0]);
  });
});

describe('my offers', () => {
  it('lists offers with the ones the seller answered first, and opens one', async () => {
    const answered = sellerCountered({ id: 'n2', listing: { ...buyerNegotiation().listing, title: 'Silk saree' }, updatedAt: 1 });
    const waiting = buyerNegotiation({ id: 'n1', updatedAt: 5 });
    fakeApi({ 'GET /v1/buyer/negotiations': () => json({ items: [waiting, answered] }) }, fetchMock);
    await renderWith(signedIn(), <MyOffersScreen />);
    expect(await screen.findByText('Seller replied')).toBeOnTheScreen();
    const titles = screen.getAllByText(/Cotton kurta|Silk saree/).map((t) => t.props.children);
    expect(titles).toEqual(['Silk saree', 'Cotton kurta']);
    expect(screen.getByText('Waiting for seller')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Open your offer on Silk saree')));
    expect(mockRouter.push).toHaveBeenCalledWith('/negotiation/n2');
  });

  it('says so when there are none, and recovers from an error', async () => {
    let fail = true;
    fakeApi({ 'GET /v1/buyer/negotiations': () => (fail ? problem(500, 'INTERNAL', undefined, 'Server fell over') : json({ items: [] })) }, fetchMock);
    await renderWith(signedIn(), <MyOffersScreen />);
    expect(await screen.findByText('Can’t load your offers')).toBeOnTheScreen();
    fail = false;
    await press('Try again');
    expect(await screen.findByText('No offers yet')).toBeOnTheScreen();
  });
});

describe('negotiation screen', () => {
  it('shows a waiting offer with a Withdraw button, and nothing else to do', async () => {
    const posts: string[] = [];
    let state = buyerNegotiation();
    fakeApi(
      {
        'GET /v1/buyer/negotiations/n1': () => json(state),
        'POST /v1/buyer/negotiations/n1/withdraw': () => (posts.push('withdraw'), (state = buyerNegotiation({ status: 'CLOSED', statusLabel: 'Offer withdrawn', closeReason: 'WITHDRAWN', closeText: 'Offer withdrawn', canWithdraw: false, pendingExpiresAt: null })), json(state)),
      },
      fetchMock,
    );
    await renderWith(signedIn(), <NegotiationScreen />);
    expect(await screen.findByText('You offered ₹1,000')).toBeOnTheScreen();
    expect(screen.queryByText('Accept ₹1,400')).not.toBeOnTheScreen();
    await press('Withdraw my offer');
    expect((await screen.findAllByText('Offer withdrawn')).length).toBeGreaterThan(0);
    expect(posts).toEqual(['withdraw']);
    expect(screen.queryByText('Withdraw my offer')).not.toBeOnTheScreen();
  });

  it('shows the seller’s counter as the seller’s, with accept, counter and decline', async () => {
    fakeApi({ 'GET /v1/buyer/negotiations/n1': () => json(sellerCountered()) }, fetchMock);
    await renderWith(signedIn(), <NegotiationScreen />);
    expect(await screen.findByText('Seller countered ₹1,400')).toBeOnTheScreen();
    expect(screen.getByText('Accept ₹1,400')).toBeOnTheScreen();
    expect(screen.getByText(/Between ₹1,001 and ₹1,399/)).toBeOnTheScreen();
    expect(screen.getByText('Decline')).toBeOnTheScreen();
    expect(screen.queryByText('Withdraw my offer')).not.toBeOnTheScreen();
    // nothing says a rule produced it
    expect(screen.queryByText(/auto/i)).not.toBeOnTheScreen();
  });

  it('accepts the counter and then shows the agreement with the held unit and the website code', async () => {
    let state = sellerCountered({ channel: 'WEBSITE' });
    fakeApi(
      {
        'GET /v1/buyer/negotiations/n1': () => json(state),
        'POST /v1/buyer/negotiations/n1/accept': () => (state = buyerNegotiation({ status: 'AGREED', statusLabel: 'Agreed', canWithdraw: false, pendingExpiresAt: null, channel: 'WEBSITE', agreement: { price: 140000, deadline: Date.now() + 43_200_000, dealAccess: { type: 'CODE', value: 'KURTA14' } } })) && json(state),
      },
      fetchMock,
    );
    await renderWith(signedIn(), <NegotiationScreen />);
    await screen.findByText('Accept ₹1,400');
    await press('Accept ₹1,400');
    expect(await screen.findByText('Agreed at ₹1,400')).toBeOnTheScreen();
    expect(screen.getByText(/held for you for 12 h/)).toBeOnTheScreen();
    expect(screen.getByText('Your coupon code: KURTA14')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'I’ve used the code. Record my order' })).toBeOnTheScreen();
  });

  it('counters in paise, and shows the server’s message when the counter is refused', async () => {
    const posts: unknown[] = [];
    fakeApi(
      {
        'GET /v1/buyer/negotiations/n1': () => json(sellerCountered()),
        'POST /v1/buyer/negotiations/n1/counter': ({ body }) => (posts.push(body), problem(422, 'MUST_INCREASE', undefined, 'Your counter must be higher than your last offer (₹1,000).')),
      },
      fetchMock,
    );
    await renderWith(signedIn(), <NegotiationScreen />);
    await screen.findByText('Accept ₹1,400');
    await type('Counter with', '900');
    await press('Send counter');
    expect(await screen.findByText('Your counter must be higher than your last offer (₹1,000).')).toBeOnTheScreen();
    expect(posts).toEqual([{ amount: 90000 }]);
  });

  it('on the last offer only accept or decline remain', async () => {
    fakeApi({ 'GET /v1/buyer/negotiations/n1': () => json(sellerCountered({ canCounter: false, counterBounds: null, offersLeft: 0 })) }, fetchMock);
    await renderWith(signedIn(), <NegotiationScreen />);
    expect(await screen.findByText(/This is the last offer/)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Counter with')).not.toBeOnTheScreen();
  });

  it('shows why a closed offer closed, with no actions', async () => {
    fakeApi({ 'GET /v1/buyer/negotiations/n1': () => json(buyerNegotiation({ status: 'CLOSED', statusLabel: 'This size sold out', closeReason: 'SOLD_OUT', closeText: 'This size sold out', canWithdraw: false, pendingExpiresAt: null })) }, fetchMock);
    await renderWith(signedIn(), <NegotiationScreen />);
    expect((await screen.findAllByText('This size sold out')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Withdraw my offer')).not.toBeOnTheScreen();
    expect(screen.queryByText('Decline')).not.toBeOnTheScreen();
  });
});
