import { useApiClient, useSellerNegotiations } from '@fayda/api-client';
import type { SellerNegotiation } from '@fayda/contracts/schemas';
import { formatRupees, timeLeft } from '@fayda/domain';
import { AppText, Badge, Button, Card, ChipGroup, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { FILTERS, inFilter, latestOffer, statusText, type Filter } from '../../src/offers';

function Row({ n, onOpen }: { n: SellerNegotiation; onOpen: () => void }) {
  const { colors } = useTheme();
  const client = useApiClient();
  const status = statusText(n);
  const last = latestOffer(n);
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open offer on ${n.listing.title} from ${n.buyerName}`} onPress={onOpen} style={{ flexDirection: 'row', gap: 12 }}>
        {n.listing.coverUrl ? (
          <Image source={{ uri: client.resolveUrl(n.listing.coverUrl) }} style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.border }} accessibilityIgnoresInvertColors />
        ) : (
          <View style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.border }} />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <AppText weight="bold" numberOfLines={1}>{n.listing.title}</AppText>
          <AppText tone="muted" size={12}>Size {n.listing.variantLabel} · {n.buyerName}</AppText>
          <AppText>
            {last ? formatRupees(last.amount) : ''}
            <AppText tone="muted" size={12}> of {formatRupees(n.listing.price)}</AppText>
          </AppText>
          {n.pendingExpiresAt ? <AppText tone="faint" size={12}>Expires in {timeLeft(n.pendingExpiresAt, Date.now())}</AppText> : null}
        </View>
        <Badge label={status.label} tone={status.tone} />
      </Pressable>
    </Card>
  );
}

/** The offer inbox: what buyers have offered, newest activity first. */
export default function OffersScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const offers = useSellerNegotiations();
  const [filter, setFilter] = useState<Filter>('Needs reply');
  const items = (offers.data?.items ?? []).filter((n) => inFilter(n, filter));

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={offers.isRefetching} onRefresh={() => void offers.refetch()} />}
    >
      <ChipGroup label="Show" options={FILTERS} value={[filter]} onChange={(v) => v[0] && setFilter(v[0])} />
      {offers.isPending ? (
        <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading offers…</AppText></View></Card>
      ) : offers.isError ? (
        <Card>
          <AppText weight="bold">Can’t load your offers</AppText>
          <AppText tone="muted" size={13}>{offers.error.message}</AppText>
          <Button title="Try again" onPress={() => void offers.refetch()} />
        </Card>
      ) : items.length ? (
        items.map((n) => <Row key={n.id} n={n} onOpen={() => router.push(`/offer/${n.id}` as never)} />)
      ) : (
        <Card>
          <AppText weight="bold">{filter === 'Needs reply' ? 'Nothing needs a reply' : `No ${filter.toLowerCase()} offers`}</AppText>
          <AppText tone="muted" size={13}>Buyers’ offers on your listings that take offers show up here.</AppText>
        </Card>
      )}
    </ScrollView>
  );
}
