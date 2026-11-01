import { notificationHref, useClearNotifications, useDeleteNotification, useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications } from '@fayda/api-client';
import type { Notification } from '@fayda/contracts/schemas';
import { formatAgo } from '@fayda/domain';
import { AppText, Button, Card, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Alert, FlatList, Pressable, View } from 'react-native';

/** The notification centre: newest first, unread marked, tapping one opens what it is about and marks it read. */
export default function NotificationsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const q = useNotifications('buyer');
  const read = useMarkNotificationRead('buyer');
  const readAll = useMarkAllNotificationsRead('buyer');
  const del = useDeleteNotification('buyer');
  const clear = useClearNotifications('buyer');
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = q.data?.pages[0]?.unread ?? 0;

  const open = (n: Notification) => {
    if (!n.read) read.mutate(n.id);
    if (n.target) router.push(notificationHref('buyer', n.target) as never);
  };

  const confirmClear = () => Alert.alert('Clear all notifications?', 'This removes every notification you can see here. It can’t be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear all', style: 'destructive', onPress: () => clear.mutate() },
  ]);

  return (
    <FlatList
      testID="notifications-list"
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      data={items}
      keyExtractor={(n) => n.id}
      refreshing={q.isRefetching && !q.isFetchingNextPage}
      onRefresh={() => void q.refetch()}
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
      }}
      ListHeaderComponent={
        <View style={{ gap: 8, marginBottom: 4 }}>
          <AppText tone="muted" size={13}>{unread ? `${unread} unread` : 'You’re all caught up.'}</AppText>
          {unread ? <Button title="Mark all as read" variant="outline" size="sm" loading={readAll.isPending} onPress={() => readAll.mutate()} /> : null}
          {items.length ? <Button title="Clear all" variant="outline" size="sm" loading={clear.isPending} onPress={confirmClear} /> : null}
          <Button title="Notification settings" variant="outline" size="sm" onPress={() => router.push('/notification-settings' as never)} />
        </View>
      }
      ListEmptyComponent={
        q.isPending ? <ActivityIndicator color={colors.accent} /> : q.isError ? (
          <Card>
            <AppText tone="danger">Can’t load notifications. {q.error.message}</AppText>
            <Button title="Try again" onPress={() => void q.refetch()} />
          </Card>
        ) : <AppText tone="muted">Nothing yet. Offers, orders and messages will show up here.</AppText>
      }
      renderItem={({ item: n }) => (
        <Pressable accessibilityRole="button" accessibilityLabel={`${n.read ? '' : 'Unread. '}${n.title}. ${n.body}`} onPress={() => open(n)}>
          <Card>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: n.read ? 'transparent' : colors.accent }} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText weight={n.read ? 'regular' : 'bold'}>{n.title}</AppText>
                <AppText tone="muted" size={13}>{n.body}</AppText>
                <AppText tone="faint" size={12}>{formatAgo(n.at, Date.now())}</AppText>
                <Pressable accessibilityRole="button" accessibilityLabel={`Delete notification: ${n.title}`} hitSlop={8} disabled={del.isPending} onPress={() => del.mutate(n.id)}>
                  <AppText tone="muted" size={12} weight="bold">Delete</AppText>
                </Pressable>
              </View>
            </View>
          </Card>
        </Pressable>
      )}
    />
  );
}
