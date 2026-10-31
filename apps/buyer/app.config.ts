import type { ExpoConfig } from 'expo/config';

type Variant = 'dev' | 'staging' | 'prod';
const variant = (process.env.APP_VARIANT ?? 'dev') as Variant;

// Placeholder package ids until the brand is final. Ids cannot change after a Play Store release.
const v = {
  dev: { suffix: '.dev', name: 'Fayda Buyer (Dev)' },
  staging: { suffix: '.staging', name: 'Fayda Buyer (Staging)' },
  prod: { suffix: '', name: 'Fayda Buyer' },
}[variant];

const config: ExpoConfig = {
  name: v.name,
  slug: 'fayda-buyer',
  scheme: 'faydabuyer',
  version: '0.0.1',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: `com.fayda.buyer${v.suffix}`,
    versionCode: 1,
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#C2410C' },
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-secure-store',
    // Plain-HTTP API addresses (a laptop on the local network) are allowed in dev and staging builds only.
    ['expo-build-properties', { android: { usesCleartextTraffic: variant !== 'prod' } }],
  ],
  experiments: { typedRoutes: true },
  extra: { variant, appLabel: 'Buyer' },
};

export default config;
