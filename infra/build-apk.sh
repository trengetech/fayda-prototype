#!/usr/bin/env bash
# Builds a release APK for one app on this machine (needs Android Studio's SDK and JDK 17+).
# Usage: [ARCHS=arm64-v8a APK_SUFFIX=-phone] infra/build-apk.sh buyer|seller [api-url]
# ARCHS defaults to phone + emulator; arm64-v8a alone is phones only (about half the size). GOOGLE_SERVICES_JSON points at the Firebase file for push.
# The API address is baked into the JS bundle at build time (EXPO_PUBLIC_API_URL). The release build is signed with the
# debug key, which is fine for installing on your own phone but not for the Play Store.
set -euo pipefail
APP="${1:?usage: infra/build-apk.sh buyer|seller [api-url]}"
export EXPO_PUBLIC_API_URL="${2:-https://fayda.140-245-219-163.sslip.io}"
export APP_VARIANT="${APP_VARIANT:-dev}" CI=1
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/apps/$APP"
[ -d android ] || npx expo prebuild --platform android --no-install
echo "sdk.dir=${ANDROID_HOME:?set ANDROID_HOME}" > android/local.properties
# Environment variables are not Gradle task inputs, so force the JS bundle to be rebuilt with the current API address.
(cd android && ./gradlew assembleRelease -x lint -PreactNativeArchitectures=${ARCHS:-arm64-v8a,x86_64} --rerun-tasks)
mkdir -p "$ROOT/apks"
VERSION="$(node -p "require('./package.json').version")"
cp android/app/build/outputs/apk/release/app-release.apk "$ROOT/apks/fayda-$APP-$APP_VARIANT-$VERSION${APK_SUFFIX:-}.apk"
echo "APK: apks/fayda-$APP-$APP_VARIANT-$VERSION${APK_SUFFIX:-}.apk ($(du -h "$ROOT/apks/fayda-$APP-$APP_VARIANT-$VERSION${APK_SUFFIX:-}.apk" | cut -f1)), API $EXPO_PUBLIC_API_URL"
