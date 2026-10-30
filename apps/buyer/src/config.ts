import Constants from 'expo-constants';

/**
 * Where the API lives. Set EXPO_PUBLIC_API_URL when building. The default is the Android emulator's address for the host machine;
 * a physical phone needs the laptop's LAN address or the deployed HTTPS name.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000';

const extra = (Constants.expoConfig?.extra ?? {}) as { variant?: string; appLabel?: string };
export const VARIANT = extra.variant ?? 'dev';
export const APP_LABEL = extra.appLabel ?? 'App';
/** The design-system gallery is for development only. */
export const SHOW_GALLERY = VARIANT !== 'prod';
