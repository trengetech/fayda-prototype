import { NetworkError, useBuyerNegotiations, useBuyerOrders, useHealth, useMeta, useThreads } from '@fayda/api-client';
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
  const replies = (useBuyerNegotiations().data?.items ?? []).filter((n) => n.canRespond).length;
  const orderUnread = useBuyerOrders().data?.unread ?? 0;
  const messageUnread = useThreads('buyer').data?.unread ?? 0;
  const refetch = () => void Promise.all([health.refetch(), meta.refetch()]);
  const error = health.error ?? meta.error;
  const loading = (health.isPending || meta.isPending) && !error;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={health.isRefetching || meta.isRefetching} onRefresh={refetch} />}
    >
      <AppText weight="extrabold" size={20}>Fayda {APP_LABEL}</AppText>
      <AppText tone="muted" size={12}>API: {API_URL}</AppText>
      <AccountCard />
      <Button title="Browse listings" onPress={() => router.push('/feed')} />
      <Button title={replies ? `My offers (${replies} to answer)` : 'My offers'} variant="outline" onPress={() => router.push('/offers' as never)} />
      <Button title={orderUnread ? `My orders (${orderUnread} new ${orderUnread === 1 ? 'message' : 'messages'})` : 'My orders'} variant="outline" onPress={() => router.push('/orders' as never)} />
      <Button title={messageUnread ? `Messages (${messageUnread} new)` : 'Messages'} variant="outline" onPress={() => router.push('/messages' as never)} />
      <Button title="Your requests" variant="outline" onPress={() => router.push('/requests' as never)} />
      <Button title="Delivery addresses" variant="ghost" onPress={() => router.push('/addresses' as never)} />
      <Button title="Contact for orders" variant="ghost" onPress={() => router.push('/contact' as never)} />
      <Button title="User agreement" variant="ghost" onPress={() => router.push('/agreement' as never)} />

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
