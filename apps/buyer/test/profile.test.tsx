import { act, fireEvent, screen } from '@testing-library/react-native';
import ProfileScreen from '../app/(tabs)/profile';
import { json, managerWith, renderWith } from './utils';

const mockRouter = { push: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

let fetchMock: jest.Mock;
beforeEach(() => {
  mockRouter.push.mockClear();
  fetchMock = jest.fn().mockImplementation((url: string) => Promise.resolve(json(String(url).includes('unread') ? { unread: 3 } : { items: [], unread: 2 })));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe('profile tab', () => {
  it('lists everything the old home buttons opened, each with an icon row, and opens it', async () => {
    await renderWith(managerWith('buyer', fetchMock, { missing: [] }), <ProfileScreen />);
    const rows: [string, string][] = [['Notifications', '/notifications'], ['Messages', '/messages'], ['Saved', '/saved'], ['Shops you follow', '/follows'], ['Your requests', '/requests'], ['Delivery addresses', '/addresses'], ['Contact for orders', '/contact'], ['Blocked people', '/blocked'], ['User agreement', '/agreement'], ['App status', '/status']];
    for (const [label, path] of rows) {
      await act(async () => void fireEvent.press(screen.getByLabelText(new RegExp(`^${label}`))));
      expect(mockRouter.push).toHaveBeenLastCalledWith(path);
    }
  });
});
