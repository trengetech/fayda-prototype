import { act } from '@testing-library/react-native';
import { useEffect } from 'react';
import { useImpressionReporter } from '../src/impressions';
import { fakeApi, json, managerWith, renderWith } from './utils';

let fetchMock: jest.Mock;
let report: (id: string, position: number) => void;

function Probe({ ranker }: { ranker: 'SCORED' | undefined }) {
  const r = useImpressionReporter('FOR_YOU', ranker);
  useEffect(() => {
    report = r;
  });
  return null;
}

const posts = () => fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith('/v1/buyer/feed/impressions') && init?.method === 'POST');

beforeEach(() => {
  jest.useFakeTimers();
  fetchMock = jest.fn();
  fakeApi({ 'POST /v1/buyer/feed/impressions': () => new Response(null, { status: 204 }) }, fetchMock);
});
afterEach(() => jest.useRealTimers());

describe('impression reporter', () => {
  it('sends each listing once, in one batch, a few seconds later', async () => {
    await renderWith(managerWith('buyer', fetchMock, { missing: [] }), <Probe ranker="SCORED" />);
    await act(async () => {
      report('a', 0);
      report('b', 1);
      report('a', 0);
    });
    expect(posts()).toHaveLength(0);
    await act(async () => {
      jest.advanceTimersByTime(5100);
    });
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0][1].body)).toEqual({ scope: 'FOR_YOU', ranker: 'SCORED', items: [{ listingId: 'a', position: 0 }, { listingId: 'b', position: 1 }] });
  });
  it('sends nothing while the server has not said which order the page came in', async () => {
    await renderWith(managerWith('buyer', fetchMock, { missing: [] }), <Probe ranker={undefined} />);
    await act(async () => report('a', 0));
    await act(async () => {
      jest.advanceTimersByTime(6000);
    });
    expect(posts()).toHaveLength(0);
  });
  it('sends what is waiting when the screen closes, and a failure does not matter', async () => {
    fakeApi({ 'POST /v1/buyer/feed/impressions': () => json({ title: 'x', status: 500, code: 'INTERNAL', detail: 'no' }, 500) }, fetchMock);
    const view = await renderWith(managerWith('buyer', fetchMock, { missing: [] }), <Probe ranker="SCORED" />);
    await act(async () => report('a', 0));
    await act(async () => {
      view.unmount();
    });
    expect(posts()).toHaveLength(1);
  });
});
