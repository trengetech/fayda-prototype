import { act, fireEvent, screen } from '@testing-library/react-native';
import { Linking, View as MockView } from 'react-native';
import ListingScreen from '../app/listing/[id]';
import { buyerListing, fakeApi, json, managerWith, problem, renderWith } from './utils';

const mockPlayer = jest.fn();
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = { id: '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70' };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams }));
jest.mock('expo-video', () => {
  return {
    useVideoPlayer: (uri: string, setup?: (p: { play: () => void }) => void) => {
      mockPlayer(uri);
      setup?.({ play: () => {} });
      return {};
    },
    VideoView: (props: object) => <MockView {...props} />,
  };
});

let fetchMock: jest.Mock;
const signedIn = () => managerWith('buyer', fetchMock, { missing: [] });
const ID = '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70';
const serve = (l: object) => fakeApi({ [`GET /v1/buyer/listings/${ID}`]: () => json(l) }, fetchMock);
beforeEach(() => {
  fetchMock = jest.fn();
  mockPlayer.mockClear();
  mockRouter.push.mockClear();
  mockParams = { id: '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70' };
});

describe('buyer product page', () => {
  it('counts one view when the page opens, and a failing count never breaks the page', async () => {
    fakeApi({ [`GET /v1/buyer/listings/${ID}`]: () => json(buyerListing()), [`POST /v1/buyer/listings/${ID}/view`]: () => problem(500, 'INTERNAL') }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByText('Cotton kurta')).toBeOnTheScreen();
    const views = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/view'));
    expect(views).toHaveLength(1);
    expect(views[0]![1]?.method).toBe('POST');
  });

  it('shows a loading state, then the error with Try again', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByText('Loading…')).toBeOnTheScreen();
  });

  it('the seller’s name opens their shop page', async () => {
    serve(buyerListing());
    await renderWith(signedIn(), <ListingScreen />);
    await act(async () => void fireEvent.press(await screen.findByLabelText('Open shop Kiran Studio')));
    expect(mockRouter.push).toHaveBeenCalledWith('/shop/kiranstudio');
  });

  it('opens the offer sheet straight away when it is reached from a reel’s Make offer, and not otherwise', async () => {
    serve(buyerListing());
    mockParams = { id: ID, offer: '1' };
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByText('Cotton kurta');
    expect(screen.getByLabelText('Your offer')).toBeOnTheScreen();
  });

  it('shows no tag line for a listing without tags', async () => {
    serve(buyerListing({ tags: [] }));
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByText('Cotton kurta');
    expect(screen.queryByText(/^#/)).not.toBeOnTheScreen();
  });

  it('shows the error, and Try again recovers', async () => {
    let fail = true;
    fakeApi({ [`GET /v1/buyer/listings/${ID}`]: () => (fail ? problem(404, 'NOT_FOUND', undefined, 'This listing is gone') : json(buyerListing())) }, fetchMock);
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByText('Can’t open this listing')).toBeOnTheScreen();
    expect(screen.getByText('This listing is gone')).toBeOnTheScreen();
    fail = false;
    await act(async () => void fireEvent.press(screen.getByText('Try again')));
    expect(await screen.findByText('Cotton kurta')).toBeOnTheScreen();
  });

  it('shows title, price, seller, description, bargaining label and the photo', async () => {
    serve(buyerListing());
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByText('Cotton kurta')).toBeOnTheScreen();
    expect(screen.getByText('₹1,500')).toBeOnTheScreen();
    expect(screen.getByText('Kiran Studio ›')).toBeOnTheScreen();
    expect(screen.getByText('#cotton  #summerwear')).toBeOnTheScreen();
    expect(screen.getByText('Madhapur, Hyderabad · ★ 4.5 (12)')).toBeOnTheScreen();
    expect(screen.getByText(/Confirms payment within 4 hours · ships within 2 days/)).toBeOnTheScreen();
    expect(screen.getByText('Block print, soft cotton.')).toBeOnTheScreen();
    expect(screen.getByText('Open to offers')).toBeOnTheScreen();
    expect(screen.getByLabelText('Photo 1 of 1: Cotton kurta').props.source).toEqual({ uri: 'http://api.test/v1/media/m1' });
  });

  it('labels a fixed-price listing as fixed price', async () => {
    serve(buyerListing({ bargaining: { mode: 'BUY_NOW', acceptsOffers: false, expiryMinutes: 1440 } }));
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByText('Fixed price')).toBeOnTheScreen();
    expect(screen.queryByText('Open to offers')).not.toBeOnTheScreen();
  });

  it('shows sold-out and low-stock sizes, and never a stock number', async () => {
    serve(buyerListing({ variants: [{ id: 'v1', label: 'S', available: false, low: false }, { id: 'v2', label: 'M', available: true, low: true }, { id: 'v3', label: 'L', available: true, low: false }] }));
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByText('Sizes');
    expect(screen.getByText('Sold out')).toBeOnTheScreen();
    expect(screen.getByText('Few left')).toBeOnTheScreen();
    expect(screen.getAllByText(/^[SML]$/)).toHaveLength(3);
  });

  it('shows Sold out instead of a bargaining label when every size is gone', async () => {
    serve(buyerListing({ soldOut: true, variants: [{ id: 'v1', label: 'M', available: false, low: false }] }));
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByText('Sizes');
    expect(screen.getAllByText('Sold out')).toHaveLength(2); // the badge and the size
    expect(screen.queryByText('Open to offers')).not.toBeOnTheScreen();
  });

  it('Buy opens checkout for a direct listing, and Make offer stays available on a listing that takes offers', async () => {
    serve(buyerListing());
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByText('Cotton kurta');
    expect(screen.getByRole('button', { name: 'Buy' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Make offer' })).toBeEnabled();
    await act(async () => void fireEvent.press(screen.getByText('Buy')));
    expect(mockRouter.push).toHaveBeenCalledWith(`/checkout?listingId=${ID}`);
    // The page reads the listing and its comments and counts one view when it opens; Buy itself sends nothing (no other write).
    const writes = fetchMock.mock.calls.filter(([, init]) => (init?.method ?? 'GET') !== 'GET').map(([url]) => String(url).replace('http://api.test', ''));
    expect(writes).toEqual([`/v1/buyer/listings/${ID}/view`]);
  });

  it('a website listing says Fayda does not handle that purchase and opens the seller’s site', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    serve(buyerListing({ checkout: { channel: 'WEBSITE', productUrl: 'https://kiran.example/kurta', payMethods: [] } }));
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByText('Cotton kurta');
    expect(screen.queryByRole('button', { name: 'Buy' })).not.toBeOnTheScreen();
    expect(screen.getByText(/Fayda does not handle that purchase/)).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByText('Buy on the seller’s website')));
    expect(open).toHaveBeenCalledWith('https://kiran.example/kurta');
    open.mockRestore();
  });

  it('cannot be bought when it is sold out', async () => {
    serve(buyerListing({ soldOut: true, variants: [{ id: 'v1', label: 'M', available: false, low: false }] }));
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByText('Sizes');
    expect(screen.getByRole('button', { name: 'Buy' })).toBeDisabled();
  });

  it('shows "No reviews yet" for a seller with no reviews', async () => {
    serve(buyerListing({ seller: { ...buyerListing().seller, rating: null, reviewCount: 0 } }));
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByText(/No reviews yet/)).toBeOnTheScreen();
  });

  it('has no Make offer on a fixed-price listing', async () => {
    serve(buyerListing({ bargaining: { mode: 'BUY_NOW', acceptsOffers: false, expiryMinutes: 1440 } }));
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByText('Cotton kurta');
    expect(screen.queryByText('Make offer')).not.toBeOnTheScreen();
  });

  it('has no Make offer on a listing that is sold out', async () => {
    serve(buyerListing({ soldOut: true, variants: [{ id: 'v1', label: 'M', available: false, low: false }] }));
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByText('Sizes');
    expect(screen.queryByText('Make offer')).not.toBeOnTheScreen();
  });

  it('shows a video’s cover first, and mounts one player with the resolved address only after Play', async () => {
    serve(buyerListing({ media: [{ kind: 'video', url: '/v1/media/v1', posterUrl: '/v1/media/p1' }, { kind: 'image', url: '/v1/media/m2', posterUrl: null }] }));
    await renderWith(signedIn(), <ListingScreen />);
    expect((await screen.findByLabelText('Video cover 1 of 2: Cotton kurta')).props.source).toEqual({ uri: 'http://api.test/v1/media/p1' });
    expect(screen.getByText('1 / 2')).toBeOnTheScreen();
    expect(mockPlayer).not.toHaveBeenCalled();
    await act(async () => void fireEvent.press(screen.getByText('Play video')));
    expect(screen.getByLabelText('Video player')).toBeOnTheScreen();
    expect(mockPlayer).toHaveBeenCalledWith('http://api.test/v1/media/v1');
  });

  it('copes with a listing that has no media', async () => {
    serve(buyerListing({ media: [] }));
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByText('No photos yet')).toBeOnTheScreen();
  });
});
