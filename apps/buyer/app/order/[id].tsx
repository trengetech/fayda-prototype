import { useApiClient, useBuyerOrder } from '@fayda/api-client';
import { formatRupees } from '@fayda/domain';
import { AppText, Badge, Button, Card, Screen, SectionTitle, Steps, Thumb, useTheme, type StepItem } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { ContactCard } from '../../src/contact-card';
import { STEPS, isClosed, reached, statusTone, stepLabel, openExternal } from '../../src/orders';
import { PaymentCard } from '../../src/payment-card';
import { ReviewSection } from '../../src/review-section';

/**
 * One order, view only. Only the seller moves an order forward (D6), so there is nothing here that changes its status: the
 * buyer sees the timeline, how to pay while the order is waiting, how to reach the seller, and can review once it is confirmed.
 */
export default function OrderScreen() {
  const { colors } = useTheme();
  const { id, rate } = useLocalSearchParams<{ id: string; rate?: string }>();
  const router = useRouter();
  const client = useApiClient();
  const q = useBuyerOrder(id ?? null);

  if (q.isPending) return <Screen><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading your order…</AppText></View></Screen>;
  if (q.isError)
    return (
      <Screen>
        <AppText weight="bold">Can’t load this order</AppText>
        <AppText tone="muted">{q.error.message}</AppText>
        <Button title="Try again" onPress={() => void q.refetch()} />
      </Screen>
    );
  const o = q.data;
  const done = reached(o);
  const closed = isClosed(o);
  const ship = o.shipment;
  const web = o.channel === 'WEBSITE';
  const NOTES: Record<string, string> = { PLACED: web ? 'Buyer used the deal on the website' : 'Buyer pays the seller directly', CONFIRMED: web ? 'Seller found the order on their website' : 'Seller confirmed the payment arrived', SHIPPED: 'Optional: seller adds courier or delivery details', DELIVERED: 'Seller marked it delivered' };
  const steps: StepItem[] = STEPS.map((st, i) => ({ key: st, title: stepLabel(st, o.channel), note: NOTES[st] ?? '', done: i < done }));

  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Thumb size={72} source={o.listing.coverUrl ? { uri: client.resolveUrl(o.listing.coverUrl) } : null} label={`Photo of ${o.listing.title}`} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText tone="muted" size={12}>Order {o.number}</AppText>
          <AppText weight="extrabold">{o.listing.title}</AppText>
          <AppText tone="muted" size={12}>Size {o.listing.variantLabel} · {o.channel === 'WEBSITE' ? 'bought on the seller’s website' : 'paid to the seller directly'}</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
            <Badge label={o.statusLabel} tone={statusTone(o.status)} />
            <AppText weight="extrabold" size={13}>{formatRupees(o.price)}</AppText>
          </View>
          {o.priceSource === 'NEGOTIATED' ? <AppText tone="muted" size={11}>agreed price (listed {formatRupees(o.listPrice)})</AppText> : null}
        </View>
      </View>

      <Card>
        <SectionTitle>Progress</SectionTitle>
        <Steps steps={[...steps, ...(closed ? [{ key: 'closed', title: o.status === 'EXPIRED' ? 'Expired' : 'Cancelled by seller', note: o.status === 'EXPIRED' ? 'Expired: the seller did not confirm in time' : (o.cancelText ?? 'Cancelled'), done: false, failed: true }] : [])]} />
        {o.status === 'PLACED' ? <AppText tone="muted" size={11}>The seller has until the confirm time to respond. If they don’t, the order expires.</AppText> : null}
      </Card>

      {ship ? (
        <Card>
          <AppText weight="bold">Shipment</AppText>
          {ship.courier ? <AppText>Courier: {ship.courier}</AppText> : null}
          {ship.trackingNo ? <AppText selectable>Tracking number: {ship.trackingNo}</AppText> : null}
          {ship.expectedDate ? <AppText>Expected: {ship.expectedDate}</AppText> : null}
          {ship.note ? <AppText tone="muted">{ship.note}</AppText> : null}
          {ship.trackingUrl ? <Button title="Track shipment" variant="outline" onPress={() => void openExternal(ship.trackingUrl as string)} /> : null}
        </Card>
      ) : null}

      {o.payment ? <PaymentCard orderId={o.id} payment={o.payment} /> : null}

      {o.channel === 'WEBSITE' && o.dealAccess ? (
        <Card>
          <AppText weight="bold">{o.dealAccess.type === 'CODE' ? 'Your coupon code' : 'Your discount link'}</AppText>
          <AppText selectable>{o.dealAccess.value}</AppText>
          <AppText tone="muted" size={12}>Use this on the seller’s website. The seller confirms here when they receive your website order.</AppText>
        </Card>
      ) : null}

      {o.address ? (
        <Card>
          <AppText weight="bold">Delivery address</AppText>
          <AppText>{o.address.name}</AppText>
          <AppText tone="muted">{[o.address.line1, o.address.line2, `${o.address.city} ${o.address.pin}`, o.address.state].filter(Boolean).join(', ')}</AppText>
        </Card>
      ) : null}

      <ContactCard order={o} />

      {o.buyAgain ? (
        <Button
          title="Buy again"
          variant="outline"
          onPress={() => router.push((o.buyAgain?.variantId ? `/checkout?listingId=${o.buyAgain.listingId}&variantId=${o.buyAgain.variantId}` : `/listing/${o.buyAgain?.listingId}`) as never)}
        />
      ) : null}

      <ReviewSection key={o.review ? `${o.review.id}-${o.review.editedAt ?? ''}` : 'new'} order={o} startOpen={rate === '1'} />
    </Screen>
  );
}
