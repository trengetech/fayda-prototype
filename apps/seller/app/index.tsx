import { NetworkError, useHealth, useMeta, useSellerNegotiations, useSellerOrders, useSellerRequests, useThreads, useUnreadCount } from '@fayda/api-client';
import { AppText, Badge, Button, Card, useTheme } from '@fayda/ui';
import { Link, useRouter } from 'expo-router';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { AccountCard } from '../src/account-card';
import { API_URL, APP_LABEL, SHOW_GALLERY } from '../src/config';

/** Environment status: connects to the API through the typed client and shows loading, error with retry, or success. */
export default function StatusScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const health = useHealth();
  const meta = useMeta();
  const waiting = useSellerNegotiations().data?.needsReply ?? 0;
  const needsConfirm = useSellerOrders().data?.needsConfirm ?? 0;
  const unread = useThreads('seller').data?.unread ?? 0;
  const newRequests = useSellerRequests().data?.newCount ?? 0;
  const notifUnread = useUnreadCount('seller').data?.unread ?? 0;
  const refetch = () => void Promise.all([health.refetch(), meta.refetch()]);
  const error = health.error ?? meta.error;
  const loading = (health.isPending || meta.isPending) && !error;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={health.isRefetching || meta.isRefetching} onRefresh={refetch} />}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <AppText weight="extrabold" size={20}>Fayda {APP_LABEL}</AppText>
        <Button title={unread ? `Messages (${unread})` : 'Messages'} size="sm" variant="outline" onPress={() => router.push('/messages' as never)} />
      </View>
      <AppText tone="muted" size={12}>API: {API_URL}</AppText>
      <AccountCard />
      {needsConfirm || unread || newRequests ? (
        <Card>
          <AppText weight="bold">Needs you</AppText>
          {needsConfirm ? <Button title={`${needsConfirm} ${needsConfirm === 1 ? 'order needs' : 'orders need'} confirming`} onPress={() => router.push('/orders' as never)} /> : null}
          {unread ? <Button title={`${unread} unread ${unread === 1 ? 'message' : 'messages'}`} variant="outline" onPress={() => router.push('/messages' as never)} /> : null}
          {newRequests ? <Button title={`${newRequests} new buyer ${newRequests === 1 ? 'request' : 'requests'}`} variant="outline" onPress={() => router.push('/requests' as never)} /> : null}
        </Card>
      ) : null}
      <Button title={notifUnread ? `Notifications (${notifUnread} new)` : 'Notifications'} variant={notifUnread ? 'primary' : 'outline'} onPress={() => router.push('/notifications' as never)} />
      <Button title="Dashboard" variant="outline" onPress={() => router.push('/dashboard' as never)} />
      <Button title={needsConfirm ? `Orders (${needsConfirm} to confirm)` : 'Orders'} size="lg" onPress={() => router.push('/orders' as never)} />
      <Button title={waiting ? `Offers (${waiting} need a reply)` : 'Offers'} size="lg" variant="outline" onPress={() => router.push('/offers' as never)} />
      <Button title={newRequests ? `Requests (${newRequests} new)` : 'Requests'} size="lg" variant="outline" onPress={() => router.push('/requests' as never)} />
      <Button title="Shop and reviews" size="lg" variant="outline" onPress={() => router.push('/shop' as never)} />
      <Button title="My listings" size="lg" variant="outline" onPress={() => router.push('/listings' as never)} />
      <Button title="Blocked people" variant="ghost" onPress={() => router.push('/blocked' as never)} />

      {loading ? (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <ActivityIndicator color={colors.accent} />
            <AppText>Connecting to the API…</AppText>
          </View>
        </Card>
      ) : error ? (
        <Card>
          <Badge label="Can't connect" tone="danger" />
          <AppText weight="bold">{error.message}</AppText>
          <AppText tone="muted" size={12}>
            {error instanceof NetworkError
              ? 'Check your internet connection and try again. If it keeps failing, the server may be down.'
              : 'The server answered, but not with what this app expects.'}
          </AppText>
          <Button title="Retry" onPress={refetch} />
        </Card>
      ) : (
        <>
          <Card>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText weight="bold">API</AppText>
              <Badge label={health.data?.status === 'ok' ? 'Online' : 'Database down'} tone={health.data?.status === 'ok' ? 'success' : 'danger'} />
            </View>
            <AppText tone="muted">Database: {health.data?.database.status}{health.data?.database.latencyMs != null ? ` · ${health.data.database.latencyMs} ms` : ''}</AppText>
            {health.data?.status !== 'ok' && <Button title="Retry" variant="outline" onPress={refetch} />}
          </Card>
          <Card>
            <AppText weight="bold">Environment: {meta.data?.environment} · v{meta.data?.version}</AppText>
            {meta.data?.providers.map((p) => (
              <View key={p.key} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText>{p.key}: {p.name}</AppText>
                <Badge label={p.simulated ? 'Simulated' : 'Real'} tone={p.simulated ? 'accent' : 'success'} />
              </View>
            ))}
          </Card>
        </>
      )}

      {SHOW_GALLERY && (
        <Link href="/gallery" asChild>
          <Button title="Design-system gallery (dev)" variant="outline" />
        </Link>
      )}
    </ScrollView>
  );
}
