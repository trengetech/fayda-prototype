import { useApiClient, useSellerNegotiation, useSellerRespond } from '@fayda/api-client';
import type { SellerNegotiation } from '@fayda/contracts/schemas';
import { CLOSE_TEXT, formatRupees, parseRupees, timeLeft } from '@fayda/domain';
import { ActionBar, AppBar, AppText, Badge, Bubble, BubbleText, Button, ButtonRow, ChipGroup, FieldError, SystemNote, TextField, Thumb, describeError, useTheme } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { OFFER_STATUS_LABEL, statusText } from '../../src/offers';

/** On a website listing the seller says which code or link gives the price they are agreeing to. */
function DealAccessFields({ type, value, onType, onValue, error, label }: { type: 'CODE' | 'LINK'; value: string; onType: (t: 'CODE' | 'LINK') => void; onValue: (v: string) => void; error?: string | undefined; label: string }) {
  return (
    <View style={{ gap: 8 }}>
      <ChipGroup label={label} options={['CODE', 'LINK'] as const} value={[type]} onChange={(v) => v[0] && onType(v[0])} format={(t) => (t === 'CODE' ? 'Coupon code' : 'Discount link')} />
      <TextField label={type === 'CODE' ? 'Coupon code' : 'Discount link'} value={value} onChangeText={onValue} autoCapitalize="none" error={error} hint="Your website must give the buyer this price with it." />
    </View>
  );
}

const pctOff = (list: number, amount: number) => Math.round(((list - amount) / list) * 100);

/** The negotiation as a conversation. The seller sees which replies their own rules sent (never shown to the buyer). */
export default function OfferScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const client = useApiClient();
  const query = useSellerNegotiation(id ?? null);
  const respond = useSellerRespond();
  const [counter, setCounter] = useState('');
  const [countering, setCountering] = useState(false);
  const [dealType, setDealType] = useState<'CODE' | 'LINK'>('CODE');
  const [dealValue, setDealValue] = useState('');
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const shell = (title: string, children: React.ReactNode) => (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppBar title={title} onBack={() => router.back()} />
      {children}
    </View>
  );

  if (query.isPending) return shell('Offer', <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', padding: 16 }}><ActivityIndicator color={colors.accent} /><AppText>Loading offer…</AppText></View>);
  if (query.isError)
    return shell(
      'Offer',
      <View style={{ padding: 16, gap: 8 }}>
        <AppText weight="bold">Can’t load this offer</AppText>
        <AppText tone="muted">{query.error.message}</AppText>
        <Button title="Try again" onPress={() => void query.refetch()} />
      </View>,
    );
  const n: SellerNegotiation = query.data;
  const now = Date.now();
  const status = statusText(n);
  const website = n.listing.channel === 'WEBSITE';
  const dealAccess = website ? { type: dealType, value: dealValue.trim() } : null;
  const bounds = n.counterBounds;
  const last = n.offers[n.offers.length - 1];
  const rupees = parseRupees(counter);
  const cover = n.listing.coverUrl ? { uri: client.resolveUrl(n.listing.coverUrl) } : null;
  const run = (action: Parameters<typeof respond.mutate>[0]) => {
    setError(null);
    respond.mutate(action, {
      onSuccess: () => {
        setCounter('');
        setCountering(false);
        setConfirmDecline(false);
      },
      onError: (e) => setError(describeError(e)),
    });
  };

  const footer = (() => {
    if (n.needsReply && last) {
      if (countering && bounds)
        return (
          <>
            {website ? <DealAccessFields type={dealType} value={dealValue} onType={setDealType} onValue={setDealValue} label="Code or link that gives this price on your website" error={error?.fields.dealAccess} /> : null}
            <TextField label="Counter with" prefix="₹" keyboardType="number-pad" value={counter} onChangeText={setCounter} hint={`Your counter must be above ${formatRupees(bounds.minExclusive)} and below ${formatRupees(bounds.maxExclusive)}.`} error={error?.fields.amount} />
            <ButtonRow>
              <Button title="Cancel" variant="outline" onPress={() => { setCountering(false); setCounter(''); setError(null); }} />
              <Button title="Send counter" disabled={rupees == null} loading={respond.isPending} onPress={() => rupees != null && run({ id: n.id, action: 'counter', amount: rupees * 100, dealAccess })} />
            </ButtonRow>
            <FieldError>{error && !Object.keys(error.fields).length ? error.message : undefined}</FieldError>
          </>
        );
      return (
        <>
          <AppText size={13}><AppText weight="extrabold" size={13}>{n.buyerName} offered {formatRupees(last.amount)}</AppText> ({pctOff(n.listing.price, last.amount)}% off) · expires in {timeLeft(last.expiresAt, now)}</AppText>
          {website ? <DealAccessFields type={dealType} value={dealValue} onType={setDealType} onValue={setDealValue} label="How does the buyer get the price?" error={error?.fields.dealAccess} /> : null}
          {confirmDecline ? (
            <>
              <AppText weight="extrabold">Decline this offer?</AppText>
              <ButtonRow>
                <Button title="Keep it" variant="outline" onPress={() => setConfirmDecline(false)} />
                <Button title="Yes, decline" variant="danger" loading={respond.isPending} onPress={() => run({ id: n.id, action: 'decline' })} />
              </ButtonRow>
            </>
          ) : (
            <>
              <ButtonRow>
                <Button title={`Accept ${formatRupees(last.amount)}`} loading={respond.isPending} onPress={() => run({ id: n.id, action: 'accept', dealAccess })} />
                {n.canCounter && bounds ? <Button title="Counter" variant="outline" onPress={() => setCountering(true)} /> : <Button title="Decline" variant="danger" onPress={() => setConfirmDecline(true)} />}
              </ButtonRow>
              {n.canCounter && bounds ? <Button title="Decline offer" variant="ghost" size="sm" onPress={() => setConfirmDecline(true)} /> : <AppText tone="muted" size={12}>This negotiation has reached its offer limit. Accept or decline the last offer.</AppText>}
            </>
          )}
          <FieldError>{error && !Object.keys(error.fields).length ? error.message : undefined}</FieldError>
        </>
      );
    }
    if (n.status === 'OPEN') return <AppText size={13}><AppText weight="extrabold" size={13}>Waiting for the buyer</AppText>{n.pendingExpiresAt ? ` · your counter expires in ${timeLeft(n.pendingExpiresAt, now)}` : ''}</AppText>;
    if (n.status === 'AGREED' && n.agreement)
      return (
        <View style={{ backgroundColor: colors.successTint, borderRadius: 16, padding: 14, gap: 2 }}>
          <AppText weight="extrabold">Agreed at {formatRupees(n.agreement.price)}</AppText>
          <AppText size={12}>One unit is reserved. The buyer has {timeLeft(n.agreement.deadline, now)} to check out.</AppText>
          {n.agreement.dealAccess ? <AppText size={12}>Sent to the buyer: {n.agreement.dealAccess.type === 'CODE' ? 'code' : 'link'} {n.agreement.dealAccess.value}</AppText> : null}
        </View>
      );
    if (n.status === 'PURCHASED') return <Button title="View orders" variant="dark" onPress={() => router.push('/orders' as never)} />;
    return <AppText tone="muted" size={13}>{CLOSE_TEXT[n.closeReason ?? ''] ?? 'Closed'}</AppText>;
  })();

  return shell(
    `Offer from ${n.buyerName}`,
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${n.listing.title}`} onPress={() => router.push(`/listing/${n.listing.id}` as never)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.divider }}>
        <Thumb size={56} source={cover} label={n.listing.title} />
        <View style={{ flex: 1 }}>
          <AppText weight="extrabold" numberOfLines={1}>{n.listing.title}</AppText>
          <AppText tone="muted" size={12}>{n.listing.variantLabel} · listed {formatRupees(n.listing.price)}</AppText>
        </View>
        <Badge label={status.label} tone={status.tone} />
      </Pressable>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <SystemNote>Private negotiation: only you and the buyer see this</SystemNote>
        {n.offers.map((o, i) => {
          const mine = o.by !== 'BUYER';
          const who = mine ? (o.by === 'SYSTEM' ? 'Automatic counter' : 'Your counter') : i === 0 ? 'Buyer’s offer' : 'Buyer’s counter';
          const st = o.status === 'PENDING' ? `Waiting · expires in ${timeLeft(o.expiresAt, now)}` : (OFFER_STATUS_LABEL[o.status] ?? o.status);
          return (
            <Bubble key={o.id} me={mine}>
              <BubbleText me={mine} size={11} dim>{who}</BubbleText>
              <BubbleText me={mine} size={18} weight="extrabold">{formatRupees(o.amount)}</BubbleText>
              <BubbleText me={mine} size={11} dim>{`${pctOff(n.listing.price, o.amount)}% off · ${st}`}</BubbleText>
            </Bubble>
          );
        })}
        {n.status === 'CLOSED' || n.status === 'LAPSED' ? <SystemNote>{CLOSE_TEXT[n.closeReason ?? ''] ?? 'Closed'}</SystemNote> : null}
      </ScrollView>
      <ActionBar>{footer}</ActionBar>
    </>,
  );
}
