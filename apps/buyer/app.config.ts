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
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: `com.fayda.buyer${v.suffix}`,
    versionCode: 2,
    // Push on Android needs the Firebase file (founder task, I-32). Without it the app builds and push is simply unavailable.
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
    adaptiveIcon: { foregroundImage: './assets/icon.png', backgroundColor: '#C2410C' },
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-secure-store',
    'expo-video',
    'expo-notifications',
    // Plain-HTTP API addresses (a laptop on the local network) are allowed in dev and staging builds only.
    ['expo-build-properties', { android: { usesCleartextTraffic: variant !== 'prod' } }],
  ],
  experiments: { typedRoutes: true },
  extra: { variant, appLabel: 'Buyer', eas: { projectId: '88bbc327-72fb-4de0-a4e6-52f73fc1233a' } },
};

export default config;
