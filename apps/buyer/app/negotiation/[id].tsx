import { useApiClient, useBuyerNegotiation, useBuyerRespond, usePlaceOrder } from '@fayda/api-client';
import { formatAgo, formatRupees, parseRupees, timeLeft } from '@fayda/domain';
import { ActionBar, AppBar, AppText, Badge, Bubble, BubbleText, Button, ButtonRow, Confirm, FieldError, SystemNote, TextField, Thumb, describeError, useTheme } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { CopyButton } from '../../src/copy';
import { statusBadge } from '../../src/offers';
import { newKey, openExternal } from '../../src/orders';

const OFFER_STATUS: Record<string, string> = { PENDING: 'Pending', COUNTERED: 'Countered', ACCEPTED: 'Accepted', DECLINED: 'Declined', EXPIRED: 'Expired', WITHDRAWN: 'Withdrawn', INVALIDATED: 'Closed' };
const pctOff = (list: number, amount: number) => Math.round(((list - amount) / list) * 100);

/** The negotiation as a conversation: your offers on the right, the seller's counters on the left, and the next step pinned below. */
export default function NegotiationScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useApiClient();
  const query = useBuyerNegotiation(id ?? null);
  const respond = useBuyerRespond();
  const place = usePlaceOrder();
  const router = useRouter();
  const orderKey = useRef(newKey());
  const [dealNote, setDealNote] = useState<string | null>(null);
  const [counter, setCounter] = useState('');
  const [countering, setCountering] = useState(false);
  const [confirm, setConfirm] = useState<'withdraw' | 'decline' | null>(null);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const back = () => router.back();

  if (query.isPending)
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <AppBar title="Offer" onBack={back} />
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 16 }}><ActivityIndicator color={colors.accent} /><AppText>Loading your offer…</AppText></View>
      </View>
    );
  if (query.isError)
    return (
      <View style={{ flex: 1, backgroundColor: colors.surface }}>
        <AppBar title="Offer" onBack={back} />
        <View style={{ padding: 16, gap: 8 }}>
          <AppText weight="bold">Can’t load this offer</AppText>
          <AppText tone="muted">{query.error.message}</AppText>
          <Button title="Try again" onPress={() => void query.refetch()} />
        </View>
      </View>
    );
  const n = query.data;
  const now = Date.now();
  const badge = statusBadge(n);
  const last = n.offers[n.offers.length - 1];
  const bounds = n.counterBounds;
  const rupees = parseRupees(counter);
  const cover = n.listing.coverUrl ? { uri: client.resolveUrl(n.listing.coverUrl) } : null;
  const run = (a: Parameters<typeof respond.mutate>[0]) => {
    setError(null);
    respond.mutate(a, { onSuccess: () => { setCounter(''); setCountering(false); }, onError: (e) => setError(describeError(e)) });
  };

  // The conversation: offers and the notes between them, oldest first.
  const items: { at: number; key: string; node: React.ReactNode }[] = [];
  n.offers.forEach((o) => {
    const mine = o.side === 'ME';
    const status = o.status === 'PENDING' ? `Waiting · expires in ${timeLeft(o.expiresAt, now)}` : (OFFER_STATUS[o.status] ?? o.status);
    items.push({
      at: o.at, key: o.id,
      node: (
        <Bubble me={mine}>
          <BubbleText me={mine} size={11} dim>{mine ? 'Your offer' : 'Seller’s counter'}</BubbleText>
          <BubbleText me={mine} size={18} weight="extrabold">{formatRupees(o.amount)}</BubbleText>
          <BubbleText me={mine} size={11} dim>{`${pctOff(n.listing.price, o.amount)}% off · ${status}`}</BubbleText>
        </Bubble>
      ),
    });
  });
  n.events.forEach((e, i) => {
    let text: string | null = null;
    if (e.type === 'ACCEPTED') text = e.actor === 'ME' ? 'You accepted' : 'Seller accepted';
    if (e.type === 'CLOSED') text = n.closeText;
    if (e.type === 'LAPSED') text = 'Checkout window closed. The reserved unit was released';
    if (e.type === 'PURCHASED') text = 'Purchased at the agreed price';
    if (text) items.push({ at: e.at + 1, key: `e${i}`, node: <SystemNote>{`${text} · ${formatAgo(e.at, now)}`}</SystemNote> });
  });
  items.sort((a, b) => a.at - b.at);

  const footer = (() => {
    if (n.status === 'AGREED' && n.channel === 'WEBSITE' && n.agreement)
      return (
        <>
          <View style={{ backgroundColor: colors.successTint, borderRadius: 16, padding: 14, gap: 6 }}>
            <AppText weight="extrabold">Deal agreed: {formatRupees(n.agreement.price)}</AppText>
            {n.agreement.dealAccess ? (
              <>
                <AppText tone="muted" size={11} weight="bold">{n.agreement.dealAccess.type === 'CODE' ? 'Coupon code for the seller’s website' : 'Discount link from the seller'}</AppText>
                <AppText weight="extrabold" size={n.agreement.dealAccess.type === 'CODE' ? 22 : 13} selectable>{n.agreement.dealAccess.value}</AppText>
                <CopyButton value={n.agreement.dealAccess.value} title={n.agreement.dealAccess.type === 'CODE' ? 'Copy code' : 'Copy link'} />
              </>
            ) : null}
            <AppText size={11}>Held for you for {timeLeft(n.agreement.deadline, now)}. Use it on the website before then.</AppText>
          </View>
          {n.agreement.dealAccess?.type === 'LINK' ? <Button title="Open discounted link" icon="send" size="lg" onPress={() => void openExternal(n.agreement?.dealAccess?.value ?? '').then((ok) => setDealNote(ok ? null : 'The link could not be opened. Copy it and open it in your browser.'))} /> : null}
          <Button
            title="I’ve used the code. Record my order"
            size="lg"
            loading={place.isPending}
            onPress={() =>
              place.mutate(
                { input: { negotiationId: n.id }, idempotencyKey: orderKey.current },
                { onSuccess: (o) => { orderKey.current = newKey(); router.replace(`/order/${o.id}` as never); }, onError: (e) => setError(describeError(e)) },
              )
            }
          />
          <AppText tone="muted" size={11}>You pay and get delivery on the seller’s website. This records your order here so the seller can confirm it. Fayda can’t see your purchase on their website.</AppText>
          {dealNote ? <AppText tone="danger" size={12} accessibilityRole="alert">{dealNote}</AppText> : null}
        </>
      );
    if (n.status === 'AGREED' && n.agreement)
      return (
        <>
          <View style={{ backgroundColor: colors.successTint, borderRadius: 16, padding: 14, gap: 2 }}>
            <AppText weight="extrabold">Price agreed: {formatRupees(n.agreement.price)}</AppText>
            <AppText size={12}>One unit is held for you · {timeLeft(n.agreement.deadline, now)} left.</AppText>
            {n.agreement.dealAccess ? <AppText size={12} selectable>{n.agreement.dealAccess.type === 'CODE' ? 'Coupon code' : 'Discount link'}: {n.agreement.dealAccess.value}</AppText> : null}
          </View>
          {n.channel === 'DIRECT' ? <Button title={`Continue · ${formatRupees(n.agreement.price)}`} size="lg" onPress={() => router.push(`/checkout?negotiationId=${n.id}&listingId=${n.listing.id}&variantId=${n.variantId}` as never)} /> : null}
        </>
      );
    if (n.canRespond && last) {
      if (countering && bounds)
        return (
          <>
            <TextField label="Counter with" prefix="₹" keyboardType="number-pad" value={counter} onChangeText={setCounter} hint={`Your counter must be above ${formatRupees(bounds.minExclusive)} and below ${formatRupees(bounds.maxExclusive)}. ${n.offersLeft - 1} ${n.offersLeft - 1 === 1 ? 'offer' : 'offers'} left after this.`} error={error?.fields.amount} />
            <ButtonRow>
              <Button title="Cancel" variant="outline" onPress={() => { setCountering(false); setCounter(''); setError(null); }} />
              <Button title="Send counter" disabled={rupees == null} loading={respond.isPending} onPress={() => rupees != null && run({ id: n.id, action: 'counter', amount: rupees * 100 })} />
            </ButtonRow>
          </>
        );
      return (
        <>
          <AppText size={13}><AppText weight="extrabold" size={13}>Seller countered {formatRupees(last.amount)}</AppText> · respond within {timeLeft(last.expiresAt, now)}{!n.canCounter ? ' · last round: accept or decline' : ''}</AppText>
          <ButtonRow>
            <Button title={`Buy at ${formatRupees(last.amount)}`} loading={respond.isPending} onPress={() => run({ id: n.id, action: 'accept' })} />
            {n.canCounter && bounds ? <Button title="Counter" variant="outline" onPress={() => setCountering(true)} /> : <Button title="Decline" variant="danger" onPress={() => setConfirm('decline')} />}
          </ButtonRow>
          {n.canCounter ? <Button title="Decline counter" variant="ghost" size="sm" onPress={() => setConfirm('decline')} /> : null}
        </>
      );
    }
    if (n.canWithdraw)
      return (
        <>
          <AppText size={13}><AppText weight="extrabold" size={13}>Waiting for the seller</AppText> · your offer expires in {timeLeft(n.pendingExpiresAt ?? last?.expiresAt ?? now, now)}</AppText>
          <Button title="Withdraw offer" variant="outline" onPress={() => setConfirm('withdraw')} />
        </>
      );
    if (n.status === 'PURCHASED') return <Button title="View order" variant="dark" onPress={() => router.push(n.orderId ? (`/order/${n.orderId}` as never) : ('/orders' as never))} />;
    return (
      <>
        <AppText tone="muted" size={13}>{n.closeText ?? n.statusLabel}</AppText>
        <ButtonRow>
          <Button title="View listing" variant="outline" onPress={() => router.replace(`/listing/${n.listing.id}` as never)} />
          <Button title="New offer" onPress={() => router.replace(`/listing/${n.listing.id}?offer=1` as never)} />
        </ButtonRow>
      </>
    );
  })();

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppBar title={`Offer · ${n.listing.sellerName}`} onBack={back} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${n.listing.title}`} onPress={() => router.push(`/listing/${n.listing.id}` as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <Thumb size={56} source={cover} label={n.listing.title} />
        <View style={{ flex: 1 }}>
          <AppText weight="extrabold" numberOfLines={1}>{n.listing.title}</AppText>
          <AppText tone="muted" size={12}>{n.listing.variantLabel} · listed {formatRupees(n.listing.price)}</AppText>
        </View>
        <Badge label={badge.label} tone={badge.tone} />
      </Pressable>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <SystemNote>Private negotiation: only you and the seller see this</SystemNote>
        {items.map((x) => <View key={x.key}>{x.node}</View>)}
      </ScrollView>
      <Confirm
        visible={confirm === 'withdraw'}
        title="Withdraw this offer?"
        body="The seller won’t be able to accept it. You can still buy at the listed price."
        confirmLabel="Withdraw"
        danger
        busy={respond.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); run({ id: n.id, action: 'withdraw' }); }}
      />
      <Confirm
        visible={confirm === 'decline'}
        title="Decline the seller’s counter?"
        body={`This closes the negotiation. You can still buy later at the listed price of ${formatRupees(n.listing.price)}.`}
        confirmLabel="Decline"
        danger
        busy={respond.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); run({ id: n.id, action: 'decline' }); }}
      />
      <ActionBar>
        {footer}
        <FieldError>{error && !Object.keys(error.fields).length ? error.message : undefined}</FieldError>
      </ActionBar>
    </View>
  );
}
