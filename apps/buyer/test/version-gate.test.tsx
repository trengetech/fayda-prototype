import { CONTRACT_LEVEL } from '@fayda/contracts/schemas';
import { screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { VersionGate } from '../src/version-gate';
import { fakeApi, json, managerWith, renderWith } from './utils';

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
});
const meta = (over: Record<string, unknown> = {}) => json({ environment: 'development', version: '0.0.0', providers: [], apiLevel: CONTRACT_LEVEL, minClientLevel: { buyer: 1, seller: 1 }, ...over });
const show = async (metaAnswer: () => Response) => {
  fakeApi({ 'GET /v1/meta': metaAnswer }, fetchMock);
  await renderWith(managerWith('buyer', fetchMock, { missing: [] }), <VersionGate><Text>the app</Text></VersionGate>);
};

describe('buyer version gate', () => {
  it('shows the app when the server accepts this version', async () => {
    await show(() => meta());
    expect(await screen.findByText('the app')).toBeOnTheScreen();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('update-required')).toBeNull();
    expect(screen.queryByTestId('version-note')).toBeNull();
  });

  it('replaces the app with “please update” when the server needs a newer version', async () => {
    await show(() => meta({ minClientLevel: { buyer: CONTRACT_LEVEL + 1, seller: 1 } }));
    expect(await screen.findByText('Please update Fayda Buyer')).toBeOnTheScreen();
    expect(screen.queryByText('the app')).toBeNull();
  });

  it('only the buyer’s own minimum counts', async () => {
    await show(() => meta({ minClientLevel: { buyer: 1, seller: CONTRACT_LEVEL + 1 } }));
    expect(await screen.findByText('the app')).toBeOnTheScreen();
    expect(screen.queryByTestId('update-required')).toBeNull();
  });

  it('keeps the app and adds a note when the server is older than the app (an old server sends no levels)', async () => {
    await show(() => json({ environment: 'development', version: '0.0.0', providers: [] }));
    expect(await screen.findByTestId('version-note')).toBeOnTheScreen();
    expect(screen.getByText('the app')).toBeOnTheScreen();
  });

  it('never blocks the app because the check itself failed', async () => {
    await show(() => json({ title: 'x', status: 500, code: 'INTERNAL' }, 500));
    expect(await screen.findByText('the app')).toBeOnTheScreen();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('update-required')).toBeNull();
  });
});
