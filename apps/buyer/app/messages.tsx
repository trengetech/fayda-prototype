import { useThreads } from '@fayda/api-client';
import { AppText, Badge, Button, Card, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';

/** Every chat: one per order, and one per request response you said you want. */
export default function MessagesScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const q = useThreads('buyer');
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}>
      {q.isPending ? (
        <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading your messages…</AppText></View></Card>
      ) : q.isError ? (
        <Card>
          <AppText weight="bold">Can’t load your messages</AppText>
          <AppText tone="muted" size={13}>{q.error.message}</AppText>
          <Button title="Try again" onPress={() => void q.refetch()} />
        </Card>
      ) : q.data.items.length ? (
        q.data.items.map((t) => (
          <Card key={t.id}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open chat: ${t.title}`} onPress={() => router.push(`/chat/${t.id}` as never)} style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <AppText weight="bold" numberOfLines={1} style={{ flex: 1 }}>{t.title}</AppText>
                {t.unread > 0 ? <Badge label={`${t.unread} new`} tone="accent" /> : null}
              </View>
              <AppText tone="muted" size={12}>{t.otherName}</AppText>
              {t.lastMessage ? <AppText tone="muted" numberOfLines={1}>{t.lastMessage}</AppText> : null}
            </Pressable>
          </Card>
        ))
      ) : (
        <Card>
          <AppText weight="bold">No messages yet</AppText>
          <AppText tone="muted" size={13}>A chat opens with every order, and when you say you want an item a seller offered for your request.</AppText>
        </Card>
      )}
    </ScrollView>
  );
}
