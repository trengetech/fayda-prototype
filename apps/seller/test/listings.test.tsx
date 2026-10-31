import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import ListingsScreen from '../app/listings';
import { fakeApi, json, managerWith, problem, renderWith, sellerListing } from './utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}) }));

let fetchMock: jest.Mock;
const signedIn = () => managerWith('seller', fetchMock, { missing: [] });
const press = (label: string) => act(async () => void fireEvent.press(screen.getByText(label)));
beforeEach(() => {
  fetchMock = jest.fn();
  mockRouter.push.mockClear();
});

const live = sellerListing({ id: 'l-live', title: 'Live kurta', status: 'ACTIVE', publishedAt: 5 });
const paused = sellerListing({ id: 'l-paused', title: 'Paused saree', status: 'PAUSED', variants: [{ id: 'v2', label: 'Free', stock: 0 }] });
const draft = sellerListing({ id: 'l-draft', title: 'Draft top', status: 'DRAFT', media: [] });

describe('listings screen', () => {
  it('shows a loading state while the list is on its way', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await renderWith(signedIn(), <ListingsScreen />);
    expect(await screen.findByText('Loading your listings…')).toBeOnTheScreen();
  });

  it('shows the error, and Try again recovers', async () => {
    let fail = true;
    fakeApi({ 'GET /v1/seller/listings': () => (fail ? problem(500, 'INTERNAL', undefined, 'Server fell over') : json({ items: [live] })) }, fetchMock);
    await renderWith(signedIn(), <ListingsScreen />);
    expect(await screen.findByText('Can’t load your listings')).toBeOnTheScreen();
    fail = false;
    await press('Try again');
    expect(await screen.findByText('Live kurta')).toBeOnTheScreen();
  });

  it('shows price, stock and status, and the cover photo from the API address', async () => {
    fakeApi({ 'GET /v1/seller/listings': () => json({ items: [live, paused, draft] }) }, fetchMock);
    await renderWith(signedIn(), <ListingsScreen />);
    expect(await screen.findByText('Live kurta')).toBeOnTheScreen();
    expect(screen.getAllByText('₹1,500')).toHaveLength(3);
    expect(screen.getAllByText('3 in stock')).toHaveLength(2); // the live listing and the draft
    expect(screen.getByText('0 in stock')).toBeOnTheScreen();
    expect(screen.getAllByText('Live')).toHaveLength(2); // the filter chip and the badge
    expect(screen.getAllByText('Paused')).toHaveLength(2);
    expect(screen.getByText('Draft')).toBeOnTheScreen();
    expect(screen.getByLabelText('Cover of Live kurta').props.source).toEqual({ uri: 'http://api.test/v1/media/m1' });
    expect(screen.queryByLabelText('Cover of Draft top')).not.toBeOnTheScreen(); // a listing with no media has no cover image
  });

  it('filters by status, and says so when a filter is empty', async () => {
    fakeApi({ 'GET /v1/seller/listings': () => json({ items: [live, draft] }) }, fetchMock);
    await renderWith(signedIn(), <ListingsScreen />);
    await screen.findByText('Live kurta');
    await act(async () => void fireEvent.press(screen.getByLabelText('Drafts')));
    expect(screen.queryByText('Live kurta')).not.toBeOnTheScreen();
    expect(screen.getByText('Draft top')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Paused')));
    expect(screen.getByText('No paused')).toBeOnTheScreen();
  });

  it('shows an empty state with a way to start', async () => {
    fakeApi({ 'GET /v1/seller/listings': () => json({ items: [] }) }, fetchMock);
    await renderWith(signedIn(), <ListingsScreen />);
    expect(await screen.findByText('Nothing here yet')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getAllByText('New listing')[1] as never));
    expect(mockRouter.push).toHaveBeenCalledWith('/listing/new');
  });

  it('opens a listing, and pauses a live one', async () => {
    const calls: unknown[] = [];
    fakeApi({
      'GET /v1/seller/listings': () => json({ items: [live] }),
      'POST /v1/seller/listings/l-live/status': (r) => { calls.push(r.body); return json({ ...live, status: 'PAUSED' }); },
    }, fetchMock);
    await renderWith(signedIn(), <ListingsScreen />);
    await screen.findByText('Live kurta');
    await act(async () => void fireEvent.press(screen.getByLabelText('Open Live kurta')));
    expect(mockRouter.push).toHaveBeenCalledWith('/listing/l-live');
    await press('Pause');
    await waitFor(() => expect(calls).toEqual([{ status: 'PAUSED' }]));
  });

  it('explains why a listing cannot be resumed', async () => {
    fakeApi({
      'GET /v1/seller/listings': () => json({ items: [paused] }),
      'POST /v1/seller/listings/l-paused/status': () => problem(422, 'NO_STOCK', undefined, 'Add stock before resuming this listing.'),
    }, fetchMock);
    await renderWith(signedIn(), <ListingsScreen />);
    await screen.findByText('Paused saree');
    await press('Resume');
    expect(await screen.findByText('Add stock before resuming this listing.')).toBeOnTheScreen();
  });
});
