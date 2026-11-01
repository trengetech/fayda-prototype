import { useApiClient, useSellerOrders } from '@fayda/api-client';
import type { SellerOrder } from '@fayda/contracts/schemas';
import { formatRupees, timeLeft } from '@fayda/domain';
import { AppText, Badge, Button, Card, ChipGroup, RowLine, ThumbRow, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { TABS, inTab, statusBadge, tabCounts, type Tab } from '../../src/orders';

const SHORT: Record<string, string> = { PLACED: 'To confirm', CONFIRMED: 'Confirmed', SHIPPED: 'Shipped', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', EXPIRED: 'Expired' };

function Row({ o, onOpen }: { o: SellerOrder; onOpen: () => void }) {
  const client = useApiClient();
  const badge = statusBadge(o);
  return (
    <ThumbRow
      source={o.listing.coverUrl ? { uri: client.resolveUrl(o.listing.coverUrl) } : null}
      title={o.listing.title}
      accessibilityLabel={`Open order ${o.number}`}
      onPress={onOpen}
      badge={<Badge label={SHORT[o.status] ?? badge.label} tone={badge.tone} />}
      lines={
        <>
          <RowLine>{o.number} · Size {o.listing.variantLabel} · {o.buyerName}</RowLine>
          <RowLine strong>{formatRupees(o.price)}{o.priceSource === 'NEGOTIATED' ? ' (agreed price)' : ''}</RowLine>
          <RowLine>{badge.label}</RowLine>
          {o.status === 'PLACED' ? <RowLine>Confirm within {timeLeft(o.confirmBy, Date.now())}</RowLine> : null}
          {o.unread ? <RowLine>{`${o.unread} new`}</RowLine> : null}
        </>
      }
    />
  );
}

/** Orders, by what the seller has to do next. */
export default function OrdersScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const orders = useSellerOrders();
  const [tab, setTab] = useState<Tab>('Needs confirming');
  const all = orders.data?.items ?? [];
  const counts = tabCounts(all);
  const items = all.filter((o) => inTab(o, tab));
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={orders.isRefetching} onRefresh={() => void orders.refetch()} />}
    >
      <ChipGroup label="Show" options={TABS} value={[tab]} onChange={(v) => v[0] && setTab(v[0])} format={(t) => `${t} (${counts[t]})`} />
      {orders.isPending ? (
        <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading orders…</AppText></View></Card>
      ) : orders.isError ? (
        <Card>
          <AppText weight="bold">Can’t load your orders</AppText>
          <AppText tone="muted" size={13}>{orders.error.message}</AppText>
          <Button title="Try again" onPress={() => void orders.refetch()} />
        </Card>
      ) : items.length ? (
        <View style={{ marginHorizontal: -16 }}>{items.map((o) => <Row key={o.id} o={o} onOpen={() => router.push(`/order/${o.id}` as never)} />)}</View>
      ) : (
        <Card>
          <AppText weight="bold">{tab === 'Needs confirming' ? 'Nothing waiting for you' : `No ${tab.toLowerCase()} orders`}</AppText>
          <AppText tone="muted" size={13}>When a buyer orders from you, it shows up here. Confirm within your declared time or the order expires.</AppText>
        </Card>
      )}
    </ScrollView>
  );
}
