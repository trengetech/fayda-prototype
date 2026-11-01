import { useShop, useShopListings } from '@fayda/api-client';
import { AppText, Badge, Button, Card, useTheme } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { FeedCard } from '../../src/feed-card';
import { FollowButton } from '../../src/follow-button';
import { openExternal } from '../../src/orders';
import { ratingLine } from '../../src/stars';

const hours = (n: number) => (n === 1 ? '1 hour' : `${n} hours`);
const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

/** A shop page: who they are, their public order record, follow, and their live listings. Never a phone number. */
export default function ShopScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const shop = useShop(handle ?? null);
  const listings = useShopListings(handle ?? null);
  const items = listings.data?.pages.flatMap((p) => p.items) ?? [];
  const { fetchNextPage, isFetchNextPageError: moreFailed } = listings;
  const s = shop.data;

  if (shop.isPending)
    return <View style={{ flex: 1, backgroundColor: colors.surface, padding: 16 }}><Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading shop…</AppText></View></Card></View>;
  if (shop.isError || !s)
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface, padding: 16 }}>
        <Card>
          <AppText weight="bold">Can’t open this shop</AppText>
          <AppText tone="muted" size={13}>{shop.error?.message}</AppText>
          <Button title="Try again" onPress={() => void shop.refetch()} />
        </Card>
      </View>
    );

  return (
    <FlatList
      testID="shop-list"
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 14 }}
      columnWrapperStyle={{ gap: 12 }}
      numColumns={2}
      data={items}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <FeedCard item={item} onOpen={() => router.push(`/listing/${item.id}` as never)} />}
      refreshing={shop.isRefetching || (listings.isRefetching && !listings.isFetchingNextPage)}
      onRefresh={() => void Promise.all([shop.refetch(), listings.refetch()])}
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (listings.hasNextPage && !listings.isFetchingNextPage) void fetchNextPage();
      }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <AppText weight="extrabold" size={20}>{s.name}</AppText>
              <AppText tone="muted" size={13}>@{s.handle} · {s.area}, {s.city}</AppText>
            </View>
            {s.isOwn ? <Badge label="Your shop" tone="info" /> : <FollowButton sellerId={s.id} shopName={s.name} following={s.following} size="md" />}
          </View>
          <AppText tone="muted" size={13}>{s.followerCount} {s.followerCount === 1 ? 'follower' : 'followers'} · {s.listingCount} {s.listingCount === 1 ? 'listing' : 'listings'}</AppText>
          {s.bio ? <AppText>{s.bio}</AppText> : null}
          <Card>
            <AppText weight="bold">Order record</AppText>
            <AppText tone="muted" size={13}>{ratingLine(s.record.rating, s.record.reviewCount)}</AppText>
            <AppText tone="muted" size={13}>{s.record.completed} of {s.record.orders} orders delivered · {s.record.cancelled} cancelled · {s.record.expired} not confirmed in time</AppText>
            <AppText tone="muted" size={13}>Confirms payment within {hours(s.slaConfirmHours)} · ships within {days(s.slaShipDays)}</AppText>
          </Card>
          <Card>
            <AppText weight="bold">Sells</AppText>
            <AppText tone="muted" size={13}>{s.categories.join(' · ')}</AppText>
            <View style={{ gap: 8 }}>
              <Button title="Find the shop on Google Maps" variant="outline" onPress={() => void openExternal(s.mapsUrl)} />
              {s.googleProfileUrl ? <Button title="Google profile" variant="ghost" onPress={() => void openExternal(s.googleProfileUrl ?? '')} /> : null}
              {s.socialUrl ? <Button title="Instagram / Facebook" variant="ghost" onPress={() => void openExternal(s.socialUrl ?? '')} /> : null}
            </View>
          </Card>
          <AppText weight="bold" size={16}>Listings</AppText>
          {listings.isPending ? <ActivityIndicator color={colors.accent} /> : null}
          {listings.isError ? (
            <Card>
              <AppText weight="bold">Can’t load listings</AppText>
              <Button title="Try again" onPress={() => void listings.refetch()} />
            </Card>
          ) : null}
        </View>
      }
      ListEmptyComponent={listings.isSuccess ? <Card><AppText weight="bold">No live listings</AppText><AppText tone="muted" size={13}>This shop has nothing for sale right now.</AppText></Card> : undefined}
      ListFooterComponent={listings.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : moreFailed ? <Button title="Couldn’t load more. Try again" variant="outline" onPress={() => void fetchNextPage()} /> : undefined}
    />
  );
}
