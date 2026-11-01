import { useApiClient, useSellerListings, useSellerNegotiations, useSetListingStatus } from '@fayda/api-client';
import type { SellerListing } from '@fayda/contracts/schemas';
import { formatCount, formatRupees } from '@fayda/domain';
import { AppText, Badge, Button, Card, ChipGroup, Confirm, FieldError, RowLine, ThumbRow, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';

const MODE_NAME: Record<string, string> = { BUY_NOW: 'Buy now only', BOTH: 'Buy now + offers' };
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

function Row({ l, onOpen, onComments, openOffers }: { l: SellerListing; onOpen: () => void; onComments: () => void; openOffers: number }) {
  const client = useApiClient();
  const setStatus = useSetListingStatus();
  const [confirmPause, setConfirmPause] = useState(false);
  const cover = coverOf(l);
  const stock = l.variants.reduce((t, v) => t + v.stock, 0);
  const badge = BADGE[l.status];
  const isLive = l.status === 'ACTIVE';
  return (
    <>
      <ThumbRow
        source={cover ? { uri: client.resolveUrl(cover) } : null}
        title={l.title}
        imageLabel={`Cover of ${l.title}`}
        accessibilityLabel={`Open ${l.title}`}
        onPress={onOpen}
        badge={<Badge label={badge.label} tone={badge.tone} />}
        lines={
          <>
            <RowLine strong>{formatRupees(l.price)} · {MODE_NAME[l.bargaining.mode] ?? l.bargaining.mode}</RowLine>
            <RowLine>{stock} in stock{openOffers ? ` · ${openOffers} open ${openOffers === 1 ? 'offer' : 'offers'}` : ''}</RowLine>
            {l.status !== 'DRAFT' ? <RowLine>♥ {formatCount(l.stats.likes)} · Saved {formatCount(l.stats.saves)} · {formatCount(l.stats.comments)} {l.stats.comments === 1 ? 'comment' : 'comments'}</RowLine> : null}
          </>
        }
      >
        {l.status !== 'DRAFT' ? (
          <>
            <Button title={l.stats.comments ? `Comments (${l.stats.comments})` : 'Comments'} accessibilityLabel={`Comments on ${l.title}`} variant="ghost" size="sm" block={false} onPress={onComments} />
            <Button title={isLive ? 'Pause' : 'Resume'} icon={isLive ? 'pause' : 'play'} variant="outline" size="sm" block={false} loading={setStatus.isPending} onPress={() => (isLive ? setConfirmPause(true) : setStatus.mutate({ id: l.id, status: 'ACTIVE' }))} />
          </>
        ) : null}
      </ThumbRow>
      {setStatus.error ? <View style={{ paddingHorizontal: 16 }}><FieldError>{setStatus.error.message}</FieldError></View> : null}
      <Confirm
        visible={confirmPause}
        title="Pause this listing?"
        body="It disappears from the buyer feed and any open offers close. Agreed offers stay valid until their checkout window ends."
        confirmLabel="Pause listing"
        onCancel={() => setConfirmPause(false)}
        onConfirm={() => { setConfirmPause(false); setStatus.mutate({ id: l.id, status: 'PAUSED' }); }}
      />
    </>
  );
}

/** The seller's listings: live, paused and drafts. */
export default function ListingsScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const listings = useSellerListings();
  const negotiations = useSellerNegotiations();
  const openBy = new Map<string, number>();
  for (const n of negotiations.data?.items ?? []) if (n.status === 'OPEN') openBy.set(n.listing.id, (openBy.get(n.listing.id) ?? 0) + 1);
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
      <Button title="New listing" icon="plus" size="sm" block={false} onPress={() => open('/listing/new')} />
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
        <View style={{ marginHorizontal: -16 }}>{items.map((l) => <Row key={l.id} l={l} openOffers={openBy.get(l.id) ?? 0} onOpen={() => open(`/listing/${l.id}`)} onComments={() => open(`/comments/${l.id}`)} />)}</View>
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
