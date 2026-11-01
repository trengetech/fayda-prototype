import { useApiClient, useBuyerOrders } from '@fayda/api-client';
import type { BuyerOrder } from '@fayda/contracts/schemas';
import { formatRupees } from '@fayda/domain';
import { AppText, Badge, Button, Card, ChipGroup, RowLine, ThumbRow, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { FILTERS, matchesFilter, statusTone, type Filter } from '../../src/orders';

const SHORT: Record<string, string> = { PLACED: 'Awaiting seller', CONFIRMED: 'Confirmed', SHIPPED: 'Shipped', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', EXPIRED: 'Expired' };

function Row({ o }: { o: BuyerOrder }) {
  const client = useApiClient();
  const router = useRouter();
  const open = () => router.push(`/order/${o.id}` as never);
  const again = o.buyAgain ? () => router.push((o.buyAgain?.variantId ? `/checkout?listingId=${o.buyAgain.listingId}&variantId=${o.buyAgain.variantId}` : `/listing/${o.buyAgain?.listingId}`) as never) : null;
  return (
    <ThumbRow
      source={o.listing.coverUrl ? { uri: client.resolveUrl(o.listing.coverUrl) } : null}
      title={o.listing.title}
      accessibilityLabel={`Open order ${o.number}`}
      onPress={open}
      badge={<Badge label={SHORT[o.status] ?? o.statusLabel} tone={statusTone(o.status)} />}
      lines={
        <>
          <RowLine>{o.number} · Size {o.listing.variantLabel} · {o.seller.name}</RowLine>
          <RowLine strong>{formatRupees(o.price)}</RowLine>
          {o.status === 'PLACED' ? <RowLine>{o.statusLabel}</RowLine> : null}
          {o.unread > 0 ? <RowLine>{`${o.unread} new ${o.unread === 1 ? 'message' : 'messages'}`}</RowLine> : null}
        </>
      }
    >
      {again ? <Button title="Buy again" icon="repeat" size="sm" variant="outline" block={false} onPress={again} /> : null}
      {o.canReview && !o.review ? <Button title="Rate seller" icon="star" size="sm" variant="ghost" block={false} onPress={() => router.push(`/order/${o.id}?rate=1` as never)} /> : null}
    </ThumbRow>
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
      contentContainerStyle={{ paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} />}
    >
      <View style={{ padding: 16 }}><ChipGroup label="Show" options={FILTERS} value={[filter]} onChange={(v) => v[0] && setFilter(v[0])} /></View>
      {orders.isPending ? (
        <View style={{ paddingHorizontal: 16 }}><Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading your orders…</AppText></View></Card></View>
      ) : orders.isError ? (
        <View style={{ paddingHorizontal: 16 }}><Card>
          <AppText weight="bold">Can’t load your orders</AppText>
          <AppText tone="muted" size={13}>{orders.error.message}</AppText>
          <Button title="Try again" onPress={() => void orders.refetch()} />
        </Card></View>
      ) : items.length ? (
        items.map((o) => <Row key={o.id} o={o} />)
      ) : (
        <View style={{ paddingHorizontal: 16 }}><Card>
          <AppText weight="bold">{filter === 'All' ? 'No orders yet' : `No ${filter.toLowerCase()} orders`}</AppText>
          <AppText tone="muted" size={13}>{filter === 'All' ? 'When you buy something, it shows up here.' : 'Try another filter.'}</AppText>
        </Card></View>
      )}
    </ScrollView>
  );
}
