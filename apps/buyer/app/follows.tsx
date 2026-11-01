import { useFollowedShops, useSetFollow } from '@fayda/api-client';
import { AppText, Button, Card, PersonRow, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, View } from 'react-native';

/** The shops this buyer follows, newest follow first. Tapping a shop opens its page; Unfollow removes it from the list. */
export default function FollowsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const q = useFollowedShops();
  const set = useSetFollow();
  const shops = q.data?.pages.flatMap((p) => p.items) ?? [];
  const { fetchNextPage } = q;

  return (
    <FlatList
      testID="follows-list"
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      data={shops}
      keyExtractor={(s) => s.id}
      refreshing={q.isRefetching && !q.isFetchingNextPage}
      onRefresh={() => void q.refetch()}
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (q.hasNextPage && !q.isFetchingNextPage) void fetchNextPage();
      }}
      renderItem={({ item }) => (
        <View style={{ marginHorizontal: -16 }}>
          <PersonRow name={item.name} subtitle={`@${item.handle} · ${item.area}`} accessibilityLabel={`Open shop ${item.name}`} onPress={() => router.push(`/shop/${item.handle}` as never)}
            right={<Button title="Unfollow" size="sm" variant="outline" block={false} accessibilityLabel={`Unfollow ${item.name}`} disabled={set.isPending} onPress={() => set.mutate({ sellerId: item.id, follow: false })} />} />
        </View>
      )}
      ListEmptyComponent={
        q.isPending ? (
          <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading…</AppText></View></Card>
        ) : q.isError ? (
          <Card><AppText weight="bold">Can’t load your shops</AppText><AppText tone="muted" size={13}>{q.error.message}</AppText><Button title="Try again" onPress={() => void q.refetch()} /></Card>
        ) : (
          <Card><AppText weight="bold">You don’t follow any shops yet</AppText><AppText tone="muted" size={13}>Follow a shop from its page or from a reel and it shows up here.</AppText><Button title="Browse reels" onPress={() => router.push('/feed' as never)} /></Card>
        )
      }
    />
  );
}
