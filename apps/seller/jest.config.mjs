/** @type {import('jest').Config} */
export default {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  // ApiProvider owns its QueryClient, whose garbage-collection timers (5 min) would otherwise keep Jest alive after the tests finish.
  forceExit: true,
  testMatch: ['<rootDir>/test/**/*.test.{ts,tsx}'],
};
