/// <reference types="jest" />
import '@testing-library/react-native/matchers';
import { configure } from '@testing-library/react-native';

// The first test in each file pays for loading React Native and compiling modules. On a fresh CI runner (no Jest cache) that
// can take several seconds, so the defaults (5 s per test, 1 s per findBy) fail by timing, not by a real fault.
jest.setTimeout(20_000);
configure({ asyncUtilTimeout: 5_000 });
