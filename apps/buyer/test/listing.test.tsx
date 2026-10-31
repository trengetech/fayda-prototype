import { act, fireEvent, screen } from '@testing-library/react-native';
import { View as MockView } from 'react-native';
import ListingScreen from '../app/listing/[id]';
import { buyerListing, fakeApi, json, managerWith, problem, renderWith } from './utils';

const mockPlayer = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70' }) }));
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
});

describe('buyer product page', () => {
  it('shows a loading state, then the error with Try again', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByText('Loading…')).toBeOnTheScreen();
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
    expect(screen.getByText('Kiran Studio · Madhapur, Hyderabad')).toBeOnTheScreen();
    expect(screen.getByText('Block print, soft cotton.')).toBeOnTheScreen();
    expect(screen.getByText('Open to offers')).toBeOnTheScreen();
    expect(screen.getByLabelText('Photo 1 of 1: Cotton kurta').props.source).toEqual({ uri: 'http://api.test/v1/media/m1' });
  });

  it('labels a fixed-price listing as fixed price', async () => {
    serve(buyerListing({ bargaining: { mode: 'FIXED', acceptsOffers: false, expiryHours: 24 } }));
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

  it('says Buy and Make offer are not available yet, and pressing them sends nothing', async () => {
    serve(buyerListing());
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByText('Cotton kurta');
    expect(screen.getByText(/not available yet/)).toBeOnTheScreen();
    for (const name of ['Buy', 'Make offer']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
      await act(async () => void fireEvent.press(screen.getByText(name)));
    }
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the page load
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
