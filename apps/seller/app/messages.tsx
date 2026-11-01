import { useThreads } from '@fayda/api-client';
import { AppText, Badge, Button, Card, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';

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
        items.map((t) => (
          <Card key={t.id}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open chat ${t.title}`} onPress={() => router.push(`/chat/${t.id}` as never)} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
              <View style={{ flex: 1, gap: 2 }}>
                <AppText weight="bold" numberOfLines={1}>{t.title}</AppText>
                <AppText tone="muted" size={12}>{t.otherName}</AppText>
                {t.lastMessage ? <AppText tone="muted" size={13} numberOfLines={1}>{t.lastMessage}</AppText> : null}
              </View>
              {t.unread ? <Badge label={`${t.unread} new`} tone="accent" /> : null}
            </Pressable>
          </Card>
        ))
      ) : (
        <Card>
          <AppText weight="bold">No messages yet</AppText>
          <AppText tone="muted" size={13}>A chat opens with every order, so you can sort out details with the buyer.</AppText>
        </Card>
      )}
    </ScrollView>
  );
}
