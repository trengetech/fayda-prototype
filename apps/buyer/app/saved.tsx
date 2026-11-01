import { useSavedListings } from '@fayda/api-client';
import { AppText, Button, Card, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { FeedCard } from '../src/feed-card';
import { ReactionRow } from '../src/social';

/** What this buyer saved, newest save first. Private: nobody else sees it. Un-saving takes a listing off the list. */
export default function SavedScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const q = useSavedListings();
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const { fetchNextPage, isFetchNextPageError: moreFailed } = q;
  return (
    <FlatList
      testID="saved-list"
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      data={items}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => (
        <View style={{ gap: 8 }}>
          <FeedCard item={item} onOpen={() => router.push(`/listing/${item.id}` as never)} />
          <ReactionRow item={item} onComments={() => router.push(`/listing/${item.id}` as never)} />
        </View>
      )}
      refreshing={q.isRefetching && !q.isFetchingNextPage}
      onRefresh={() => void q.refetch()}
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (q.hasNextPage && !q.isFetchingNextPage) void fetchNextPage();
      }}
      ListHeaderComponent={<AppText weight="extrabold" size={20}>Saved</AppText>}
      ListEmptyComponent={
        q.isPending ? (
          <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading…</AppText></View></Card>
        ) : q.isError ? (
          <Card><AppText weight="bold">Can’t load your saved listings</AppText><AppText tone="muted" size={13}>{q.error.message}</AppText><Button title="Try again" onPress={() => void q.refetch()} /></Card>
        ) : (
          <Card><AppText weight="bold">Nothing saved yet</AppText><AppText tone="muted" size={13}>Tap Save on a reel or a product page to keep it here.</AppText><Button title="Browse reels" onPress={() => router.push('/feed' as never)} /></Card>
        )
      }
      ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : moreFailed ? <Button title="Couldn’t load more. Try again" variant="outline" onPress={() => void fetchNextPage()} /> : undefined}
    />
  );
}
