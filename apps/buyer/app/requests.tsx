import { useBuyerRequests } from '@fayda/api-client';
import { AppText, Badge, Button, Card, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';

/** Your requests, with how many sellers have replied. */
export default function RequestsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const q = useBuyerRequests();
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText weight="extrabold" size={20}>Your requests</AppText>
        <Button title="New request" size="sm" onPress={() => router.push('/request/new' as never)} />
      </View>
      {q.isPending ? (
        <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading your requests…</AppText></View></Card>
      ) : q.isError ? (
        <Card>
          <AppText weight="bold">Can’t load your requests</AppText>
          <AppText tone="muted" size={13}>{q.error.message}</AppText>
          <Button title="Try again" onPress={() => void q.refetch()} />
        </Card>
      ) : q.data.items.length ? (
        q.data.items.map((r) => (
          <Card key={r.id}>
            <Pressable accessibilityRole="button" accessibilityLabel={`Open request ${r.title}`} onPress={() => router.push(`/request/${r.id}` as never)} style={{ gap: 2 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                <AppText weight="bold" numberOfLines={1} style={{ flex: 1 }}>{r.title}</AppText>
                <Badge label={r.status === 'OPEN' ? 'Open' : r.status === 'CLOSED' ? 'Closed' : 'Expired'} tone={r.status === 'OPEN' ? 'accent' : 'info'} />
              </View>
              <AppText tone="muted" size={12}>{r.category} · sent to {r.reachedCount} {r.reachedCount === 1 ? 'seller' : 'sellers'} · {r.responses.length} {r.responses.length === 1 ? 'reply' : 'replies'}</AppText>
            </Pressable>
          </Card>
        ))
      ) : (
        <Card>
          <AppText weight="bold">No requests yet</AppText>
          <AppText tone="muted" size={13}>Can’t find what you want? Ask sellers and they’ll reply with what they have.</AppText>
        </Card>
      )}
    </ScrollView>
  );
}
