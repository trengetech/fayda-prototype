import { act, fireEvent, screen } from '@testing-library/react-native';
import OffersScreen from '../app/(tabs)/offers';
import OfferScreen from '../app/offer/[id]';
import { fakeApi, json, managerWith, problem, renderWith, sellerNegotiation } from './utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));

let fetchMock: jest.Mock;
const signedIn = () => managerWith('seller', fetchMock, { missing: [] });
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));
const type = (label: string, text: string) => act(async () => void fireEvent.changeText(screen.getAllByLabelText(label).at(-1) as never, text));
beforeEach(() => {
  fetchMock = jest.fn();
  mockRouter.push.mockClear();
  mockParams = { id: 'n1' };
});

const waiting = sellerNegotiation();
const agreed = sellerNegotiation({ id: 'n2', status: 'AGREED', needsReply: false, canCounter: false, counterBounds: null, pendingExpiresAt: null, buyerName: 'Ravi', agreement: { price: 120000, deadline: Date.now() + 7_200_000, acceptedBy: 'SYSTEM', dealAccess: null } });
const closed = sellerNegotiation({ id: 'n3', status: 'CLOSED', closeReason: 'EXPIRED', needsReply: false, canCounter: false, counterBounds: null, pendingExpiresAt: null, buyerName: 'Meera' });

describe('offer inbox', () => {
  it('shows what needs a reply first, and the other groups under their filters', async () => {
    fakeApi({ 'GET /v1/seller/negotiations': () => json({ items: [waiting, agreed, closed], needsReply: 1 }) }, fetchMock);
    await renderWith(signedIn(), <OffersScreen />);
    expect(await screen.findByText('Needs your reply')).toBeOnTheScreen();
    expect(screen.getByText('Cotton kurta')).toBeOnTheScreen();
    expect(screen.getByText('Size M · Asha Buyer')).toBeOnTheScreen();
    expect(screen.getByText(/₹1,000/)).toBeOnTheScreen();
    expect(screen.queryByText('Ravi', { exact: false })).not.toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Agreed')));
    expect(screen.getByText('Size M · Ravi')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Closed')));
    expect(screen.getByText('Offer expired')).toBeOnTheScreen();
  });

  it('opens an offer, and says so when nothing needs a reply', async () => {
    fakeApi({ 'GET /v1/seller/negotiations': () => json({ items: [waiting], needsReply: 1 }) }, fetchMock);
    await renderWith(signedIn(), <OffersScreen />);
    await act(async () => void fireEvent.press(await screen.findByLabelText('Open offer on Cotton kurta from Asha Buyer')));
    expect(mockRouter.push).toHaveBeenCalledWith('/offer/n1');
    await act(async () => void fireEvent.press(screen.getByLabelText('Waiting')));
    expect(screen.getByText('No waiting offers')).toBeOnTheScreen();
  });

  it('shows the error with Try again', async () => {
    let fail = true;
    fakeApi({ 'GET /v1/seller/negotiations': () => (fail ? problem(500, 'INTERNAL', undefined, 'Server fell over') : json({ items: [waiting], needsReply: 1 })) }, fetchMock);
    await renderWith(signedIn(), <OffersScreen />);
    expect(await screen.findByText('Can’t load your offers')).toBeOnTheScreen();
    fail = false;
    await press('Try again');
    expect(await screen.findByText('Cotton kurta')).toBeOnTheScreen();
  });
});

const pressAccept = () => act(async () => void fireEvent.press(screen.getByText(/^Accept ₹/)));

describe('offer screen', () => {
  it('shows the timeline, marks replies sent by the seller’s own rules, and the counter range', async () => {
    const n = sellerNegotiation({
      offers: [
        { id: 'o1', by: 'BUYER', amount: 100000, status: 'COUNTERED', at: 1, expiresAt: 9, dealAccess: null },
        { id: 'o2', by: 'SYSTEM', amount: 135000, status: 'COUNTERED', at: 2, expiresAt: 9, dealAccess: null },
        { id: 'o3', by: 'BUYER', amount: 110000, status: 'PENDING', at: 3, expiresAt: 9, dealAccess: null },
      ],
      counterBounds: { minExclusive: 110000, maxExclusive: 135000 },
    });
    fakeApi({ 'GET /v1/seller/negotiations/n1': () => json(n) }, fetchMock);
    await renderWith(signedIn(), <OfferScreen />);
    expect(await screen.findByText('Buyer’s offer')).toBeOnTheScreen();
    expect(screen.getByText('Automatic counter')).toBeOnTheScreen(); // the seller sees which reply their own rule sent
    expect(screen.getByText('Buyer’s counter')).toBeOnTheScreen();
    expect(screen.getByText(/Asha Buyer offered ₹1,100/)).toBeOnTheScreen();
    await press('Counter');
    expect(screen.getByText(/must be above ₹1,100 and below ₹1,350/)).toBeOnTheScreen();
  });

  it('accepts, and refreshes from the server’s answer', async () => {
    let state = waiting;
    const posts: unknown[] = [];
    fakeApi(
      {
        'GET /v1/seller/negotiations/n1': () => json(state),
        'POST /v1/seller/negotiations/n1/accept': ({ body }) => (posts.push(body), (state = { ...waiting, status: 'AGREED', needsReply: false, canCounter: false, counterBounds: null, agreement: { price: 100000, deadline: Date.now() + 7_200_000, acceptedBy: 'SELLER', dealAccess: null } }), json(state)),
      },
      fetchMock,
    );
    await renderWith(signedIn(), <OfferScreen />);
    await screen.findByText(/offered ₹/);
    await pressAccept();
    expect(await screen.findByText('Agreed at ₹1,000')).toBeOnTheScreen();
    expect(posts).toEqual([{ dealAccess: null }]);
    expect(screen.queryByText(/^Accept ₹/)).not.toBeOnTheScreen();
  });

  it('sends a counter in paise, and shows the server’s message when it is refused', async () => {
    const posts: Record<string, unknown>[] = [];
    fakeApi(
      {
        'GET /v1/seller/negotiations/n1': () => json(waiting),
        'POST /v1/seller/negotiations/n1/counter': ({ body }) => (posts.push(body as Record<string, unknown>), problem(422, 'MUST_DECREASE', undefined, 'Your counter must be lower than your last counter (₹1,300).')),
      },
      fetchMock,
    );
    await renderWith(signedIn(), <OfferScreen />);
    await screen.findByText(/offered ₹/);
    await press('Counter');
    await type('Counter with', '1,400');
    await press('Send counter');
    expect(await screen.findByText('Your counter must be lower than your last counter (₹1,300).')).toBeOnTheScreen();
    expect(posts).toEqual([{ amount: 140000, dealAccess: null }]);
  });

  it('asks before declining, and declines only when confirmed', async () => {
    const declines: number[] = [];
    let state = waiting;
    fakeApi(
      {
        'GET /v1/seller/negotiations/n1': () => json(state),
        'POST /v1/seller/negotiations/n1/decline': () => (declines.push(1), (state = { ...waiting, status: 'CLOSED', closeReason: 'DECLINED', needsReply: false, canCounter: false }), json(state)),
      },
      fetchMock,
    );
    await renderWith(signedIn(), <OfferScreen />);
    await screen.findByText(/offered ₹/);
    await press('Decline offer');
    expect(declines).toHaveLength(0);
    await press('Keep it');
    expect(screen.queryByText('Decline this offer?')).not.toBeOnTheScreen();
    await press('Decline offer');
    await press('Yes, decline');
    expect((await screen.findAllByText('Offer declined')).length).toBeGreaterThan(0);
    expect(declines).toHaveLength(1);
  });

  it('on a website listing, asks for the code or link and sends it with the accept', async () => {
    const web = sellerNegotiation({ listing: { ...waiting.listing, channel: 'WEBSITE' } });
    const done = { ...web, status: 'AGREED', needsReply: false, canCounter: false, counterBounds: null, agreement: { price: 100000, deadline: Date.now() + 1000, acceptedBy: 'SELLER', dealAccess: { type: 'CODE', value: 'KURTA10' } } };
    const posts: Record<string, unknown>[] = [];
    fakeApi(
      {
        'GET /v1/seller/negotiations/n1': () => json(posts.length > 1 ? done : web),
        'POST /v1/seller/negotiations/n1/accept': ({ body }) => {
          posts.push(body as Record<string, unknown>);
          return posts.length === 1 ? problem(400, 'DEAL_ACCESS_REQUIRED', { dealAccess: 'Add the coupon code or discount link.' }, 'Add the code.') : json(done);
        },
      },
      fetchMock,
    );
    await renderWith(signedIn(), <OfferScreen />);
    await screen.findByText('How does the buyer get the price?');
    await pressAccept();
    expect(await screen.findByText('Add the coupon code or discount link.')).toBeOnTheScreen();
    await type('Coupon code', ' KURTA10 ');
    await pressAccept();
    expect(await screen.findByText('Sent to the buyer: code KURTA10')).toBeOnTheScreen();
    expect(posts[1]).toEqual({ dealAccess: { type: 'CODE', value: 'KURTA10' } });
  });

  it('offers only accept or decline once the offer limit is reached', async () => {
    fakeApi({ 'GET /v1/seller/negotiations/n1': () => json(sellerNegotiation({ canCounter: false, counterBounds: null })) }, fetchMock);
    await renderWith(signedIn(), <OfferScreen />);
    expect(await screen.findByText(/reached its offer limit/)).toBeOnTheScreen();
    expect(screen.queryByLabelText('Counter with')).not.toBeOnTheScreen();
  });

  it('shows no reply controls for a closed negotiation', async () => {
    fakeApi({ 'GET /v1/seller/negotiations/n3': () => json(closed) }, fetchMock);
    mockParams = { id: 'n3' };
    await renderWith(signedIn(), <OfferScreen />);
    expect((await screen.findAllByText('Offer expired')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Your reply')).not.toBeOnTheScreen();
  });
});
