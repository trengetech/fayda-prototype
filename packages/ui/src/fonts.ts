/* eslint-disable @typescript-eslint/no-require-imports -- Metro bundles assets through require() */
/** Plus Jakarta Sans, bundled with the app (no network fonts). Keys are the fontFamily names used in styles. */
export const fontAssets = {
  'PlusJakartaSans-Regular': require('../assets/fonts/PlusJakartaSans_400Regular.ttf'),
  'PlusJakartaSans-Medium': require('../assets/fonts/PlusJakartaSans_500Medium.ttf'),
  'PlusJakartaSans-SemiBold': require('../assets/fonts/PlusJakartaSans_600SemiBold.ttf'),
  'PlusJakartaSans-Bold': require('../assets/fonts/PlusJakartaSans_700Bold.ttf'),
  'PlusJakartaSans-ExtraBold': require('../assets/fonts/PlusJakartaSans_800ExtraBold.ttf'),
} as const;

export const fontFamily = { regular: 'PlusJakartaSans-Regular', medium: 'PlusJakartaSans-Medium', semibold: 'PlusJakartaSans-SemiBold', bold: 'PlusJakartaSans-Bold', extrabold: 'PlusJakartaSans-ExtraBold' } as const;
