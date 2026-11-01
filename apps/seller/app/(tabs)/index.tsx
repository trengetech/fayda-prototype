import { useApiClient, useSellerDashboard, useSellerRequests, useSession, useThreads, useUnreadCount } from '@fayda/api-client';
import { useQuery } from '@tanstack/react-query';
import type { DashboardWindow, ListingDashboardRow } from '@fayda/contracts/schemas';
import { AppText, Button, Card, Icon, IconButton, StatTile, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { formatDuration } from '../../src/format';

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={{ width: '33%', paddingVertical: 6 }} accessibilityLabel={`${label}: ${value}`}>
      <AppText weight="extrabold" size={20}>{value}</AppText>
      <AppText tone="muted" size={12}>{label}</AppText>
    </View>
  );
}

function WindowCard({ w }: { w: DashboardWindow }) {
  return (
    <Card>
      <AppText weight="bold">Last {w.days} days</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Stat label="Listing views" value={w.views} />
        <Stat label="Offers received" value={w.offersReceived} />
        <Stat label="Offers agreed" value={w.offersAgreed} />
        <Stat label="Orders placed" value={w.ordersPlaced} />
        <Stat label="Orders confirmed" value={w.ordersConfirmed} />
        <Stat label="Orders delivered" value={w.ordersDelivered} />
        <Stat label="Likes" value={w.likes} />
        <Stat label="Saves" value={w.saves} />
        <Stat label="Comments" value={w.comments} />
      </View>
    </Card>
  );
}

function ListingRow({ l, days }: { l: ListingDashboardRow; days: 7 | 30 }) {
  const n = days === 7 ? l.last7 : l.last30;
  return (
    <View style={{ gap: 2, paddingVertical: 8 }} accessibilityLabel={`${l.title}, last ${days} days: ${n.views} views, ${n.likes} likes, ${n.saves} saves, ${n.comments} comments, ${n.offers} offers, ${n.orders} orders`}>
      <AppText weight="bold">{l.title}{l.status === 'PAUSED' ? ' (paused)' : ''}</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <Stat label="Views" value={n.views} />
        <Stat label="Likes" value={n.likes} />
        <Stat label="Saves" value={n.saves} />
        <Stat label="Comments" value={n.comments} />
        <Stat label="Offers" value={n.offers} />
        <Stat label="Orders" value={n.orders} />
      </View>
      <AppText tone="muted" size={12}>{n.conversionPct == null ? 'Conversion: no views yet' : `Conversion: ${n.conversionPct}% (orders per 100 views)`}</AppText>
    </View>
  );
}

/** Each listing's own numbers for the last 7 or 30 days, busiest first. */
function ListingsCard({ rows }: { rows: ListingDashboardRow[] }) {
  const [days, setDays] = useState<7 | 30>(30);
  return (
    <Card>
      <AppText weight="bold">Your listings</AppText>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {([7, 30] as const).map((d) => (
          <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: days === d }} accessibilityLabel={`Show the last ${d} days`} onPress={() => setDays(d)}>
            <AppText weight={days === d ? 'bold' : 'regular'} tone={days === d ? 'accent' : 'muted'}>{`${d} days`}</AppText>
          </Pressable>
        ))}
      </View>
      {rows.length ? rows.map((l) => <ListingRow key={l.id} l={l} days={days} />) : <AppText tone="muted">No live listings yet.</AppText>}
    </Card>
  );
}

/** Seller Home (the prototype's dashboard): who you are, what needs a reply, the numbers, then each listing. */
export default function HomeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const client = useApiClient();
  const { user } = useSession();
  const q = useSellerDashboard();
  const shop = useQuery({ queryKey: ['seller-profile', client.baseUrl], queryFn: () => client.getSellerProfile() });
  const unreadChats = useThreads('seller').data?.unread ?? 0;
  const newRequests = useSellerRequests().data?.newCount ?? 0;
  const notifUnread = useUnreadCount('seller').data?.unread ?? 0;
  const d = q.data;
  const w30 = d?.windows.find((w) => w.days === 30);
  const go = (path: string) => () => router.push(path as never);
  const actions: { n: number; one: string; many: string; path: string; icon: 'box' | 'tag' | 'msg' | 'megaphone' }[] = d
    ? [
        { n: d.needsConfirm, one: 'order to confirm', many: 'orders to confirm', path: '/orders', icon: 'box' },
        { n: d.needsReply, one: 'offer needs your reply', many: 'offers need your reply', path: '/offers', icon: 'tag' },
        { n: unreadChats, one: 'unread message from a buyer', many: 'unread messages from buyers', path: '/messages', icon: 'msg' },
        { n: newRequests, one: 'new buyer request', many: 'new buyer requests', path: '/requests', icon: 'megaphone' },
      ]
    : [];
  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <AppText weight="extrabold" size={20} numberOfLines={1} style={{ flex: 1, letterSpacing: -0.3 }}>{shop.data?.name ?? 'Your shop'}</AppText>
        <IconButton icon="chat" label="Messages" count={unreadChats} onPress={go('/messages')} />
        <IconButton icon="bell" label="Notifications" count={notifUnread} onPress={go('/notifications')} />
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
      >
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <AppText tone="muted">Hello, {user?.name ?? shop.data?.name ?? 'there'}</AppText>
            <AppText weight="extrabold" size={22} style={{ letterSpacing: -0.4 }}>Here’s what needs you</AppText>
          </View>
          <Button title="New listing" icon="plus" size="sm" block={false} onPress={go('/listing/new')} />
        </View>
        {q.isPending ? <ActivityIndicator color={colors.accent} /> : null}
        {q.isError ? (
          <Card>
            <AppText weight="bold">Can’t load your numbers</AppText>
            <AppText tone="muted" size={13}>{q.error.message}</AppText>
            <Button title="Try again" onPress={() => void q.refetch()} />
          </Card>
        ) : null}
        {d ? (
          <>
            {actions.some((x) => x.n) ? (
              actions.filter((x) => x.n).map((x) => (
                <Pressable key={x.path} accessibilityRole="button" accessibilityLabel={`${x.n} ${x.n === 1 ? x.one : x.many}`} onPress={go(x.path)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.accentTint, borderWidth: 1, borderColor: colors.accentTint2 }}>
                  <AppText weight="extrabold" size={22} tone="accent">{x.n}</AppText>
                  <AppText weight="bold" size={15} style={{ flex: 1 }}>{x.n === 1 ? x.one : x.many}</AppText>
                  <View style={{ transform: [{ rotate: '180deg' }] }}><Icon name="back" size={18} color={colors.accent} /></View>
                </Pressable>
              ))
            ) : (
              <Card><AppText tone="muted">You’re all caught up. Nothing is waiting for you.</AppText></Card>
            )}
            {w30 ? (
              <>
                <AppText weight="extrabold" size={15} style={{ marginTop: 6 }}>Last 30 days</AppText>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <StatTile value={w30.views} label="Views" />
                  <StatTile value={w30.likes} label="Likes" />
                  <StatTile value={w30.offersReceived} label="Offers" />
                </View>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <StatTile value={w30.ordersPlaced} label="Orders" />
                  <StatTile value={w30.ordersConfirmed} label="Confirmed" />
                  <StatTile value={w30.ordersDelivered} label="Delivered" />
                </View>
              </>
            ) : null}
            <ListingsCard rows={d.listings} />
            <WindowCard w={d.windows.find((w) => w.days === 7) ?? d.windows[0]!} />
            <Card>
              <AppText weight="bold">Your public record (all time)</AppText>
              <AppText tone="muted" size={12}>This is what buyers see on your shop.</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <Stat label="Orders" value={d.record.orders} />
                <Stat label="Delivered" value={d.record.completed} />
                <Stat label="Cancelled" value={d.record.cancelled} />
                <Stat label="Not confirmed" value={d.record.expired} />
                <Stat label="Median time to confirm" value={formatDuration(d.record.medianConfirmMs)} />
                <Stat label="Rating" value={d.record.rating != null ? `${d.record.rating.toFixed(1)} (${d.record.reviewCount})` : '—'} />
              </View>
            </Card>
            <AppText tone="muted" size={12}>A view is a buyer opening your product page, counted once per person per listing per hour; your own opens are not counted, and views before 1 Nov 2026 were not recorded. “Delivered” counts orders now delivered that changed in that period.</AppText>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
