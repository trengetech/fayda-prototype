import { act, fireEvent, screen } from '@testing-library/react-native';
import FeedScreen from '../app/feed';
import { feedItem, fakeApi, json, managerWith, problem, renderWith } from './utils';

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

let fetchMock: jest.Mock;
const signedIn = () => managerWith('buyer', fetchMock, { missing: [] });
beforeEach(() => {
  fetchMock = jest.fn();
  mockRouter.push.mockClear();
});

const kurta = feedItem();
const saree = feedItem({ id: 'a1b2c3d4-0000-4000-8000-000000000002', title: 'Silk saree', price: 450000, acceptsOffers: false, hasVideo: true, coverUrl: null });
const gone = feedItem({ id: 'a1b2c3d4-0000-4000-8000-000000000003', title: 'Old dupatta', soldOut: true });

describe('buyer feed', () => {
  it('shows a loading state while the feed is on its way', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await renderWith(signedIn(), <FeedScreen />);
    expect(await screen.findByText('Loading listings…')).toBeOnTheScreen();
  });

  it('shows the error, and Try again recovers', async () => {
    let fail = true;
    fakeApi({ 'GET /v1/buyer/feed': () => (fail ? problem(500, 'INTERNAL', undefined, 'Server fell over') : json({ items: [kurta], nextCursor: null })) }, fetchMock);
    await renderWith(signedIn(), <FeedScreen />);
    expect(await screen.findByText('Can’t load listings')).toBeOnTheScreen();
    expect(screen.getByText('Server fell over')).toBeOnTheScreen();
    fail = false;
    await act(async () => void fireEvent.press(screen.getByText('Try again')));
    expect(await screen.findByText('Cotton kurta')).toBeOnTheScreen();
  });

  it('shows price, seller, area, badges and the cover from the API address', async () => {
    fakeApi({ 'GET /v1/buyer/feed': () => json({ items: [kurta, saree, gone], nextCursor: null }) }, fetchMock);
    await renderWith(signedIn(), <FeedScreen />);
    expect(await screen.findByText('Cotton kurta')).toBeOnTheScreen();
    expect(screen.getByText('₹4,500')).toBeOnTheScreen();
    expect(screen.getAllByText('Kiran Studio · Madhapur')).toHaveLength(3);
    expect(screen.getByText('Open to offers')).toBeOnTheScreen(); // only the kurta: the saree is fixed-price and the dupatta is sold out
    expect(screen.getByText('Video')).toBeOnTheScreen();
    expect(screen.getByText('Sold out')).toBeOnTheScreen();
    expect(screen.getByLabelText('Photo of Cotton kurta').props.source).toEqual({ uri: 'http://api.test/v1/media/m1' });
    expect(screen.queryByLabelText('Photo of Silk saree')).not.toBeOnTheScreen(); // no cover, no image
  });

  it('says so when nothing is listed', async () => {
    fakeApi({ 'GET /v1/buyer/feed': () => json({ items: [], nextCursor: null }) }, fetchMock);
    await renderWith(signedIn(), <FeedScreen />);
    expect(await screen.findByText('Nothing listed yet')).toBeOnTheScreen();
  });

  it('opens the product page for the tapped listing', async () => {
    fakeApi({ 'GET /v1/buyer/feed': () => json({ items: [kurta], nextCursor: null }) }, fetchMock);
    await renderWith(signedIn(), <FeedScreen />);
    await act(async () => void fireEvent.press(await screen.findByLabelText('Open Cotton kurta')));
    expect(mockRouter.push).toHaveBeenCalledWith(`/listing/${kurta.id}`);
  });

  it('loads the next page with the cursor when the end is reached, and stops when there is none', async () => {
    const urls: string[] = [];
    fakeApi(
      {
        'GET /v1/buyer/feed': () => (urls.push('first'), json({ items: [kurta], nextCursor: 'c1' })),
        'GET /v1/buyer/feed?cursor=c1': () => (urls.push('second'), json({ items: [saree], nextCursor: null })),
      },
      fetchMock,
    );
    await renderWith(signedIn(), <FeedScreen />);
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent(screen.getByTestId('feed-list'), 'endReached'));
    expect(await screen.findByText('Silk saree')).toBeOnTheScreen();
    expect(screen.getByText('Cotton kurta')).toBeOnTheScreen(); // pages are joined, not replaced
    await act(async () => void fireEvent(screen.getByTestId('feed-list'), 'endReached'));
    expect(urls).toEqual(['first', 'second']); // no cursor, no third request
  });
});
