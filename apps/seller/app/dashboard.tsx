import { useSellerDashboard } from '@fayda/api-client';
import type { DashboardWindow } from '@fayda/contracts/schemas';
import { AppText, Button, Card, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { formatDuration } from '../src/format';

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

/** The seller's own numbers: what needs them now, the last 7 and 30 days, and the public record buyers see. */
export default function DashboardScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const q = useSellerDashboard();
  const d = q.data;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
    >
      <AppText weight="extrabold" size={20}>Dashboard</AppText>
      {q.isPending ? <ActivityIndicator color={colors.accent} /> : null}
      {q.isError ? (
        <Card>
          <AppText weight="bold">Can’t load the dashboard</AppText>
          <AppText tone="muted" size={13}>{q.error.message}</AppText>
          <Button title="Try again" onPress={() => void q.refetch()} />
        </Card>
      ) : null}
      {d ? (
        <>
          <Card>
            <AppText weight="bold">Needs you</AppText>
            <Button title={d.needsConfirm ? `${d.needsConfirm} ${d.needsConfirm === 1 ? 'order' : 'orders'} to confirm` : 'No orders waiting'} variant={d.needsConfirm ? 'primary' : 'outline'} onPress={() => router.push('/orders' as never)} />
            <Button title={d.needsReply ? `${d.needsReply} ${d.needsReply === 1 ? 'offer needs' : 'offers need'} a reply` : 'No offers waiting'} variant={d.needsReply ? 'primary' : 'outline'} onPress={() => router.push('/offers' as never)} />
          </Card>
          {d.windows.map((w) => <WindowCard key={w.days} w={w} />)}
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
          <AppText tone="muted" size={12}>Listing views are not counted yet, so reach is shown as likes, saves and comments. “Delivered” counts orders now delivered that changed in that period.</AppText>
        </>
      ) : null}
    </ScrollView>
  );
}
