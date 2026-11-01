/// <reference types="jest" />
import '@testing-library/react-native/matchers';
import { configure } from '@testing-library/react-native';

// The first test in each file pays for loading React Native and compiling modules. On a fresh CI runner (no Jest cache) that
// can take several seconds, so the defaults (5 s per test, 1 s per findBy) fail by timing, not by a real fault.
jest.setTimeout(20_000);
configure({ asyncUtilTimeout: 5_000 });

// The clipboard is native; tests read what was copied from this mock (`jest.requireMock('expo-clipboard').setStringAsync`).
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

// The share link is built from the app's own address scheme; tests read it from this mock.
jest.mock('expo-linking', () => ({ createURL: (path: string) => `faydabuyer://${path}` }));

// Push is native. Tests drive it through these mocks (`jest.requireMock('expo-notifications')`).
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: 'ExponentPushToken[abcdefghijklmnopqrstuv]' })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  AndroidImportance: { HIGH: 4 },
}));
