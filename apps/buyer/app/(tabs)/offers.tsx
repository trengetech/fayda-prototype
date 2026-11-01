import { useApiClient, useBuyerNegotiations } from '@fayda/api-client';
import type { BuyerNegotiation } from '@fayda/contracts/schemas';
import { formatRupees, timeLeft } from '@fayda/domain';
import { AppText, Badge, Button, Card, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { statusBadge } from '../../src/offers';

function Row({ n, onOpen }: { n: BuyerNegotiation; onOpen: () => void }) {
  const { colors } = useTheme();
  const client = useApiClient();
  const badge = statusBadge(n);
  const last = n.offers[n.offers.length - 1];
  return (
    <Card>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open your offer on ${n.listing.title}`} onPress={onOpen} style={{ flexDirection: 'row', gap: 12 }}>
        {n.listing.coverUrl ? (
          <Image source={{ uri: client.resolveUrl(n.listing.coverUrl) }} style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.border }} accessibilityIgnoresInvertColors />
        ) : (
          <View style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: colors.border }} />
        )}
        <View style={{ flex: 1, gap: 2 }}>
          <AppText weight="bold" numberOfLines={1}>{n.listing.title}</AppText>
          <AppText tone="muted" size={12}>Size {n.listing.variantLabel} · {n.listing.sellerName}</AppText>
          <AppText>
            {last ? formatRupees(last.amount) : ''}
            <AppText tone="muted" size={12}> of {formatRupees(n.listing.price)}</AppText>
          </AppText>
          {n.pendingExpiresAt ? <AppText tone="faint" size={12}>Expires in {timeLeft(n.pendingExpiresAt, Date.now())}</AppText> : null}
        </View>
        <Badge label={badge.label} tone={badge.tone} />
      </Pressable>
    </Card>
  );
}

/** Every offer this buyer has made, with the ones the seller has answered first. */
export default function MyOffersScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const offers = useBuyerNegotiations();
  const items = [...(offers.data?.items ?? [])].sort((a, b) => Number(b.canRespond) - Number(a.canRespond) || b.updatedAt - a.updatedAt);
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={offers.isRefetching} onRefresh={() => void offers.refetch()} />}
    >
      {offers.isPending ? (
        <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading your offers…</AppText></View></Card>
      ) : offers.isError ? (
        <Card>
          <AppText weight="bold">Can’t load your offers</AppText>
          <AppText tone="muted" size={13}>{offers.error.message}</AppText>
          <Button title="Try again" onPress={() => void offers.refetch()} />
        </Card>
      ) : items.length ? (
        items.map((n) => <Row key={n.id} n={n} onOpen={() => router.push(`/negotiation/${n.id}` as never)} />)
      ) : (
        <Card>
          <AppText weight="bold">No offers yet</AppText>
          <AppText tone="muted" size={13}>Open a listing that takes offers and tap Make offer.</AppText>
          <Button title="Browse listings" onPress={() => router.push('/' as never)} />
        </Card>
      )}
    </ScrollView>
  );
}
