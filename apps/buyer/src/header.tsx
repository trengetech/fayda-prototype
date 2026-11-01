import { useUnreadCount } from '@fayda/api-client';
import { AppBar, IconButton } from '@fayda/ui';
import { useRouter } from 'expo-router';

/** The bell with the unread count that sits at the right of a main screen's bar (as in the prototype). */
export function NotificationBell() {
  const router = useRouter();
  const unread = useUnreadCount('buyer').data?.unread ?? 0;
  return <IconButton icon="bell" label="Notifications" count={unread} onPress={() => router.push('/notifications' as never)} />;
}

interface HeaderArgs {
  options: { title?: string | undefined };
  back?: unknown;
  navigation: { goBack: () => void };
}

/** The bar shown over a pushed screen: its title and a back button. Screens set `title` in the layout. */
export function stackHeader({ options, back, navigation }: HeaderArgs) {
  return <AppBar title={options.title ?? ''} {...(back ? { onBack: () => navigation.goBack() } : {})} />;
}

/** The bar shown over a tab's first screen: its title and the bell. */
export function tabHeader({ options }: { options: { title?: string | undefined } }) {
  return <AppBar title={options.title ?? ''} right={<NotificationBell />} />;
}
