import { useBuyerFeed, useFeedFacets } from '@fayda/api-client';
import { AppText, Button, Card, ChipGroup, TextField, useTheme } from '@fayda/ui';
import { FEED_SORTS, type FeedSort } from '@fayda/domain';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, View } from 'react-native';
import { FeedCard } from '../src/feed-card';
import { NO_FILTERS, SORT_LABELS, activeFilterCount, filtersToParams, type Filters } from '../src/feed-filters';

/** Search and filters over every live listing. Words are matched against title, category, tags, description and shop. */
export default function SearchScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [text, setText] = useState('');
  const [typed, setTyped] = useState(''); // what is sent: the box, a moment after the person stops typing
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const facets = useFeedFacets();

  useEffect(() => {
    const t = setTimeout(() => setTyped(text), 350);
    return () => clearTimeout(t);
  }, [text]);

  const { params, errors } = useMemo(() => filtersToParams(typed, filters), [typed, filters]);
  const feed = useBuyerFeed(params);
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];
  const { fetchNextPage, isFetchNextPageError: moreFailed } = feed;
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }));
  const count = activeFilterCount(filters);
  const searching = !!typed.trim() || count > 0;

  return (
    <FlatList
      testID="search-list"
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      keyboardShouldPersistTaps="handled"
      data={items}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <FeedCard item={item} onOpen={() => router.push(`/listing/${item.id}` as never)} />}
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (feed.hasNextPage && !feed.isFetchingNextPage) void fetchNextPage();
      }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <AppText weight="extrabold" size={20}>Search</AppText>
          <TextField label="What are you looking for?" value={text} onChangeText={setText} placeholder="kurta, cotton, a shop name…" autoCapitalize="none" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Button title={count ? `Filters (${count})` : 'Filters'} variant="outline" onPress={() => setShowFilters((s) => !s)} accessibilityLabel={showFilters ? 'Hide filters' : 'Show filters'} /></View>
            {count ? <View style={{ flex: 1 }}><Button title="Clear filters" variant="ghost" onPress={() => setFilters(NO_FILTERS)} /></View> : null}
          </View>
          {showFilters ? (
            <Card>
              <ChipGroup label="Sort by" options={FEED_SORTS} value={[filters.sort]} onChange={(v) => set('sort', (v[0] ?? 'NEWEST') as FeedSort)} format={(s) => SORT_LABELS[s]} />
              {facets.data ? <ChipGroup label="Category" options={facets.data.categories} value={filters.category ? [filters.category] : []} onChange={(v) => set('category', v[0] === filters.category ? null : (v[0] ?? null))} /> : null}
              {facets.data?.sizes.length ? <ChipGroup label="Size in stock" options={facets.data.sizes} value={filters.size ? [filters.size] : []} onChange={(v) => set('size', v[0] === filters.size ? null : (v[0] ?? null))} format={(s) => s.toUpperCase()} /> : null}
              <ChipGroup label="Bargaining" options={['Open to offers']} value={filters.acceptsOffers ? ['Open to offers'] : []} onChange={(v) => set('acceptsOffers', v.length > 0 && !filters.acceptsOffers)} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}><TextField label="Lowest price" value={filters.minRupees} onChangeText={(v) => set('minRupees', v)} keyboardType="number-pad" prefix="₹" error={errors.minPrice} /></View>
                <View style={{ flex: 1 }}><TextField label="Highest price" value={filters.maxRupees} onChangeText={(v) => set('maxRupees', v)} keyboardType="number-pad" prefix="₹" error={errors.maxPrice} /></View>
              </View>
            </Card>
          ) : null}
          {feed.isPending ? (
            <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Searching…</AppText></View></Card>
          ) : feed.isError ? (
            <Card>
              <AppText weight="bold">Can’t search right now</AppText>
              <AppText tone="muted" size={13}>{feed.error.message}</AppText>
              <Button title="Try again" onPress={() => void feed.refetch()} />
            </Card>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        feed.isSuccess ? (
          <Card>
            <AppText weight="bold">{searching ? 'No listings match' : 'Nothing listed yet'}</AppText>
            <AppText tone="muted" size={13}>{searching ? 'Try fewer or different words, or clear the filters. Every word you type has to match.' : 'Sellers haven’t published anything yet.'}</AppText>
            {searching ? <Button title="Ask sellers for it" variant="outline" onPress={() => router.push('/request/new' as never)} /> : null}
          </Card>
        ) : undefined
      }
      ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : moreFailed ? <Button title="Couldn’t load more. Try again" variant="outline" onPress={() => void fetchNextPage()} /> : undefined}
    />
  );
}
