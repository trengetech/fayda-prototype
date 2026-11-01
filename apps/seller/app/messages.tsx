import { useThreads } from '@fayda/api-client';
import { AppText, Badge, Button, Card, PersonRow, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';

/** Every chat with a buyer: one per order, and one per buyer request that led to a sale. */
export default function MessagesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const threads = useThreads('seller');
  const items = threads.data?.items ?? [];
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={threads.isRefetching} onRefresh={() => void threads.refetch()} />}
    >
      {threads.isPending ? (
        <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading messages…</AppText></View></Card>
      ) : threads.isError ? (
        <Card>
          <AppText weight="bold">Can’t load your messages</AppText>
          <AppText tone="muted" size={13}>{threads.error.message}</AppText>
          <Button title="Try again" onPress={() => void threads.refetch()} />
        </Card>
      ) : items.length ? (
        <View style={{ marginHorizontal: -16, marginTop: -12 }}>
          {items.map((t) => (
            <PersonRow key={t.id} name={t.otherName} subtitle={t.title} preview={t.lastMessage} unread={t.unread > 0} accessibilityLabel={`Open chat ${t.title}`} onPress={() => router.push(`/chat/${t.id}` as never)} right={t.unread ? <Badge label={`${t.unread} new`} tone="accent" /> : undefined} />
          ))}
        </View>
      ) : (
        <Card>
          <AppText weight="bold">No messages yet</AppText>
          <AppText tone="muted" size={13}>A chat opens with every order, so you can sort out details with the buyer.</AppText>
        </Card>
      )}
    </ScrollView>
  );
}
