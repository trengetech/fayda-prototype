import { useBuyerListing } from '@fayda/api-client';
import { formatRupees } from '@fayda/domain';
import { AppText, Badge, Button, Card, useTheme } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { bargainingLabel, sizeNote } from '../../src/listing-view';
import { openExternal } from '../../src/orders';
import { ratingLine } from '../../src/stars';
import { MediaCarousel } from '../../src/media-carousel';
import { OfferSheet } from '../../src/offer-sheet';

/** The product page: media, price, sizes, seller card and the bargaining label. Buy opens checkout (direct) or the seller's website; Make offer opens the offer sheet. */
export default function ListingScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useBuyerListing(id ?? null);
  const l = q.data;
  const router = useRouter();
  const [offering, setOffering] = useState(false);
  const [siteNote, setSiteNote] = useState<string | null>(null);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ paddingBottom: 24 }}
      refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}
    >
      {q.isPending ? (
        <View style={{ padding: 16 }}><Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading…</AppText></View></Card></View>
      ) : q.isError || !l ? (
        <View style={{ padding: 16 }}>
          <Card>
            <AppText weight="bold">Can’t open this listing</AppText>
            <AppText tone="muted" size={13}>{q.error?.message}</AppText>
            <Button title="Try again" onPress={() => void q.refetch()} />
          </Card>
        </View>
      ) : (
        <>
          <MediaCarousel media={l.media} title={l.title} />
          <View style={{ padding: 16, gap: 12 }}>
            <AppText weight="extrabold" size={20}>{l.title}</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <AppText weight="extrabold" size={18}>{formatRupees(l.price)}</AppText>
              {l.soldOut ? <Badge label="Sold out" tone="danger" /> : <Badge label={bargainingLabel(l.bargaining)} tone={l.bargaining.acceptsOffers ? 'accent' : 'info'} />}
            </View>
            <Card>
              <AppText weight="bold">{l.seller.name}</AppText>
              <AppText tone="muted" size={13}>{l.seller.area}, {l.seller.city} · {ratingLine(l.seller.rating, l.seller.reviewCount)}</AppText>
              <AppText tone="muted" size={13}>Confirms payment within {l.seller.slaConfirmHours === 1 ? '1 hour' : `${l.seller.slaConfirmHours} hours`} · ships within {l.seller.slaShipDays === 1 ? '1 day' : `${l.seller.slaShipDays} days`}</AppText>
              <AppText tone="muted" size={12}>{l.seller.record.completed} of {l.seller.record.orders} orders delivered · {l.seller.record.cancelled} cancelled · {l.seller.record.expired} not confirmed in time</AppText>
            </Card>

            <Card>
              <AppText weight="bold">Sizes</AppText>
              <View style={{ gap: 6 }}>
                {l.variants.map((v) => {
                  const note = sizeNote(v);
                  return (
                    <View key={v.id} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <AppText tone={v.available ? 'ink' : 'faint'}>{v.label}</AppText>
                      {note ? <AppText tone={note === 'Sold out' ? 'danger' : 'accent'} size={12}>{note}</AppText> : null}
                    </View>
                  );
                })}
              </View>
            </Card>

            {l.description ? <AppText>{l.description}</AppText> : null}

            <Card>
              {l.checkout.channel === 'WEBSITE' ? (
                <Button
                  title="Buy on the seller’s website"
                  disabled={l.soldOut || !l.checkout.productUrl}
                  onPress={() => void openExternal(l.checkout.productUrl ?? '').then((ok) => setSiteNote(ok ? null : 'The website could not be opened. Try again from your browser.'))}
                />
              ) : (
                <Button title="Buy" disabled={l.soldOut} onPress={() => router.push(`/checkout?listingId=${l.id}` as never)} />
              )}
              {l.bargaining.acceptsOffers && !l.soldOut ? <Button title="Make offer" variant="outline" onPress={() => setOffering((o) => !o)} /> : null}
              {l.checkout.channel === 'WEBSITE' ? <AppText tone="muted" size={12}>This seller sells on their own website. Fayda does not handle that purchase. To use an agreed price, make an offer and use the code you get.</AppText> : <AppText tone="muted" size={12}>You pay the seller directly. Fayda does not handle payments or delivery.</AppText>}
              {siteNote ? <AppText tone="danger" size={12} accessibilityRole="alert">{siteNote}</AppText> : null}
            </Card>
            {offering && l.bargaining.acceptsOffers ? <OfferSheet listing={l} onSent={(nid) => { setOffering(false); router.push(`/negotiation/${nid}` as never); }} /> : null}
          </View>
        </>
      )}
    </ScrollView>
  );
}
