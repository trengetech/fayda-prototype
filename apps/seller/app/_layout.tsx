import { ApiProvider, SessionProvider, notificationHref, usePushRegistration, useRealtime, useSession } from '@fayda/api-client';
import { AppText, Button, PrototypeBanner, ThemeProvider, fontAssets, useTheme } from '@fayda/ui';
import { useFonts } from 'expo-font';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { APP_LABEL, VARIANT } from '../src/config';
import { getPushToken, targetFromPush } from '../src/push';
import { sessionManager } from '../src/session';

void SplashScreen.preventAutoHideAsync();

/** Which screens a person can reach depends on whether they are signed in and have finished their profile. */
function Routes() {
  const { colors } = useTheme();
  const { status, profile } = useSession();
  useRealtime();
  usePushRegistration('seller', getPushToken);
  const router = useRouter();
  // Tapping a push opens what it is about (also when the tap is what started the app).
  useEffect(() => {
    if (status !== 'signedIn') return;
    const go = (r: Notifications.NotificationResponse | null) => {
      const t = targetFromPush(r?.notification.request.content.data);
      if (t) router.push(notificationHref('seller', t) as never);
    };
    void Notifications.getLastNotificationResponseAsync().then(go).catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener(go);
    return () => sub.remove();
  }, [status, router]);
  useEffect(() => {
    void sessionManager.restore();
  }, []);
  if (status === 'restoring' || status === 'offline')
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: colors.surface }}>
        <AppText weight="bold">{status === 'offline' ? 'Can’t reach the server' : 'Signing you in…'}</AppText>
        {status === 'offline' ? <><AppText tone="muted">Check your internet connection and try again.</AppText><Button title="Try again" onPress={() => void sessionManager.restore()} /></> : null}
      </View>
    );
  const signedIn = status === 'signedIn';
  const complete = signedIn && !!profile?.complete;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.surface } }}>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
      <Stack.Protected guard={signedIn && !complete}>
        <Stack.Screen name="onboarding" />
      </Stack.Protected>
      <Stack.Protected guard={complete}>
        <Stack.Screen name="index" />
        <Stack.Screen name="listings" />
        <Stack.Screen name="listing/[id]" />
        <Stack.Screen name="comments/[id]" />
        <Stack.Screen name="offers" />
        <Stack.Screen name="offer/[id]" />
        <Stack.Screen name="orders" />
        <Stack.Screen name="order/[id]" />
        <Stack.Screen name="messages" />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="requests" />
        <Stack.Screen name="shop" />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="blocked" />
        <Stack.Screen name="dashboard" />
        <Stack.Screen name="gallery" />
      </Stack.Protected>
    </Stack>
  );
}

function Shell() {
  const { colors, scheme } = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.surface }}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <PrototypeBanner>
        <Text style={{ color: colors.accentStrong, fontSize: 11, fontWeight: '700' }}>{APP_LABEL} · {VARIANT}</Text>
      </PrototypeBanner>
      <Routes />
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
        <SessionProvider manager={sessionManager}>
          <ApiProvider client={sessionManager.client}>
            <Shell />
          </ApiProvider>
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
