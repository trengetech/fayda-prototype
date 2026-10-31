import type { SecureStorage } from '@fayda/api-client';
import * as SecureStore from 'expo-secure-store';

/** The refresh token is kept in the Android Keystore through expo-secure-store. */
export const secureStorage: SecureStorage = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};
