import { useApiClient, useBuyerFeed } from '@fayda/api-client';
import type { BuyerFeed } from '@fayda/contracts/schemas';
import { formatRupees } from '@fayda/domain';
import { AppText, Badge, Button, Card, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, Image, Pressable, View } from 'react-native';

type Item = BuyerFeed['items'][number];

function FeedCard({ item, onOpen }: { item: Item; onOpen: () => void }) {
  const { colors } = useTheme();
  const client = useApiClient();
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title}`} onPress={onOpen} style={{ gap: 8 }}>
        {item.coverUrl ? (
          <Image source={{ uri: client.resolveUrl(item.coverUrl) }} style={{ width: '100%', aspectRatio: 1, borderRadius: 12, backgroundColor: colors.border }} accessibilityRole="image" accessibilityLabel={`Photo of ${item.title}`} accessibilityIgnoresInvertColors />
        ) : (
          <View style={{ width: '100%', aspectRatio: 1, borderRadius: 12, backgroundColor: colors.border }} />
        )}
        <AppText weight="bold" numberOfLines={2}>{item.title}</AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <AppText weight="extrabold">{formatRupees(item.price)}</AppText>
          {item.soldOut ? <Badge label="Sold out" tone="danger" /> : item.acceptsOffers ? <Badge label="Open to offers" tone="accent" /> : null}
          {item.hasVideo ? <Badge label="Video" tone="info" /> : null}
        </View>
        <AppText tone="muted" size={12}>{item.seller.name} · {item.seller.area}</AppText>
      </Pressable>
    </Card>
  );
}

/** A simple scrolling feed of live listings. (Full-screen reels come in a later milestone.) */
export default function FeedScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const feed = useBuyerFeed();
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const { fetchNextPage, isFetchNextPageError: moreFailed } = feed; // read before the early returns narrow `feed`

  if (feed.isPending)
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, padding: 16 }}>
        <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading listings…</AppText></View></Card>
      </View>
    );
  if (feed.isError)
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, padding: 16 }}>
        <Card>
          <AppText weight="bold">Can’t load listings</AppText>
          <AppText tone="muted" size={13}>{feed.error.message}</AppText>
          <Button title="Try again" onPress={() => void feed.refetch()} />
        </Card>
      </View>
    );
  return (
    <FlatList
      testID="feed-list"
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      data={items}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <FeedCard item={item} onOpen={() => router.push(`/listing/${item.id}` as never)} />}
      refreshing={feed.isRefetching && !feed.isFetchingNextPage}
      onRefresh={() => void feed.refetch()}
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (feed.hasNextPage && !feed.isFetchingNextPage) void fetchNextPage();
      }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <AppText weight="extrabold" size={20}>Browse</AppText>
          <Card>
            <AppText weight="bold">Can’t find it? Ask sellers</AppText>
            <AppText tone="muted" size={13}>Describe what you want with a photo. Sellers who sell it can reply.</AppText>
            <Button title="Ask sellers" variant="outline" onPress={() => router.push('/request/new' as never)} />
          </Card>
        </View>
      }
      ListEmptyComponent={
        <Card>
          <AppText weight="bold">Nothing listed yet</AppText>
          <AppText tone="muted" size={13}>Sellers haven’t published anything yet. Pull down to check again.</AppText>
        </Card>
      }
      ListFooterComponent={
        feed.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : moreFailed ? <Button title="Couldn’t load more. Try again" variant="outline" onPress={() => void fetchNextPage()} /> : undefined
      }
    />
  );
}
