import { useApiClient, useSellerListings, useSetListingStatus } from '@fayda/api-client';
import type { SellerListing } from '@fayda/contracts/schemas';
import { formatRupees } from '@fayda/domain';
import { AppText, Badge, Button, Card, ChipGroup, FieldError, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, View } from 'react-native';

const FILTERS = ['All', 'Live', 'Paused', 'Drafts'] as const;
type Filter = (typeof FILTERS)[number];
const STATUS_OF: Record<Filter, SellerListing['status'] | null> = { All: null, Live: 'ACTIVE', Paused: 'PAUSED', Drafts: 'DRAFT' };
const BADGE: Record<SellerListing['status'], { label: string; tone: 'success' | 'info' | 'accent' }> = {
  ACTIVE: { label: 'Live', tone: 'success' },
  PAUSED: { label: 'Paused', tone: 'accent' },
  DRAFT: { label: 'Draft', tone: 'info' },
};
const EMPTY_TEXT: Record<Filter, string> = {
  All: 'Publish your first listing: add a video or photos, sizes, a price and your bargaining rules.',
  Live: 'No live listings. Publish a listing and it goes straight to the buyer feed.',
  Paused: 'No paused listings.',
  Drafts: 'Save a listing as a draft to finish it later.',
};

/** The cover is the first photo, or the cover photo of the first video. */
export const coverOf = (l: SellerListing): string | null => {
  const m = l.media[0];
  return m ? (m.kind === 'image' ? m.url : m.posterUrl) : null;
};

function Row({ l, onOpen }: { l: SellerListing; onOpen: () => void }) {
  const { colors } = useTheme();
  const client = useApiClient();
  const setStatus = useSetListingStatus();
  const cover = coverOf(l);
  const stock = l.variants.reduce((t, v) => t + v.stock, 0);
  const badge = BADGE[l.status];
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${l.title}`} onPress={onOpen} style={{ flexDirection: 'row', gap: 12 }}>
        {cover ? (
          <Image source={{ uri: client.resolveUrl(cover) }} style={{ width: 64, height: 64, borderRadius: 10, backgroundColor: colors.border }} accessibilityRole="image" accessibilityLabel={`Cover of ${l.title}`} accessibilityIgnoresInvertColors />
        ) : (
          <View style={{ width: 64, height: 64, borderRadius: 10, backgroundColor: colors.border }} />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <AppText weight="bold" numberOfLines={1}>{l.title}</AppText>
          <AppText>{formatRupees(l.price)}</AppText>
          <AppText tone="muted" size={12}>{stock} in stock{l.bargaining.mode === 'FIXED' ? '' : ' · takes offers'}</AppText>
        </View>
        <Badge label={badge.label} tone={badge.tone} />
      </Pressable>
      {l.status !== 'DRAFT' ? (
        <View style={{ gap: 4 }}>
          <Button
            title={l.status === 'ACTIVE' ? 'Pause' : 'Resume'}
            variant="outline"
            size="sm"
            loading={setStatus.isPending}
            onPress={() => setStatus.mutate({ id: l.id, status: l.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' })}
          />
          <FieldError>{setStatus.error?.message}</FieldError>
        </View>
      ) : null}
    </Card>
  );
}

/** The seller's listings: live, paused and drafts. */
export default function ListingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const listings = useSellerListings();
  const [filter, setFilter] = useState<Filter>('All');
  const want = STATUS_OF[filter];
  const items = (listings.data ?? []).filter((l) => !want || l.status === want);
  const open = (path: string) => router.push(path as never);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={listings.isRefetching} onRefresh={() => void listings.refetch()} />}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText weight="extrabold" size={20}>My listings</AppText>
        <Button title="New listing" size="sm" onPress={() => open('/listing/new')} />
      </View>
      <ChipGroup label="Show" options={FILTERS} value={[filter]} onChange={(v) => v[0] && setFilter(v[0])} />

      {listings.isPending ? (
        <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading your listings…</AppText></View></Card>
      ) : listings.isError ? (
        <Card>
          <AppText weight="bold">Can’t load your listings</AppText>
          <AppText tone="muted" size={13}>{listings.error.message}</AppText>
          <Button title="Try again" onPress={() => void listings.refetch()} />
        </Card>
      ) : items.length ? (
        items.map((l) => <Row key={l.id} l={l} onOpen={() => open(`/listing/${l.id}`)} />)
      ) : (
        <Card>
          <AppText weight="bold">{filter === 'All' ? 'Nothing here yet' : `No ${filter.toLowerCase()}`}</AppText>
          <AppText tone="muted" size={13}>{EMPTY_TEXT[filter]}</AppText>
          {filter === 'All' || filter === 'Live' || filter === 'Drafts' ? <Button title="New listing" onPress={() => open('/listing/new')} /> : null}
        </Card>
      )}
    </ScrollView>
  );
}
