import { useApiClient, useSession, useSessionManager, useThreads, useUnreadCount } from '@fayda/api-client';
import { AppBar, Avatar, ListRow, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { AppText } from '@fayda/ui';
import { SHOW_GALLERY } from '../../src/config';
import { forgetPushToken } from '../../src/push';

/** Profile tab: who is signed in, and everything else a buyer can open (the prototype's Profile screen). */
export default function ProfileScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { user } = useSession();
  const manager = useSessionManager();
  const client = useApiClient();
  const notifUnread = useUnreadCount('buyer').data?.unread ?? 0;
  const messageUnread = useThreads('buyer').data?.unread ?? 0;
  const go = (path: string) => () => router.push(path as never);
  const name = user?.name ?? 'Signed in';
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppBar title="Profile" />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
          <Avatar name={name} size={56} />
          <View style={{ flex: 1 }}>
            <AppText weight="extrabold" size={18}>{name}</AppText>
            <AppText tone="muted" size={13}>+91 {user?.phone}</AppText>
          </View>
        </View>
        <ListRow icon="bell" title="Notifications" count={notifUnread} onPress={go('/notifications')} />
        <ListRow icon="msg" title="Messages" count={messageUnread} onPress={go('/messages')} />
        <ListRow icon="bookmark" title="Saved" onPress={go('/saved')} />
        <ListRow icon="store" title="Shops you follow" onPress={go('/follows')} />
        <ListRow icon="megaphone" title="Your requests" onPress={go('/requests')} />
        <ListRow icon="pin" title="Delivery addresses" onPress={go('/addresses')} />
        <ListRow icon="phone" title="Contact for orders" onPress={go('/contact')} />
        <ListRow icon="shield" title="Blocked people" onPress={go('/blocked')} />
        <ListRow icon="list" title="User agreement" onPress={go('/agreement')} />
        <ListRow icon="clock" title="App status" subtitle="Server connection and environment" onPress={go('/status')} />
        {SHOW_GALLERY ? <ListRow icon="image" title="Design-system gallery (dev)" onPress={go('/gallery')} /> : null}
        <ListRow icon="external" title="Sign out" tone="danger" last right={<View />} onPress={() => void forgetPushToken(client).finally(() => manager.signOut())} />
      </ScrollView>
    </View>
  );
}
