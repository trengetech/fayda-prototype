import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { json, managerWith, renderWith } from './utils';
import StatusScreen from '../app/index';

jest.mock('expo-router', () => ({ Link: ({ children }: { children: ReactElement }) => children }));

const time = '2026-10-31T10:00:00.000Z';
const health = { status: 'ok', database: { status: 'up', latencyMs: 12 }, time };
const meta = {
  environment: 'development',
  version: '0.0.1',
  providers: [
    { key: 'auth', name: 'dev-otp', simulated: true },
    { key: 'media', name: 'local-disk', simulated: true },
  ],
};
async function renderScreen() {
  return await renderWith(managerWith('seller', fetchMock, { missing: [] }), <StatusScreen />);
}

let fetchMock: jest.Mock;
beforeEach(() => {
  fetchMock = jest.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe('status screen', () => {
  it('shows the loading state while the API has not answered', async () => {
    fetchMock.mockImplementation(() => new Promise(() => {})); // never resolves
    await renderScreen();
    expect(await screen.findByText('Connecting to the API…')).toBeOnTheScreen();
    expect(screen.queryByText('Online')).not.toBeOnTheScreen();
    expect(screen.queryByText("Can't connect")).not.toBeOnTheScreen();
  });

  it('shows the API, database, environment and simulated providers on success', async () => {
    fetchMock.mockImplementation((url: string) => Promise.resolve(json(String(url).endsWith('/v1/health') ? health : meta)));
    await renderScreen();
    expect(await screen.findByText('Online')).toBeOnTheScreen();
    expect(screen.getByText('Database: up · 12 ms')).toBeOnTheScreen();
    expect(screen.getByText('Environment: development · v0.0.1')).toBeOnTheScreen();
    expect(screen.getByText('auth: dev-otp')).toBeOnTheScreen();
    expect(screen.getAllByText('Simulated')).toHaveLength(2);
    expect(screen.queryByText('Connecting to the API…')).not.toBeOnTheScreen();
  });

  it('reports a database outage returned as a 503 health body', async () => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(String(url).endsWith('/v1/health') ? json({ status: 'down', database: { status: 'down', latencyMs: null }, time }, 503) : json(meta)),
    );
    await renderScreen();
    expect(await screen.findByText('Database down')).toBeOnTheScreen();
  });

  it('shows the error with a hint when the network fails, and Retry recovers', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    await renderScreen();
    expect(await screen.findByText("Can't connect")).toBeOnTheScreen();
    expect(screen.getByText(/Check your internet connection/)).toBeOnTheScreen();

    fetchMock.mockImplementation((url: string) => Promise.resolve(json(String(url).endsWith('/v1/health') ? health : meta)));
    await act(async () => {
      fireEvent.press(screen.getByText('Retry'));
    });
    await waitFor(() => expect(screen.getByText('Online')).toBeOnTheScreen());
    expect(screen.queryByText("Can't connect")).not.toBeOnTheScreen();
  });

  it('shows a different hint when the server answers with something unexpected', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ nonsense: true })));
    await renderScreen();
    expect(await screen.findByText("Can't connect")).toBeOnTheScreen();
    expect(screen.getByText(/not with what this app expects/)).toBeOnTheScreen();
  });
});
