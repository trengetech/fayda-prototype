import { useApiClient, useBuyerNegotiations } from '@fayda/api-client';
import type { BuyerNegotiation } from '@fayda/contracts/schemas';
import { formatRupees, timeLeft } from '@fayda/domain';
import { AppText, Badge, Button, Card, RowLine, ThumbRow, fontFamily, useTheme } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { ActivityIndicator, RefreshControl, ScrollView, Text, View } from 'react-native';
import { statusBadge } from '../../src/offers';

function Row({ n, onOpen }: { n: BuyerNegotiation; onOpen: () => void }) {
  const client = useApiClient();
  const badge = statusBadge(n);
  const last = n.offers[n.offers.length - 1];
  return (
    <ThumbRow
      source={n.listing.coverUrl ? { uri: client.resolveUrl(n.listing.coverUrl) } : null}
      title={n.listing.title}
      accessibilityLabel={`Open your offer on ${n.listing.title}`}
      onPress={onOpen}
      badge={<Badge label={badge.label} tone={badge.tone} />}
      lines={
        <>
          <RowLine>Size {n.listing.variantLabel} · {n.listing.sellerName}</RowLine>
          <Text style={{ fontFamily: fontFamily.extrabold, fontSize: 14 }}>
            {last ? formatRupees(last.amount) : ''}
            <Text style={{ fontFamily: fontFamily.regular, fontSize: 12 }}> of {formatRupees(n.listing.price)}</Text>
          </Text>
          {n.pendingExpiresAt ? <RowLine>Expires in {timeLeft(n.pendingExpiresAt, Date.now())}</RowLine> : null}
        </>
      }
    />
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
      contentContainerStyle={{ paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={offers.isRefetching} onRefresh={() => void offers.refetch()} />}
    >
      {offers.isPending ? (
        <View style={{ padding: 16 }}><Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading your offers…</AppText></View></Card></View>
      ) : offers.isError ? (
        <View style={{ padding: 16 }}><Card>
          <AppText weight="bold">Can’t load your offers</AppText>
          <AppText tone="muted" size={13}>{offers.error.message}</AppText>
          <Button title="Try again" onPress={() => void offers.refetch()} />
        </Card></View>
      ) : items.length ? (
        items.map((n) => <Row key={n.id} n={n} onOpen={() => router.push(`/negotiation/${n.id}` as never)} />)
      ) : (
        <View style={{ padding: 16 }}><Card>
          <AppText weight="bold">No offers yet</AppText>
          <AppText tone="muted" size={13}>Open a listing that takes offers and tap Make offer.</AppText>
          <Button title="Browse listings" onPress={() => router.push('/' as never)} />
        </Card></View>
      )}
    </ScrollView>
  );
}
