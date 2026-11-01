import { useApiClient, useBuyerOrders } from '@fayda/api-client';
import type { BuyerOrder } from '@fayda/contracts/schemas';
import { formatRupees } from '@fayda/domain';
import { AppText, Badge, Button, Card, ChipGroup, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { FILTERS, matchesFilter, statusTone, type Filter } from '../../src/orders';

function Row({ o }: { o: BuyerOrder }) {
  const { colors } = useTheme();
  const client = useApiClient();
  const router = useRouter();
  const open = () => router.push(`/order/${o.id}` as never);
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open order ${o.number}`} onPress={open} style={{ flexDirection: 'row', gap: 12 }}>
        {o.listing.coverUrl ? <Image source={{ uri: client.resolveUrl(o.listing.coverUrl) }} style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.border }} accessibilityIgnoresInvertColors /> : <View style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.border }} />}
        <View style={{ flex: 1, gap: 2 }}>
          <AppText weight="bold" numberOfLines={1}>{o.listing.title}</AppText>
          <AppText tone="muted" size={12}>{o.number} · Size {o.listing.variantLabel} · {o.seller.name}</AppText>
          <AppText>{formatRupees(o.price)}</AppText>
          {/* Below the text, not beside it: a long status ("Waiting for the seller to confirm your payment") would squeeze the title into a narrow column. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            <Badge label={o.statusLabel} tone={statusTone(o.status)} />
            {o.unread > 0 ? <Badge label={`${o.unread} new ${o.unread === 1 ? 'message' : 'messages'}`} tone="accent" /> : null}
          </View>
        </View>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {o.buyAgain ? <View style={{ flex: 1 }}><Button title="Buy again" size="sm" variant="outline" onPress={() => router.push((o.buyAgain?.variantId ? `/checkout?listingId=${o.buyAgain.listingId}&variantId=${o.buyAgain.variantId}` : `/listing/${o.buyAgain?.listingId}`) as never)} /></View> : null}
        {o.canReview && !o.review ? <View style={{ flex: 1 }}><Button title="Rate seller" size="sm" variant="outline" onPress={() => router.push(`/order/${o.id}?rate=1` as never)} /></View> : null}
      </View>
    </Card>
  );
}

/** Every order this buyer has placed, newest first, with a filter and an unread-message badge per row. */
export default function OrdersScreen() {
  const { colors } = useTheme();
  const orders = useBuyerOrders();
  const [filter, setFilter] = useState<Filter>('All');
  const items = (orders.data?.items ?? []).filter((o) => matchesFilter(o, filter));
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} />}
    >
      <ChipGroup label="Show" options={FILTERS} value={[filter]} onChange={(v) => v[0] && setFilter(v[0])} />
      {orders.isPending ? (
        <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading your orders…</AppText></View></Card>
      ) : orders.isError ? (
        <Card>
          <AppText weight="bold">Can’t load your orders</AppText>
          <AppText tone="muted" size={13}>{orders.error.message}</AppText>
          <Button title="Try again" onPress={() => void orders.refetch()} />
        </Card>
      ) : items.length ? (
        items.map((o) => <Row key={o.id} o={o} />)
      ) : (
        <Card>
          <AppText weight="bold">{filter === 'All' ? 'No orders yet' : `No ${filter.toLowerCase()} orders`}</AppText>
          <AppText tone="muted" size={13}>{filter === 'All' ? 'When you buy something, it shows up here.' : 'Try another filter.'}</AppText>
        </Card>
      )}
    </ScrollView>
  );
}
