import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import CommentsScreen from '../app/comments/[id]';
import ListingsScreen from '../app/(tabs)/listings';
import { fakeApi, json, managerWith, problem, renderWith, sellerListing, type Route } from './utils';

const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
const ID = '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70';
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({ id: '0f7a9a6e-3b5c-4f8e-9d1a-2b3c4d5e6f70' }) }));

let fetchMock: jest.Mock;
const signedIn = () => managerWith('seller', fetchMock, { missing: [] });
beforeEach(() => {
  fetchMock = jest.fn();
  mockRouter.push.mockClear();
});
const c = (n: number, over: Record<string, unknown> = {}) => ({ id: `c0000000-0000-4000-8000-00000000000${n}`, text: `Question ${n}`, at: Date.now() - n * 3_600_000, author: { name: 'Asha', shop: false }, mine: false, canRemove: true, ...over });
const LISTING = `GET /v1/seller/listings/${ID}`;
const COMMENTS = `/v1/seller/listings/${ID}/comments`;

describe('seller listings: social numbers', () => {
  it('shows likes, saves and comments as counts, and opens the comments screen', async () => {
    const live = sellerListing({ id: ID, title: 'Live kurta', status: 'ACTIVE', publishedAt: 5, stats: { likes: 1250, saves: 7, comments: 1 } });
    fakeApi({ 'GET /v1/seller/listings': () => json({ items: [live, sellerListing({ id: 'd', status: 'DRAFT', title: 'Draft' })] }), 'GET /v1/seller/negotiations': () => json({ items: [] }) }, fetchMock);
    await renderWith(signedIn(), <ListingsScreen />);
    expect(await screen.findByText('♥ 1.2k · Saved 7 · 1 comment')).toBeOnTheScreen();
    expect(screen.getAllByText(/Saved/)).toHaveLength(1); // a draft has no social numbers
    await act(async () => void fireEvent.press(screen.getByLabelText('Comments on Live kurta')));
    expect(mockRouter.push).toHaveBeenCalledWith(`/comments/${ID}`);
  });
});

describe('seller comments screen', () => {
  const serve = (extra: Record<string, Route> = {}) => fakeApi({ [LISTING]: () => json(sellerListing({ id: ID, status: 'ACTIVE' })), ...extra }, fetchMock);

  it('lists the comments with first names, marks the shop’s own, and says when there are none', async () => {
    serve({ [`GET ${COMMENTS}`]: () => json({ items: [c(1), c(2, { text: 'We ship in 2 days.', author: { name: 'Kiran Studio', shop: true }, mine: true })], nextCursor: null, total: 2 }) });
    await renderWith(signedIn(), <CommentsScreen />);
    expect(await screen.findByText('Question 1')).toBeOnTheScreen();
    expect(screen.getByText('Cotton kurta · 2 comments')).toBeOnTheScreen();
    expect(screen.getByText('Your shop')).toBeOnTheScreen();
    expect(screen.getByText('1 h ago')).toBeOnTheScreen();
  });

  it('shows an empty state and an error with retry', async () => {
    let fail = true;
    serve({ [`GET ${COMMENTS}`]: () => (fail ? problem(500, 'INTERNAL', undefined, 'Server fell over') : json({ items: [], nextCursor: null, total: 0 })) });
    await renderWith(signedIn(), <CommentsScreen />);
    expect(await screen.findByText('Can’t load comments')).toBeOnTheScreen();
    fail = false;
    await act(async () => void fireEvent.press(screen.getByText('Try again')));
    expect(await screen.findByText('No comments yet')).toBeOnTheScreen();
  });

  it('replies as the shop with a client key and an idempotency key; a refusal shows next to the box', async () => {
    const seen: { body: { text: string; clientKey: string }; idem: string }[] = [];
    let list = [c(1)];
    serve({
      [`GET ${COMMENTS}`]: () => json({ items: list, nextCursor: null, total: list.length }),
      [`POST ${COMMENTS}`]: (r) => {
        const x = r as never as { body: { text: string; clientKey: string }; headers: Record<string, string> };
        seen.push({ body: x.body, idem: x.headers['idempotency-key']! });
        if (seen.length === 1) return problem(400, 'VALIDATION', { text: 'Keep comments under 300 characters.' });
        list = [c(9, { text: x.body.text, author: { name: 'Kiran Studio', shop: true }, mine: true }), ...list];
        return json(list[0], 201);
      },
    });
    await renderWith(signedIn(), <CommentsScreen />);
    await screen.findByText('Question 1');
    await act(async () => void fireEvent.changeText(screen.getByLabelText('Reply as your shop'), 'Yes, it is true to size.'));
    await act(async () => void fireEvent.press(screen.getByText('Post reply')));
    expect(await screen.findByText('Keep comments under 300 characters.')).toBeOnTheScreen();
    await act(async () => void fireEvent.press(screen.getByText('Post reply')));
    expect(await screen.findByText('Yes, it is true to size.')).toBeOnTheScreen();
    expect(seen[1]).toEqual(seen[0]); // retrying the same words keeps the keys
    expect(screen.getByLabelText('Reply as your shop').props.value).toBe('');
  });

  it('removes any comment after asking', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => void buttons?.find((b) => b.style === 'destructive')?.onPress?.());
    let list = [c(1, { text: 'Buy from my shop instead' })];
    const calls: string[] = [];
    serve({
      [`GET ${COMMENTS}`]: () => json({ items: list, nextCursor: null, total: list.length }),
      [`DELETE /v1/seller/comments/${c(1).id}`]: () => (calls.push('DELETE'), (list = []), new Response(null, { status: 204 })),
    });
    await renderWith(signedIn(), <CommentsScreen />);
    await act(async () => void fireEvent.press(await screen.findByLabelText('Remove comment by Asha')));
    expect(alert).toHaveBeenCalledWith('Remove this comment?', 'It disappears for everyone. The buyer is not told.', expect.any(Array));
    await waitFor(() => expect(calls).toEqual(['DELETE']));
    expect(await screen.findByText('No comments yet')).toBeOnTheScreen();
  });

  it('loads the next page when the end is reached', async () => {
    serve({
      [`GET ${COMMENTS}`]: () => json({ items: [c(1)], nextCursor: 'n1', total: 2 }),
      [`GET ${COMMENTS}?cursor=n1`]: () => json({ items: [c(2)], nextCursor: null, total: 2 }),
    });
    await renderWith(signedIn(), <CommentsScreen />);
    await screen.findByText('Question 1');
    await act(async () => void fireEvent(screen.getByTestId('comments-list'), 'endReached'));
    expect(await screen.findByText('Question 2')).toBeOnTheScreen();
  });
});
