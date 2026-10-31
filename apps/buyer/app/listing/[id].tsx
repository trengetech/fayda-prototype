import { useBuyerListing } from '@fayda/api-client';
import { formatRupees } from '@fayda/domain';
import { AppText, Badge, Button, Card, useTheme } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, View } from 'react-native';
import { bargainingLabel, NOT_YET, sizeNote } from '../../src/listing-view';
import { MediaCarousel } from '../../src/media-carousel';
import { OfferSheet } from '../../src/offer-sheet';

/** The product page: media, price, sizes and the bargaining label. Make offer works; Buy is shown but does not work yet (orders arrive in M3.4). */
export default function ListingScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useBuyerListing(id ?? null);
  const l = q.data;
  const router = useRouter();
  const [offering, setOffering] = useState(false);

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
            <AppText tone="muted" size={13}>{l.seller.name} · {l.seller.area}, {l.seller.city}</AppText>

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
              <Button title="Buy" disabled onPress={() => {}} />
              {l.bargaining.acceptsOffers && !l.soldOut ? <Button title="Make offer" variant="outline" onPress={() => setOffering((o) => !o)} /> : null}
              <AppText tone="muted" size={12}>{NOT_YET}</AppText>
            </Card>
            {offering && l.bargaining.acceptsOffers ? <OfferSheet listing={l} onSent={(nid) => { setOffering(false); router.push(`/negotiation/${nid}` as never); }} /> : null}
          </View>
        </>
      )}
    </ScrollView>
  );
}
