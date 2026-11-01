import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert, Share } from 'react-native';
import FeedScreen from '../app/(tabs)/index';
import ListingScreen from '../app/listing/[id]';
import SavedScreen from '../app/saved';
import { shareMessage } from '../src/social';
import { buyerListing, feedItem, fakeApi, json, managerWith, problem, renderWith, type Route } from './utils';

const mockRouter = { push: jest.fn(), back: jest.fn() };
let mockParams: Record<string, string> = { id: '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70' };
jest.mock('expo-router', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return { useRouter: () => mockRouter, useLocalSearchParams: () => mockParams, useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, []) };
});
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({ play: () => {}, pause: () => {} }), VideoView: () => null }));

let fetchMock: jest.Mock;
const signedIn = () => managerWith('buyer', fetchMock, { missing: [] });
const ID = '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70';
beforeEach(() => {
  fetchMock = jest.fn();
  mockRouter.push.mockClear();
  mockParams = { id: ID };
});

const reels = async (items: object[], extra: Record<string, Route> = {}) => {
  fakeApi({ 'GET /v1/buyer/feed?scope=FOR_YOU': () => json({ items, nextCursor: null }), ...extra }, fetchMock);
  await renderWith(signedIn(), <FeedScreen />);
  await act(async () => void fireEvent(await screen.findByTestId('reels-container'), 'layout', { nativeEvent: { layout: { width: 400, height: 800 } } }));
};
const comment = (n: number, over: Record<string, unknown> = {}) => ({ id: `c0000000-0000-4000-8000-00000000000${n}`, text: `Comment ${n}`, at: Date.now() - n * 60_000, author: { name: 'Asha', shop: false }, mine: false, canRemove: false, ...over });

describe('like and save on a reel', () => {
  it('the heart flips and the count moves at once; the server’s count then wins', async () => {
    let answer: (r: Response) => void = () => {};
    const held = new Promise<Response>((resolve) => (answer = resolve));
    await reels([feedItem({ likeCount: 4 })], { [`PUT /v1/buyer/listings/${ID}/like`]: () => held });
    await screen.findByText('Cotton kurta');
    expect(screen.getByLabelText('Like Cotton kurta (4 likes)')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Like Cotton kurta (4 likes)')));
    expect(await screen.findByLabelText('Unlike Cotton kurta (5 likes)')).toBeOnTheScreen(); // before the reply
    expect(screen.getByText('5')).toBeOnTheScreen();
    await act(async () => answer(json({ liked: true, likeCount: 7 }))); // two other people liked it meanwhile
    expect(await screen.findByLabelText('Unlike Cotton kurta (7 likes)')).toBeOnTheScreen();
  });

  it('a refused like is put back', async () => {
    await reels([feedItem({ likeCount: 4 })], {
      [`PUT /v1/buyer/listings/${ID}/like`]: () => problem(409, 'NOT_AVAILABLE', undefined, 'This listing isn’t available.'),
    });
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent.press(screen.getByLabelText('Like Cotton kurta (4 likes)')));
    await waitFor(() => expect(screen.getByLabelText('Like Cotton kurta (4 likes)')).toBeOnTheScreen());
  });

  it('your own shop’s listing cannot be liked, and says how many likes it has', async () => {
    await reels([feedItem({ likeCount: 3, ownShop: true })]);
    await screen.findByText('Cotton kurta');
    expect(screen.getByLabelText('3 likes')).toBeDisabled();
  });

  it('Save and Saved toggle, sending PUT then DELETE', async () => {
    const calls: string[] = [];
    await reels([feedItem()], {
      [`PUT /v1/buyer/listings/${ID}/save`]: () => (calls.push('PUT'), json({ saved: true })),
      [`DELETE /v1/buyer/listings/${ID}/save`]: () => (calls.push('DELETE'), json({ saved: false })),
      'GET /v1/buyer/saved': () => json({ items: [], nextCursor: null }),
    });
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent.press(screen.getByLabelText('Save Cotton kurta')));
    await act(async () => void fireEvent.press(await screen.findByLabelText('Remove Cotton kurta from saved')));
    expect(calls).toEqual(['PUT', 'DELETE']);
  });

  it('Share opens the share sheet with the title, the price and a link into the app', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' } as never);
    await reels([feedItem()]);
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent.press(screen.getByLabelText('Share Cotton kurta')));
    expect(share).toHaveBeenCalledWith({ message: `Cotton kurta · ₹1,500 on Fayda\nfaydabuyer://listing/${ID}`, title: 'Cotton kurta' });
    expect(shareMessage({ id: ID, title: 'Cotton kurta', price: 150000 })).toContain(`faydabuyer://listing/${ID}`);
  });

  it('a share sheet that cannot open does not break the screen', async () => {
    jest.spyOn(Share, 'share').mockRejectedValue(new Error('no share target'));
    await reels([feedItem()]);
    await screen.findByText('Cotton kurta');
    await act(async () => void fireEvent.press(screen.getByLabelText('Share Cotton kurta')));
    expect(screen.getByText('Cotton kurta')).toBeOnTheScreen();
  });
});

describe('comments on the product page', () => {
  const serve = (extra: Record<string, Route> = {}, listing: object = buyerListing()) =>
    fakeApi({ [`GET /v1/buyer/listings/${ID}`]: () => json(listing), ...extra }, fetchMock);

  it('shows the counts, the comments newest first with who and when, and an empty state', async () => {
    serve({ [`GET /v1/buyer/listings/${ID}/comments`]: () => json({ items: [comment(1), comment(2, { author: { name: 'Kiran Studio', shop: true } })], nextCursor: null, total: 2 }) }, buyerListing({ likeCount: 12, commentCount: 2 }));
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByText('Comment 1')).toBeOnTheScreen();
    expect(screen.getByText('Comments (2)')).toBeOnTheScreen();
    expect(screen.getByText('Seller')).toBeOnTheScreen(); // the shop's reply is marked
    expect(screen.getByText('1 min ago')).toBeOnTheScreen();
    expect(screen.getByLabelText(/Like Cotton kurta \(12 likes\)/)).toBeOnTheScreen();
  });

  it('says so when there are no comments', async () => {
    serve({ [`GET /v1/buyer/listings/${ID}/comments`]: () => json({ items: [], nextCursor: null, total: 0 }) });
    await renderWith(signedIn(), <ListingScreen />);
    expect(await screen.findByText('No comments yet. Be the first to ask.')).toBeOnTheScreen();
  });

  it('posts with a client key and an idempotency key, clears the box, and shows the new comment', async () => {
    let posted: { body: unknown; headers: Record<string, string> } | undefined;
    let list = [comment(1)];
    serve({
      [`GET /v1/buyer/listings/${ID}/comments`]: () => json({ items: list, nextCursor: null, total: list.length }),
      [`POST /v1/buyer/listings/${ID}/comments`]: (r) => ((posted = { body: (r as never as { body: unknown }).body, headers: (r as never as { headers: Record<string, string> }).headers }), (list = [comment(9, { text: 'Is it true to size?', mine: true, canRemove: true }), ...list]), json(list[0], 201)),
    });
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByText('Comment 1');
    expect(screen.getByText('Post comment')).toBeDisabled();
    await act(async () => void fireEvent.changeText(screen.getByLabelText('Ask or say something'), 'Is it true to size?'));
    await act(async () => void fireEvent.press(screen.getByText('Post comment')));
    expect(await screen.findByText('Remove')).toBeOnTheScreen(); // my new comment, which I can remove
    expect(posted?.body).toMatchObject({ text: 'Is it true to size?', clientKey: expect.stringMatching(/.{8,}/) });
    expect(posted?.headers['idempotency-key']).toBeTruthy();
    expect(screen.getByLabelText('Ask or say something').props.value).toBe('');
  });

  it('shows the server’s message next to the box, and a retry of the same words keeps its keys', async () => {
    const seen: { key: string; idem: string }[] = [];
    let fail = true;
    serve({
      [`GET /v1/buyer/listings/${ID}/comments`]: () => json({ items: [], nextCursor: null, total: 0 }),
      [`POST /v1/buyer/listings/${ID}/comments`]: (r) => {
        const x = r as never as { body: { clientKey: string }; headers: Record<string, string> };
        seen.push({ key: x.body.clientKey, idem: x.headers['idempotency-key']! });
        return fail ? problem(429, 'RATE_LIMITED', undefined, 'You’re commenting very quickly. Try again in a little while.') : json(comment(1, { mine: true }), 201);
      },
    });
    await renderWith(signedIn(), <ListingScreen />);
    await screen.findByText('No comments yet. Be the first to ask.');
    await act(async () => void fireEvent.changeText(screen.getByLabelText('Ask or say something'), 'Hello there'));
    await act(async () => void fireEvent.press(screen.getByText('Post comment')));
    expect(await screen.findByText('You’re commenting very quickly. Try again in a little while.')).toBeOnTheScreen();
    fail = false;
    await act(async () => void fireEvent.press(screen.getByText('Post comment')));
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toEqual(seen[0]); // same words, same keys, so a lost reply can never post twice
  });

  it('removing my comment asks first, then sends DELETE', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    const calls: string[] = [];
    let list = [comment(1, { mine: true, canRemove: true, text: 'Remove me' })];
    serve({
      [`GET /v1/buyer/listings/${ID}/comments`]: () => json({ items: list, nextCursor: null, total: list.length }),
      [`DELETE /v1/buyer/comments/${comment(1).id}`]: () => (calls.push('DELETE'), (list = []), new Response(null, { status: 204 })),
    });
    await renderWith(signedIn(), <ListingScreen />);
    await act(async () => void fireEvent.press(await screen.findByLabelText('Remove comment by Asha')));
    expect(alert).toHaveBeenCalledWith('Remove this comment?', 'It disappears for everyone.', expect.any(Array));
    await waitFor(() => expect(calls).toEqual(['DELETE']));
    expect(await screen.findByText('No comments yet. Be the first to ask.')).toBeOnTheScreen();
  });

  it('pages: Show more comments loads the next page and joins it', async () => {
    serve({
      [`GET /v1/buyer/listings/${ID}/comments`]: () => json({ items: [comment(1)], nextCursor: 'n1', total: 2 }),
      [`GET /v1/buyer/listings/${ID}/comments?cursor=n1`]: () => json({ items: [comment(2)], nextCursor: null, total: 2 }),
    });
    await renderWith(signedIn(), <ListingScreen />);
    await act(async () => void fireEvent.press(await screen.findByText('Show more comments')));
    expect(await screen.findByText('Comment 2')).toBeOnTheScreen();
    expect(screen.getByText('Comment 1')).toBeOnTheScreen();
    expect(screen.queryByText('Show more comments')).not.toBeOnTheScreen();
  });
});

describe('saved listings', () => {
  it('lists them, and un-saving takes one off the list', async () => {
    let saved = [feedItem({ saved: true })];
    fakeApi(
      {
        'GET /v1/buyer/saved': () => json({ items: saved, nextCursor: null }),
        [`DELETE /v1/buyer/listings/${ID}/save`]: () => ((saved = []), json({ saved: false })),
      },
      fetchMock,
    );
    await renderWith(signedIn(), <SavedScreen />);
    expect(await screen.findByText('Cotton kurta')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByLabelText('Remove Cotton kurta from saved')));
    expect(await screen.findByText('Nothing saved yet')).toBeOnTheScreen();
  });

  it('says so when nothing is saved, and shows the error with retry', async () => {
    let fail = true;
    fakeApi({ 'GET /v1/buyer/saved': () => (fail ? problem(500, 'INTERNAL', undefined, 'Server fell over') : json({ items: [], nextCursor: null })) }, fetchMock);
    await renderWith(signedIn(), <SavedScreen />);
    expect(await screen.findByText('Can’t load your saved listings')).toBeOnTheScreen();
    fail = false;
    await act(async () => void fireEvent.press(screen.getByText('Try again')));
    expect(await screen.findByText('Nothing saved yet')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByText('Browse reels')));
    expect(mockRouter.push).toHaveBeenCalledWith('/feed');
  });
});
