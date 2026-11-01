import { act, fireEvent, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import FeedScreen from '../app/(tabs)/index';
import { feedItem, fakeApi, json, managerWith, problem, renderWith } from './utils';

const mockRouter = { push: jest.fn(), back: jest.fn() };
let mockLeaveScreen: (() => void) | undefined;
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => mockRouter,
    // A screen is "focused" on mount; a test calls `mockLeaveScreen` to simulate another screen covering it.
    useFocusEffect: (cb: () => void | (() => void)) =>
      React.useEffect(() => {
        const cleanup = cb();
        mockLeaveScreen = typeof cleanup === 'function' ? cleanup : undefined;
        return cleanup;
      }, []),
  };
});

interface MockPlayer { uri: string; muted: boolean; loop: boolean; play: jest.Mock; pause: jest.Mock }
const mockPlayers: MockPlayer[] = [];
jest.mock('expo-video', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    useVideoPlayer: (uri: string, setup?: (p: MockPlayer) => void) => {
      const ref = React.useRef<MockPlayer | null>(null);
      if (!ref.current) {
        ref.current = { uri, muted: false, loop: false, play: jest.fn(), pause: jest.fn() };
        setup?.(ref.current);
        mockPlayers.push(ref.current);
      }
      return ref.current;
    },
    VideoView: () => null,
  };
});

let fetchMock: jest.Mock;
const signedIn = () => managerWith('buyer', fetchMock, { missing: [] });
const FEED = 'GET /v1/buyer/feed?scope=FOR_YOU';
const FOLLOWING = 'GET /v1/buyer/feed?scope=FOLLOWING';
beforeEach(() => {
  fetchMock = jest.fn();
  mockRouter.push.mockClear();
  mockRouter.back.mockClear();
  mockPlayers.length = 0;
  mockLeaveScreen = undefined;
});

const reel = (n: number, over: Record<string, unknown> = {}) =>
  feedItem({ id: `a1b2c3d4-0000-4000-8000-00000000000${n}`, title: `Reel ${n}`, video: { url: `/v1/media/v${n}`, posterUrl: `/v1/media/p${n}` }, hasVideo: true, coverUrl: `/v1/media/p${n}`, ...over });
const kurta = feedItem();
const saree = feedItem({ id: 'a1b2c3d4-0000-4000-8000-000000000002', title: 'Silk saree', price: 450000, acceptsOffers: false });
const gone = feedItem({ id: 'a1b2c3d4-0000-4000-8000-000000000003', title: 'Old dupatta', soldOut: true });

/** Gives the reels a height (a real phone reports it on layout) so the list renders. */
async function layOut() {
  await act(async () => void fireEvent(await screen.findByTestId('reels-container'), 'layout', { nativeEvent: { layout: { width: 400, height: 800 } } }));
}
const show = async (items: object[], extra: Record<string, () => Response | Promise<Response>> = {}) => {
  fakeApi({ [FEED]: () => json({ items, nextCursor: null }), ...extra }, fetchMock);
  await renderWith(signedIn(), <FeedScreen />);
  await layOut();
};
const viewing = (item: { id: string }) => act(async () => void fireEvent(screen.getByTestId('reels-list'), 'viewableItemsChanged', { viewableItems: [{ item, isViewable: true }], changed: [] }));

describe('buyer reels: loading and errors', () => {
  it('shows a loading state while the feed is on its way', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    await renderWith(signedIn(), <FeedScreen />);
    expect(await screen.findByText('Loading listings…')).toBeOnTheScreen();
  });

  it('shows the error, and Try again recovers', async () => {
    let fail = true;
    fakeApi({ [FEED]: () => (fail ? problem(500, 'INTERNAL', undefined, 'Server fell over') : json({ items: [kurta], nextCursor: null })) }, fetchMock);
    await renderWith(signedIn(), <FeedScreen />);
    expect(await screen.findByText('Can’t load listings')).toBeOnTheScreen();
    expect(screen.getByText('Server fell over')).toBeOnTheScreen();
    fail = false;
    await act(async () => void fireEvent.press(screen.getByText('Try again')));
    await layOut();
    expect(await screen.findByText('Cotton kurta')).toBeOnTheScreen();
  });

  it('says so when nothing is listed, and offers to ask sellers', async () => {
    await show([]);
    expect(await screen.findByText('Nothing listed yet')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByText('Ask sellers for something')));
    expect(mockRouter.push).toHaveBeenCalledWith('/request/new');
  });
});

describe('buyer reels: the card', () => {
  it('shows seller, price, bargaining label and the cover from the API address', async () => {
    await show([kurta, saree, gone]);
    expect(await screen.findByText('Cotton kurta')).toBeOnTheScreen();
    expect(screen.getByText('₹4,500')).toBeOnTheScreen();
    expect(screen.getAllByText(/Kiran Studio/).length).toBeGreaterThan(0);
    expect(screen.getByText('Accepts offers')).toBeOnTheScreen();
    expect(screen.getByText('Fixed price')).toBeOnTheScreen();
    expect(await screen.findByText('Sold out')).toBeOnTheScreen(); // the third card renders a moment later
    expect(screen.getByLabelText('Photo of Cotton kurta').props.source).toEqual({ uri: 'http://api.test/v1/media/m1' });
  });

  it('Buy and Make offer open the product page; Make offer opens the offer sheet; fixed price has no Make offer', async () => {
    await show([kurta, saree]);
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent.press(screen.getByLabelText('Buy Cotton kurta')));
    expect(mockRouter.push).toHaveBeenLastCalledWith(`/listing/${kurta.id}`);
    await act(async () => void fireEvent.press(screen.getByLabelText('Make an offer on Cotton kurta')));
    expect(mockRouter.push).toHaveBeenLastCalledWith(`/listing/${kurta.id}?offer=1`);
    expect(screen.queryByLabelText('Make an offer on Silk saree')).not.toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Open Cotton kurta')));
    expect(mockRouter.push).toHaveBeenLastCalledWith(`/listing/${kurta.id}`);
  });

  it('a sold-out listing cannot be bought or bid on, and your own shop shows no Follow or Buy', async () => {
    await show([gone, reel(4, { ownShop: true })]);
    await screen.findByText('Old dupatta');
    expect(screen.getByLabelText('Buy Old dupatta')).toBeDisabled();
    expect(screen.getByLabelText('Make an offer on Old dupatta')).toBeDisabled();
    expect(screen.getByText('Your shop')).toBeOnTheScreen();
    expect(screen.getByLabelText('Buy Reel 4')).toBeDisabled();
    expect(screen.getAllByLabelText(/^Follow /)).toHaveLength(1); // only the dupatta's seller can be followed
  });

  it('tapping the seller opens their shop; the bell opens notifications', async () => {
    await show([kurta]);
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent.press(screen.getByLabelText('Open shop Kiran Studio')));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/shop/kiranstudio');
    await act(async () => void fireEvent.press(screen.getByLabelText(/^Notifications/)));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/notifications');
  });
});

describe('buyer reels: follow', () => {
  it('Follow flips to Following at once, and is put back if the server refuses', async () => {
    let answer: (r: Response) => void = () => {};
    const held = new Promise<Response>((resolve) => (answer = resolve));
    await show([kurta], { 'PUT /v1/buyer/follows/sellers/s1': () => held, 'GET /v1/buyer/follows': () => json({ items: [], nextCursor: null }) });
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent.press(screen.getByLabelText('Follow Kiran Studio')));
    expect(await screen.findByLabelText('Unfollow Kiran Studio')).toBeOnTheScreen(); // the server has not answered yet (its reply is held)
    await act(async () => answer(problem(422, 'OWN_SHOP', undefined, 'You can’t follow your own shop.')));
    expect(await screen.findByLabelText('Follow Kiran Studio')).toBeOnTheScreen(); // put back
  });

  it('a follow the server accepts stays, and Unfollow sends DELETE', async () => {
    const calls: string[] = [];
    await show([kurta], {
      'PUT /v1/buyer/follows/sellers/s1': () => (calls.push('PUT'), json({ following: true, followerCount: 1 })),
      'DELETE /v1/buyer/follows/sellers/s1': () => (calls.push('DELETE'), json({ following: false, followerCount: 0 })),
    });
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent.press(screen.getByLabelText('Follow Kiran Studio')));
    await act(async () => void fireEvent.press(await screen.findByLabelText('Unfollow Kiran Studio')));
    expect(calls).toEqual(['PUT', 'DELETE']);
  });
});

describe('buyer reels: tabs and paging', () => {
  it('Following asks for the followed shops only, and explains an empty one', async () => {
    await show([kurta], { [FOLLOWING]: () => json({ items: [], nextCursor: null }) });
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent.press(screen.getByLabelText('Following')));
    await layOut();
    expect(await screen.findByText('Nothing from shops you follow yet')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByText('Go to For You')));
    await layOut();
    expect(await screen.findByText('Cotton kurta')).toBeOnTheScreen();
  });

  it('loads the next page with the cursor when the end is reached, and stops when there is none', async () => {
    const urls: string[] = [];
    fakeApi(
      {
        [FEED]: () => (urls.push('first'), json({ items: [kurta], nextCursor: 'c1' })),
        [`${FEED}&cursor=c1`]: () => (urls.push('second'), json({ items: [saree], nextCursor: null })),
      },
      fetchMock,
    );
    await renderWith(signedIn(), <FeedScreen />);
    await layOut();
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent(screen.getByTestId('reels-list'), 'endReached'));
    expect(await screen.findByText('Silk saree')).toBeOnTheScreen();
    expect(screen.getByText('Cotton kurta')).toBeOnTheScreen(); // pages are joined, not replaced
    await act(async () => void fireEvent(screen.getByTestId('reels-list'), 'endReached'));
    expect(urls).toEqual(['first', 'second']); // no cursor, no third request
  });
});

describe('buyer reels: video playback', () => {
  it('creates a player only for the reel on screen and the next one; only the one on screen plays', async () => {
    await show([reel(1), reel(2), reel(3), kurta]);
    await screen.findByText('Reel 1');
    expect(mockPlayers.map((p) => p.uri)).toEqual(['http://api.test/v1/media/v1', 'http://api.test/v1/media/v2']); // not v3, and none for the photo
    expect(mockPlayers[0]?.play).toHaveBeenCalled();
    expect(mockPlayers[1]?.play).not.toHaveBeenCalled();
    expect(mockPlayers.every((p) => p.muted && p.loop)).toBe(true); // muted, looping
  });

  it('swiping to the next reel plays it, pauses the old one and prepares the one after', async () => {
    const items = [reel(1), reel(2), reel(3)];
    await show(items);
    await screen.findByText('Reel 1');
    await viewing(items[1]!);
    const byUri = (n: number) => mockPlayers.find((p) => p.uri.endsWith(`/v${n}`))!;
    expect(byUri(2).play).toHaveBeenCalled();
    expect(byUri(3)).toBeDefined(); // the one after is prepared early...
    expect(byUri(3).play).not.toHaveBeenCalled(); // ...but does not play
    // the first reel's player is released (unmounted), so at most two players are alive: the active one and the next
    expect(byUri(1).play).toHaveBeenCalledTimes(1);
  });

  it('a tap pauses and resumes', async () => {
    await show([reel(1), reel(2)]);
    await screen.findByText('Reel 1');
    const p1 = mockPlayers[0]!;
    p1.pause.mockClear();
    await act(async () => void fireEvent.press(screen.getAllByLabelText('Pause video')[0]!));
    expect(p1.pause).toHaveBeenCalled();
    expect(screen.getByText('Paused')).toBeOnTheScreen();
    p1.play.mockClear();
    await act(async () => void fireEvent.press(screen.getAllByLabelText('Play video')[0]!));
    expect(p1.play).toHaveBeenCalled();
  });

  it('Sound toggles the mute on the players', async () => {
    await show([reel(1)]);
    await screen.findByText('Reel 1');
    expect(screen.getByLabelText('Turn sound on')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Turn sound on')));
    expect(mockPlayers[0]?.muted).toBe(false);
    await act(async () => void fireEvent.press(screen.getByLabelText('Turn sound off')));
    expect(mockPlayers[0]?.muted).toBe(true);
  });

  it('pauses when the app goes to the background or another screen covers the reels', async () => {
    let onState: ((s: string) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, l: (s: string) => void) => {
      onState = l;
      return { remove: () => {} };
    }) as never);
    await show([reel(1)]);
    await screen.findByText('Reel 1');
    const p = mockPlayers[0]!;
    p.pause.mockClear();
    await act(async () => onState?.('background'));
    expect(p.pause).toHaveBeenCalled();
    p.play.mockClear();
    await act(async () => onState?.('active'));
    expect(p.play).toHaveBeenCalled();
    p.pause.mockClear();
    await act(async () => mockLeaveScreen?.());
    expect(p.pause).toHaveBeenCalled(); // the product page opened on top
  });
});
