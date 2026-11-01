import type { ApiClient } from '@fayda/api-client';
import type { PushTokenInput } from '@fayda/contracts/schemas';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// While the app is open a push shows as a banner; the badge and the list are refreshed by the real-time event.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/**
 * This phone's Expo push token, or null when push is not possible here: no permission, or the build has no Expo project id
 * or (on Android) no Firebase config yet. Works the same on Android and iOS; only the platform name differs.
 */
export async function getPushToken(): Promise<PushTokenInput | null> {
  if (Platform.OS === 'android')
    await Notifications.setNotificationChannelAsync('default', { name: 'Fayda seller', importance: Notifications.AndroidImportance.HIGH });
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) return null;
  const t = await Notifications.getExpoPushTokenAsync({ projectId });
  return { token: t.data, platform: Platform.OS === 'ios' ? 'ios' : 'android' };
}

/** On sign-out: stop pushes to this phone for this person. Best effort; signing out never waits on it for long. */
export async function forgetPushToken(client: ApiClient): Promise<void> {
  try {
    const t = await getPushToken();
    if (t) await client.removePushToken('seller', t);
  } catch {
    // no token, offline or push unavailable: nothing to forget
  }
}

/** Where a tapped push goes: its data carries the kind and id the server sent. */
export function targetFromPush(data: Record<string, unknown> | undefined): { kind: 'ORDER' | 'THREAD' | 'NEGOTIATION' | 'REQUEST' | 'LISTING'; id: string } | null {
  const kind = data?.kind;
  const id = data?.id;
  if (typeof id !== 'string' || typeof kind !== 'string' || !['ORDER', 'THREAD', 'NEGOTIATION', 'REQUEST', 'LISTING'].includes(kind)) return null;
  return { kind: kind as 'ORDER', id };
}
