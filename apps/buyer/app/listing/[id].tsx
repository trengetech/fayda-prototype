import { useBuyerListing, useRecordView, useSetSave } from '@fayda/api-client';
import { formatRupees } from '@fayda/domain';
import { ActionBar, AppBar, AppText, Avatar, Badge, Button, ButtonRow, Card, Chip, Icon, IconButton, RatingChip, useTheme } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';

import { ActivityIndicator, Pressable, RefreshControl, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { sizeNote } from '../../src/listing-view';
import { openExternal } from '../../src/orders';
import { MediaCarousel } from '../../src/media-carousel';
import { OfferSheet } from '../../src/offer-sheet';
import { CommentsSection, ReactionRow } from '../../src/social';

const PAY_NAMES = { UPI: 'UPI', BANK: 'bank transfer', LINK: 'payment link' } as const;
const hours = (h: number) => (h === 1 ? '1 hour' : `${h} hours`);

/**
 * The product page (prototype layout): seller name and Save in the bar, the media, title and price, sizes you pick
 * here, how paying works, the seller card, then comments. Buy now and Make offer are pinned at the bottom.
 */
export default function ListingScreen() {
  const { colors } = useTheme();
  const scroller = useRef<ScrollViewInstance>(null);
  const { id, offer } = useLocalSearchParams<{ id: string; offer?: string }>();
  const q = useBuyerListing(id ?? null);
  useRecordView(id ?? null);
  const l = q.data;
  const router = useRouter();
  const save = useSetSave();
  const [offering, setOffering] = useState(offer === '1'); // a reel's Make offer opens the sheet straight away
  const [siteNote, setSiteNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [sizeErr, setSizeErr] = useState<string | null>(null);
  const only = l && l.variants.length === 1 && l.variants[0]?.available ? l.variants[0].id : null;
  const variantId = picked ?? only;
  const need = (): boolean => {
    if (variantId) return true;
    setSizeErr('Choose a size to continue.');
    return false;
  };
  const back = () => router.back();

  if (q.isPending || q.isError || !l)
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <AppBar title="Listing" onBack={back} />
        <View style={{ padding: 16 }}>
          {q.isPending ? (
            <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading…</AppText></View></Card>
          ) : (
            <Card>
              <AppText weight="bold">Can’t open this listing</AppText>
              <AppText tone="muted" size={13}>{q.error?.message}</AppText>
              <Button title="Try again" onPress={() => void q.refetch()} />
            </Card>
          )}
        </View>
      </View>
    );

  const website = l.checkout.channel === 'WEBSITE';
  const chosen = l.variants.find((v) => v.id === variantId);
  const own = l.ownListing;
  const footer = own ? (
    <AppText tone="muted" size={13}>This is your listing. Manage it in the seller app.</AppText>
  ) : l.soldOut ? (
    <Button title="Sold out" variant="outline" disabled />
  ) : (
    <ButtonRow>
      {website ? (
        <Button title={`Buy on website · ${formatRupees(l.price)}`} variant={l.bargaining.acceptsOffers ? 'dark' : 'primary'} disabled={!l.checkout.productUrl} onPress={() => void openExternal(l.checkout.productUrl ?? '').then((ok) => setSiteNote(ok ? null : 'The website could not be opened. Try again from your browser.'))} />
      ) : (
        <Button title={`Buy now · ${formatRupees(l.price)}`} variant={l.bargaining.acceptsOffers ? 'dark' : 'primary'} onPress={() => need() && router.push(`/checkout?listingId=${l.id}&variantId=${variantId}` as never)} />
      )}
      {l.bargaining.acceptsOffers ? <Button title="Make offer" onPress={() => need() && setOffering(true)} /> : null}
    </ButtonRow>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppBar
        title={l.seller.name}
        onBack={back}
        right={<IconButton icon="bookmark" label={l.saved ? 'Remove from saved' : 'Save'} onPress={() => save.mutate({ listingId: l.id, save: !l.saved })} />}
      />
      <ScrollView ref={scroller} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />} contentContainerStyle={{ paddingBottom: 24 }}>
        <MediaCarousel media={l.media} title={l.title} />
        <View style={{ padding: 16, gap: 14 }}>
          <View style={{ gap: 6 }}>
            <AppText weight="extrabold" size={20} style={{ letterSpacing: -0.4 }}>{l.title}</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <AppText weight="extrabold" size={17}>{formatRupees(l.price)}</AppText>
              {l.soldOut ? <Badge label="Sold out" tone="danger" /> : l.bargaining.acceptsOffers ? <Badge label="Accepts offers" tone="accent" /> : <Badge label="Fixed price" tone="info" />}
              <View style={{ height: 22, paddingHorizontal: 8, borderRadius: 99, backgroundColor: colors.surface2, justifyContent: 'center' }}><AppText weight="extrabold" size={11} tone="muted">{l.category}</AppText></View>
            </View>
            {l.viewCount > 0 ? <AppText tone="faint" size={12} accessibilityLabel={`${l.viewCount} views in the last 30 days`}>{`${l.viewCount} ${l.viewCount === 1 ? 'view' : 'views'} in the last 30 days`}</AppText> : null}
          </View>
          <ReactionRow compact item={l} />

          <View style={{ gap: 8 }}>
            <AppText weight="bold" size={13}>{l.variants.length === 1 ? 'Option' : 'Size'}</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {l.variants.map((v) => <Chip key={v.id} label={v.label} selected={variantId === v.id} disabled={!v.available} onPress={() => { setPicked(v.id); setSizeErr(null); }} />)}
            </View>
            {sizeErr ? <AppText tone="danger" size={12} weight="semibold" accessibilityRole="alert">{sizeErr}</AppText> : chosen && sizeNote(chosen) === 'Few left' ? <AppText tone="muted" size={12}>Only a couple left in this size.</AppText> : null}
          </View>

          {l.description ? <AppText>{l.description}</AppText> : null}
          {l.tags.length ? <AppText tone="muted" size={12}>{l.tags.map((t) => `#${t.replace(/ /g, '')}`).join('  ')}</AppText> : null}

          <View style={{ borderWidth: 1, borderColor: colors.divider, borderRadius: 16, padding: 14 }}>
            <AppText size={12}>
              <AppText weight="extrabold" size={12}>{website ? 'Bought on the seller’s website. ' : 'Pay the seller directly. '}</AppText>
              {website
                ? 'Checkout, payment and delivery happen on their site. If your offer is accepted you get a coupon code or link for that price.'
                : `By ${l.checkout.payMethods.map((m) => PAY_NAMES[m]).join(', ')}. The seller confirms your payment and handles delivery. Fayda doesn’t process payments or ship orders.`}
            </AppText>
          </View>
          {l.bargaining.acceptsOffers ? (
            <View style={{ backgroundColor: colors.accentTint, borderWidth: 1, borderColor: colors.accentTint2, borderRadius: 16, padding: 14 }}>
              <AppText size={12}>
                <AppText weight="extrabold" size={12}>How offers work here: </AppText>
                offers are private between you and the seller. The seller has {l.bargaining.expiryMinutes < 60 ? `${l.bargaining.expiryMinutes} minutes` : hours(l.bargaining.expiryMinutes / 60)} to respond. If they accept, one unit is held for you for 12 hours.
              </AppText>
            </View>
          ) : null}
          {siteNote ? <AppText tone="danger" size={12} accessibilityRole="alert">{siteNote}</AppText> : null}

          <Pressable accessibilityRole="button" accessibilityLabel={`Open shop ${l.seller.name}`} onPress={() => router.push(`/shop/${l.seller.handle}` as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.divider, borderRadius: 16, padding: 14 }}>
            <Avatar name={l.seller.name} />
            <View style={{ flex: 1, gap: 2 }}>
              <AppText weight="extrabold">{l.seller.name}</AppText>
              <AppText tone="muted" size={11}>{l.seller.area}, {l.seller.city}</AppText>
              <RatingChip rating={l.seller.rating} count={l.seller.reviewCount} />
              <AppText tone="muted" size={11}>Confirms payment within {hours(l.seller.slaConfirmHours)} · ships within {l.seller.slaShipDays === 1 ? '1 day' : `${l.seller.slaShipDays} days`}</AppText>
              <AppText tone="muted" size={11}>{l.seller.record.completed} of {l.seller.record.orders} orders delivered · {l.seller.record.cancelled} cancelled · {l.seller.record.expired} not confirmed in time</AppText>
            </View>
            <View style={{ transform: [{ rotate: '180deg' }] }}><Icon name="back" size={18} color={colors.faint} /></View>
          </Pressable>

          {l.bargaining.acceptsOffers ? <OfferSheet listing={l} visible={offering} initialVariantId={variantId} onClose={() => setOffering(false)} onSent={(nid) => { setOffering(false); router.push(`/negotiation/${nid}` as never); }} /> : null}
          <CommentsSection listingId={l.id} onFocusInput={() => setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 300)} />
        </View>
      </ScrollView>
      <ActionBar>{footer}</ActionBar>
    </View>
  );
}
