import { ApiProvider } from '@fayda/api-client';
import { PrototypeBanner, ThemeProvider, fontAssets, useTheme } from '@fayda/ui';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { API_URL, APP_LABEL, VARIANT } from '../src/config';

void SplashScreen.preventAutoHideAsync();

function Shell() {
  const { colors, scheme } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <PrototypeBanner>
        <Text style={{ color: colors.accentStrong, fontSize: 11, fontWeight: '700' }}>{APP_LABEL} · {VARIANT}</Text>
      </PrototypeBanner>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }} />
    </SafeAreaView>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts(fontAssets);
  const ready = loaded || !!error; // if a font fails, show the app in the system font rather than a blank screen
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ApiProvider baseUrl={API_URL}>
          <Shell />
        </ApiProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
