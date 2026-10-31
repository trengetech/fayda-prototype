import { useApiClient, useSellerOrders } from '@fayda/api-client';
import type { SellerOrder } from '@fayda/contracts/schemas';
import { formatRupees, timeLeft } from '@fayda/domain';
import { AppText, Badge, Button, Card, ChipGroup, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { TABS, inTab, statusBadge, tabCounts, type Tab } from '../src/orders';

function Row({ o, onOpen }: { o: SellerOrder; onOpen: () => void }) {
  const { colors } = useTheme();
  const client = useApiClient();
  const badge = statusBadge(o);
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open order ${o.number}`} onPress={onOpen} style={{ flexDirection: 'row', gap: 12 }}>
        {o.listing.coverUrl ? (
          <Image source={{ uri: client.resolveUrl(o.listing.coverUrl) }} style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.border }} accessibilityIgnoresInvertColors />
        ) : (
          <View style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.border }} />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <AppText weight="bold" numberOfLines={1}>{o.listing.title}</AppText>
          <AppText tone="muted" size={12}>{o.number} · Size {o.listing.variantLabel} · {o.buyerName}</AppText>
          <AppText>{formatRupees(o.price)}{o.priceSource === 'NEGOTIATED' ? <AppText tone="muted" size={12}> (agreed price)</AppText> : null}</AppText>
          {o.status === 'PLACED' ? <AppText tone="faint" size={12}>Confirm within {timeLeft(o.confirmBy, Date.now())}</AppText> : null}
          {/* Below the text, not beside it: a long label such as "Waiting for payment to be confirmed" would squeeze the title and number into a narrow column. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            <Badge label={badge.label} tone={badge.tone} />
            {o.unread ? <Badge label={`${o.unread} new`} tone="accent" /> : null}
          </View>
        </View>
      </Pressable>
    </Card>
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
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText weight="extrabold" size={20}>Orders</AppText>
        <Button title={orders.data?.unread ? `Messages (${orders.data.unread})` : 'Messages'} size="sm" variant="outline" onPress={() => router.push('/messages' as never)} />
      </View>
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
        items.map((o) => <Row key={o.id} o={o} onOpen={() => router.push(`/order/${o.id}` as never)} />)
      ) : (
        <Card>
          <AppText weight="bold">{tab === 'Needs confirming' ? 'Nothing waiting for you' : `No ${tab.toLowerCase()} orders`}</AppText>
          <AppText tone="muted" size={13}>When a buyer orders from you, it shows up here. Confirm within your declared time or the order expires.</AppText>
        </Card>
      )}
    </ScrollView>
  );
}
