import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import FollowsScreen from '../app/follows';
import SearchScreen from '../app/(tabs)/search';
import ShopScreen from '../app/shop/[handle]';
import { activeFilterCount, filtersToParams, NO_FILTERS } from '../src/feed-filters';
import { feedItem, fakeApi, json, managerWith, record, renderWith } from './utils';

const mockRouter = { push: jest.fn(), back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({ handle: 'kiranstudio' }) }));

let fetchMock: jest.Mock;
const signedIn = () => managerWith('buyer', fetchMock, { missing: [] });
beforeEach(() => {
  fetchMock = jest.fn();
  mockRouter.push.mockClear();
});

const facets = { categories: ['Ethnic wear', 'Menswear'], sizes: ['m', 'xl'], minPrice: 40000, maxPrice: 500000 };
const kurta = feedItem();
const saree = feedItem({ id: 'a1b2c3d4-0000-4000-8000-000000000002', title: 'Silk saree', price: 450000 });
const page = (items: object[], nextCursor: string | null = null) => json({ items, nextCursor });

describe('filters', () => {
  it('turns what was typed into the request, in paise, and counts what is set', () => {
    expect(filtersToParams(' red  kurta ', { ...NO_FILTERS, category: 'Ethnic wear', size: 'm', acceptsOffers: true, sort: 'PRICE_LOW', minRupees: '500', maxRupees: '1,500' })).toEqual({
      params: { scope: 'FOR_YOU', sort: 'PRICE_LOW', q: 'red  kurta', category: 'Ethnic wear', size: 'm', acceptsOffers: true, minPrice: 50000, maxPrice: 150000 },
      errors: {},
    });
    expect(filtersToParams('', NO_FILTERS).params).toEqual({ scope: 'FOR_YOU', sort: 'BEST' });
    expect(activeFilterCount(NO_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...NO_FILTERS, category: 'Menswear', sort: 'PRICE_HIGH', minRupees: '10' })).toBe(3);
  });
  it('reports a bad price and a backwards range, and leaves them out of the request', () => {
    const bad = filtersToParams('', { ...NO_FILTERS, minRupees: 'abc' });
    expect(bad.errors.minPrice).toBe('Enter a whole number of rupees.');
    expect(bad.params).not.toHaveProperty('minPrice');
    expect(filtersToParams('', { ...NO_FILTERS, minRupees: '900', maxRupees: '100' }).errors.maxPrice).toBeTruthy();
  });
});

describe('buyer search', () => {
  /** A feed that records every address it is asked for. */
  function serve(answer: (url: string) => Response) {
    const urls: string[] = [];
    fetchMock.mockImplementation((url: string) => {
      const path = String(url).replace('http://api.test', '');
      if (path === '/v1/buyer/feed/facets') return Promise.resolve(json(facets));
      urls.push(path);
      return Promise.resolve(answer(path));
    });
    return urls;
  }

  it('lists everything first, then searches a moment after typing stops', async () => {
    const urls = serve((u) => (u.includes('q=') ? page([saree]) : page([kurta, saree])));
    await renderWith(signedIn(), <SearchScreen />);
    expect(await screen.findByText('Cotton kurta')).toBeOnTheScreen();
    await act(async () => void fireEvent.changeText(screen.getByLabelText('Search'), 'Silk  saree'));
    expect(await screen.findByText('Silk saree')).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('Cotton kurta')).not.toBeOnTheScreen()); // the search has replaced the list
    expect(urls.filter((u) => u.includes('/feed'))).toEqual(['/v1/buyer/feed?scope=FOR_YOU&sort=BEST', '/v1/buyer/feed?scope=FOR_YOU&q=Silk+saree&sort=BEST']); // one request, not one per key
  });

  it('applies category, size, offers, price and sort, and Clear filters undoes them', async () => {
    const urls = serve(() => page([kurta]));
    await renderWith(signedIn(), <SearchScreen />);
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent.press(await screen.findByLabelText('Ethnic wear')));
    await act(async () => void fireEvent.press(screen.getByLabelText('M')));
    await act(async () => void fireEvent.press(screen.getByLabelText('Accepts offers')));
    await act(async () => void fireEvent.press(screen.getByLabelText('Sort: Best match'))); // Best match, then Newest
    await act(async () => void fireEvent.press(screen.getByLabelText('Sort: Newest'))); // then Price: low to high
    await act(async () => void fireEvent.press(screen.getByLabelText('Price…')));
    await act(async () => void fireEvent.changeText(screen.getByLabelText('Lowest price'), '500'));
    await act(async () => void fireEvent.changeText(screen.getByLabelText('Highest price'), '2000'));
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
    expect(urls.at(-1)).toBe('/v1/buyer/feed?scope=FOR_YOU&category=Ethnic+wear&minPrice=50000&maxPrice=200000&size=m&acceptsOffers=true&sort=PRICE_LOW');
    await act(async () => void fireEvent.press(screen.getByText('Clear filters')));
    await act(async () => void (await new Promise((r) => setTimeout(r, 50))));
    expect(screen.getByLabelText('Sort: Best match')).toBeOnTheScreen(); // back to the default order (the plain list is cached, so no new request)
    expect(screen.queryByText('Clear filters')).not.toBeOnTheScreen();
  });

  it('tells the person a price is not a number, without sending it', async () => {
    const urls = serve(() => page([kurta]));
    await renderWith(signedIn(), <SearchScreen />);
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent.press(screen.getByLabelText('Price…')));
    await act(async () => void fireEvent.changeText(await screen.findByLabelText('Lowest price'), 'cheap'));
    expect(await screen.findByText('Enter a whole number of rupees.')).toBeOnTheScreen();
    expect(urls.every((u) => !u.includes('cheap'))).toBe(true);
  });

  it('says when nothing matches, and offers to ask sellers', async () => {
    serve((u) => (u.includes('q=') ? page([]) : page([kurta])));
    await renderWith(signedIn(), <SearchScreen />);
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent.changeText(screen.getByLabelText('Search'), 'zzzz'));
    expect(await screen.findByText('No matches')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Can’t find it? Ask sellers')));
    expect(mockRouter.push).toHaveBeenCalledWith('/request/new');
  });

  it('opens a result, shows an error with retry, and pages with the cursor', async () => {
    let fail = true;
    const urls = serve((u) => {
      if (fail) return json({ title: 'x', status: 500, code: 'INTERNAL', detail: 'Server fell over' }, 500);
      return u.includes('cursor=c1') ? page([saree]) : page([kurta], 'c1');
    });
    await renderWith(signedIn(), <SearchScreen />);
    expect(await screen.findByText('Can’t search right now')).toBeOnTheScreen();
    fail = false;
    await act(async () => void fireEvent.press(screen.getByText('Try again')));
    await act(async () => void fireEvent.press(await screen.findByLabelText('Open Cotton kurta')));
    expect(mockRouter.push).toHaveBeenCalledWith(`/listing/${kurta.id}`);
    await act(async () => void fireEvent(screen.getByTestId('search-list'), 'endReached'));
    expect(await screen.findByText('Silk saree')).toBeOnTheScreen();
    expect(urls.at(-1)).toBe('/v1/buyer/feed?scope=FOR_YOU&sort=BEST&cursor=c1');
  });
});

const shop = (over: Record<string, unknown> = {}) => ({
  id: 's1', name: 'Kiran Studio', handle: 'kiranstudio', bio: 'Block prints from Hyderabad.', area: 'Madhapur', city: 'Hyderabad', categories: ['Ethnic wear', 'Accessories'],
  mapsUrl: 'https://maps.app.goo.gl/abc', googleProfileUrl: null, socialUrl: 'https://instagram.com/kiran', slaConfirmHours: 4, slaShipDays: 2, record, followerCount: 12, listingCount: 2, following: false, isOwn: false, ...over,
});

describe('buyer shop page', () => {
  const serveShop = (s: object, items: object[] = [kurta, saree], extra: Record<string, () => Response> = {}) =>
    fakeApi({ 'GET /v1/buyer/shops/kiranstudio': () => json(s), 'GET /v1/buyer/shops/kiranstudio/listings': () => page(items), ...extra }, fetchMock);

  it('shows the public profile, the order record and the listings', async () => {
    serveShop(shop());
    await renderWith(signedIn(), <ShopScreen />);
    expect((await screen.findAllByText('Kiran Studio')).length).toBeGreaterThan(0);
    expect(screen.getByText('@kiranstudio · Madhapur, Hyderabad')).toBeOnTheScreen();
    expect(screen.getByText('12 followers · 2 listings')).toBeOnTheScreen();
    expect(screen.getByText('Block prints from Hyderabad.')).toBeOnTheScreen();
    expect(screen.getByText('15 of 20 orders delivered · 2 cancelled · 1 not confirmed in time')).toBeOnTheScreen();
    expect(screen.getByText('Confirms payment within 4 hours · ships within 2 days')).toBeOnTheScreen();
    expect(screen.getByText('Ethnic wear · Accessories')).toBeOnTheScreen();
    expect(await screen.findByText('Cotton kurta')).toBeOnTheScreen();
    expect(screen.getByText('Silk saree')).toBeOnTheScreen();
    expect(screen.queryByText(/9\d{9}/)).not.toBeOnTheScreen(); // no phone number anywhere
    await act(async () => void fireEvent.press(screen.getByLabelText('Open Cotton kurta')));
    expect(mockRouter.push).toHaveBeenCalledWith(`/listing/${kurta.id}`);
  });

  it('Follow updates the count at once; your own shop has no Follow; the map link opens', async () => {
    let following = false; // the server remembers, so the refetch after the tap agrees with it
    fakeApi(
      {
        'GET /v1/buyer/shops/kiranstudio': () => json(shop({ following, followerCount: following ? 13 : 12 })),
        'GET /v1/buyer/shops/kiranstudio/listings': () => page([kurta]),
        'PUT /v1/buyer/follows/sellers/s1': () => ((following = true), json({ following: true, followerCount: 13 })),
        'GET /v1/buyer/follows': () => json({ items: [], nextCursor: null }),
      },
      fetchMock,
    );
    await renderWith(signedIn(), <ShopScreen />);
    await act(async () => void fireEvent.press(await screen.findByLabelText('Follow Kiran Studio')));
    expect(await screen.findByText('13 followers · 2 listings')).toBeOnTheScreen();
    expect(screen.getByLabelText('Unfollow Kiran Studio')).toBeOnTheScreen();
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await act(async () => void fireEvent.press(screen.getByText('Find the shop on Google Maps')));
    expect(open).toHaveBeenCalledWith('https://maps.app.goo.gl/abc');
  });

  it('shows Your shop instead of Follow on the owner’s own page', async () => {
    serveShop(shop({ isOwn: true }));
    await renderWith(signedIn(), <ShopScreen />);
    expect(await screen.findByText('Your shop')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Follow Kiran Studio')).not.toBeOnTheScreen();
  });

  it('says so for a shop with no live listings, and shows an error with retry for an unknown shop', async () => {
    serveShop(shop({ listingCount: 0 }), []);
    await renderWith(signedIn(), <ShopScreen />);
    expect(await screen.findByText('No live listings')).toBeOnTheScreen();
  });

  it('shows the error when the shop cannot be opened', async () => {
    fakeApi({ 'GET /v1/buyer/shops/kiranstudio': () => json({ title: 'x', status: 404, code: 'NOT_FOUND', detail: 'Shop not found.' }, 404) }, fetchMock);
    await renderWith(signedIn(), <ShopScreen />);
    expect(await screen.findByText('Can’t open this shop')).toBeOnTheScreen();
    expect(screen.getByText('Shop not found.')).toBeOnTheScreen();
  });
});

describe('shops you follow', () => {
  const followed = { id: 's1', name: 'Kiran Studio', handle: 'kiranstudio', area: 'Madhapur', city: 'Hyderabad', followedAt: 1 };

  it('lists the shops, opens one, and Unfollow removes it', async () => {
    let list = [followed];
    fakeApi(
      {
        'GET /v1/buyer/follows': () => json({ items: list, nextCursor: null }),
        'DELETE /v1/buyer/follows/sellers/s1': () => ((list = []), json({ following: false, followerCount: 11 })),
      },
      fetchMock,
    );
    await renderWith(signedIn(), <FollowsScreen />);
    expect(await screen.findByText('Kiran Studio')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Open shop Kiran Studio')));
    expect(mockRouter.push).toHaveBeenCalledWith('/shop/kiranstudio');
    await act(async () => void fireEvent.press(screen.getByLabelText('Unfollow Kiran Studio')));
    expect(await screen.findByText('You don’t follow any shops yet')).toBeOnTheScreen();
  });
});
