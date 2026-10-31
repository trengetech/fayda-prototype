import type { ExpoConfig } from 'expo/config';

type Variant = 'dev' | 'staging' | 'prod';
const variant = (process.env.APP_VARIANT ?? 'dev') as Variant;

// Placeholder package ids until the brand is final. Ids cannot change after a Play Store release.
const v = {
  dev: { suffix: '.dev', name: 'Fayda Seller (Dev)' },
  staging: { suffix: '.staging', name: 'Fayda Seller (Staging)' },
  prod: { suffix: '', name: 'Fayda Seller' },
}[variant];

const config: ExpoConfig = {
  name: v.name,
  slug: 'fayda-seller',
  scheme: 'faydaseller',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: `com.fayda.seller${v.suffix}`,
    versionCode: 2,
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#111318' },
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-secure-store',
    // Plain-HTTP API addresses (a laptop on the local network) are allowed in dev and staging builds only.
    ['expo-build-properties', { android: { usesCleartextTraffic: variant !== 'prod' } }],
  ],
  experiments: { typedRoutes: true },
  extra: { variant, appLabel: 'Seller' },
};

export default config;
