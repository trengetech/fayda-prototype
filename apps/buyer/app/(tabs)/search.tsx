import { useBuyerFeed, useFeedFacets, useUnreadCount } from '@fayda/api-client';
import { AppBar, AppText, Button, Card, Chip, ChipRow, EmptyState, Icon, IconButton, Sheet, TextField, useTheme } from '@fayda/ui';
import { FEED_SORTS, type FeedSort } from '@fayda/domain';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, TextInput, View } from 'react-native';
import { FeedCard } from '../../src/feed-card';
import { NO_FILTERS, SORT_LABELS, activeFilterCount, filtersToParams, type Filters } from '../../src/feed-filters';

const UNDER = [1000, 2000, 5000] as const; // rupees, the prototype's quick price limits

/** Search and filters over every live listing. Words are matched against title, category, tags, description and shop. */
export default function SearchScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const [text, setText] = useState('');
  const [typed, setTyped] = useState(''); // what is sent: the box, a moment after the person stops typing
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [priceOpen, setPriceOpen] = useState(false);
  const facets = useFeedFacets();
  const unread = useUnreadCount('buyer').data?.unread ?? 0;

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
  const clear = () => { setText(''); setTyped(''); setFilters(NO_FILTERS); };
  const nextSort = () => set('sort', FEED_SORTS[(FEED_SORTS.indexOf(filters.sort) + 1) % FEED_SORTS.length] as FeedSort);
  const underOn = (r: number) => filters.maxRupees === String(r) && !filters.minRupees;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppBar title="Search" right={<IconButton icon="bell" label="Notifications" count={unread} onPress={() => router.push('/notifications' as never)} />} />
      <FlatList
        testID="search-list"
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 14 }}
        columnWrapperStyle={{ gap: 12 }}
        numColumns={2}
        keyboardShouldPersistTaps="handled"
        data={items}
        keyExtractor={(i) => i.id}
        renderItem={({ item }) => <FeedCard item={item} onOpen={() => router.push(`/listing/${item.id}` as never)} />}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void fetchNextPage();
        }}
        ListHeaderComponent={
          <View style={{ gap: 10, marginBottom: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, height: 50, paddingHorizontal: 14, borderWidth: 1.5, borderColor: colors.border, borderRadius: 12 }}>
              <Icon name="search" size={20} color={colors.muted} />
              <TextInput accessibilityLabel="Search" value={text} onChangeText={setText} placeholder="Search kurtas, sarees, shops…" placeholderTextColor={colors.faint} autoCapitalize="none" autoCorrect={false} returnKeyType="search" style={{ flex: 1, color: colors.ink, fontSize: 16, padding: 0 }} />
              {text ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setText('')}><Icon name="x" size={18} color={colors.muted} /></Pressable> : null}
            </View>
            <ChipRow>
              <Chip label="All" selected={!filters.category} onPress={() => set('category', null)} />
              {(facets.data?.categories ?? []).map((c) => <Chip key={c} label={c} selected={filters.category === c} onPress={() => set('category', filters.category === c ? null : c)} />)}
            </ChipRow>
            <ChipRow>
              <Chip accent label="Accepts offers" selected={filters.acceptsOffers} onPress={() => set('acceptsOffers', !filters.acceptsOffers)} />
              {UNDER.map((r) => <Chip key={r} accent label={`Under ₹${r.toLocaleString('en-IN')}`} selected={underOn(r)} onPress={() => setFilters((f) => ({ ...f, minRupees: '', maxRupees: underOn(r) ? '' : String(r) }))} />)}
              <Chip accent label={filters.minRupees || (filters.maxRupees && !UNDER.some((r) => String(r) === filters.maxRupees)) ? 'Price: custom' : 'Price…'} selected={!!filters.minRupees || (!!filters.maxRupees && !UNDER.some((r) => String(r) === filters.maxRupees))} onPress={() => setPriceOpen(true)} />
              <Chip accent label={`Sort: ${SORT_LABELS[filters.sort]}`} selected={filters.sort !== 'BEST'} onPress={nextSort} />
            </ChipRow>
            {facets.data?.sizes.length ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <AppText tone="muted" weight="extrabold" size={12}>Size</AppText>
                <View style={{ flex: 1 }}>
                  <ChipRow>
                    {facets.data.sizes.map((z) => <Chip key={z} accent label={z.toUpperCase()} selected={filters.size === z} onPress={() => set('size', filters.size === z ? null : z)} />)}
                  </ChipRow>
                </View>
              </View>
            ) : null}
            <Pressable accessibilityRole="button" accessibilityLabel="Can’t find it? Ask sellers" onPress={() => router.push((filters.category ? `/request/new?category=${encodeURIComponent(filters.category)}` : '/request/new') as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.accentTint, borderWidth: 1, borderColor: colors.accentTint2 }}>
              <Icon name="megaphone" size={22} />
              <View style={{ flex: 1 }}>
                <AppText weight="extrabold">Can’t find it? Ask sellers</AppText>
                <AppText tone="muted" size={11}>Post a photo and every seller in the category can reply.</AppText>
              </View>
              <View style={{ transform: [{ rotate: '180deg' }] }}><Icon name="back" size={18} /></View>
            </Pressable>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <AppText tone="muted" size={12}>{feed.isSuccess ? `${items.length}${feed.hasNextPage ? '+' : ''} ${items.length === 1 ? 'result' : 'results'}` : ' '}</AppText>
              {searching ? <Pressable accessibilityRole="button" onPress={clear}><AppText tone="accent" weight="bold" size={13}>Clear filters</AppText></Pressable> : null}
            </View>
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
            <EmptyState icon="search" title={searching ? 'No matches' : 'Nothing listed yet'} body={searching ? 'Try fewer filters or a different word. Every word you type has to match.' : 'Sellers haven’t published anything yet.'} action={searching ? <Button title="Clear filters" variant="dark" block={false} onPress={clear} /> : undefined} />
          ) : undefined
        }
        ListFooterComponent={feed.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : moreFailed ? <Button title="Couldn’t load more. Try again" variant="outline" onPress={() => void fetchNextPage()} /> : undefined}
      />
      <Sheet visible={priceOpen} title="Price" onClose={() => setPriceOpen(false)} footer={<Button title="Show results" size="lg" onPress={() => setPriceOpen(false)} />}>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><TextField label="Lowest price" value={filters.minRupees} onChangeText={(v) => set('minRupees', v)} keyboardType="number-pad" prefix="₹" error={errors.minPrice} /></View>
          <View style={{ flex: 1 }}><TextField label="Highest price" value={filters.maxRupees} onChangeText={(v) => set('maxRupees', v)} keyboardType="number-pad" prefix="₹" error={errors.maxPrice} /></View>
        </View>
      </Sheet>
    </View>
  );
}
