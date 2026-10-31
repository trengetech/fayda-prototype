import { useSellerNegotiation, useSellerRespond } from '@fayda/api-client';
import type { SellerNegotiation } from '@fayda/contracts/schemas';
import { CLOSE_TEXT, formatRupees, parseRupees, timeLeft } from '@fayda/domain';
import { AppText, Badge, Button, Card, ChipGroup, FieldError, Screen, TextField, describeError } from '@fayda/ui';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { OFFER_STATUS_LABEL, offerLine, statusText } from '../../src/offers';

/** On a website listing the seller says which code or link gives the price they are agreeing to. */
function DealAccessFields({ type, value, onType, onValue, error, label }: { type: 'CODE' | 'LINK'; value: string; onType: (t: 'CODE' | 'LINK') => void; onValue: (v: string) => void; error?: string | undefined; label: string }) {
  return (
    <View style={{ gap: 8 }}>
      <ChipGroup label={label} options={['CODE', 'LINK'] as const} value={[type]} onChange={(v) => v[0] && onType(v[0])} format={(t) => (t === 'CODE' ? 'Coupon code' : 'Discount link')} />
      <TextField label={type === 'CODE' ? 'Coupon code' : 'Discount link'} value={value} onChangeText={onValue} autoCapitalize="none" error={error} hint="Your website must give the buyer this price with it." />
    </View>
  );
}

export default function OfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useSellerNegotiation(id ?? null);
  const respond = useSellerRespond();
  const [counter, setCounter] = useState('');
  const [dealType, setDealType] = useState<'CODE' | 'LINK'>('CODE');
  const [dealValue, setDealValue] = useState('');
  const [confirmDecline, setConfirmDecline] = useState(false);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);

  if (query.isPending) return <Screen><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator /><AppText>Loading offer…</AppText></View></Screen>;
  if (query.isError)
    return (
      <Screen>
        <AppText weight="bold">Can’t load this offer</AppText>
        <AppText tone="muted">{query.error.message}</AppText>
        <Button title="Try again" onPress={() => void query.refetch()} />
      </Screen>
    );
  const n: SellerNegotiation = query.data;
  const status = statusText(n);
  const website = n.listing.channel === 'WEBSITE';
  const dealAccess = website ? { type: dealType, value: dealValue.trim() } : null;
  const bounds = n.counterBounds;
  const run = (action: Parameters<typeof respond.mutate>[0]) => {
    setError(null);
    respond.mutate(action, {
      onSuccess: () => {
        setCounter('');
        setConfirmDecline(false);
      },
      onError: (e) => setError(describeError(e)),
    });
  };
  const rupees = parseRupees(counter);

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <AppText weight="extrabold" size={20}>{n.listing.title}</AppText>
        <AppText tone="muted">Size {n.listing.variantLabel} · listed at {formatRupees(n.listing.price)} · {n.buyerName}</AppText>
        <Badge label={status.label} tone={status.tone} />
        {n.pendingExpiresAt ? <AppText tone="faint" size={12}>This offer expires in {timeLeft(n.pendingExpiresAt, Date.now())}</AppText> : null}
      </View>

      <Card>
        <AppText weight="bold">Timeline</AppText>
        {n.offers.map((o) => (
          <View key={o.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <AppText style={{ flex: 1 }}>{offerLine(o, n.buyerName)}</AppText>
            <AppText tone="muted" size={12}>{OFFER_STATUS_LABEL[o.status] ?? o.status}</AppText>
          </View>
        ))}
        {n.status === 'CLOSED' || n.status === 'LAPSED' ? <AppText tone="muted">{CLOSE_TEXT[n.closeReason ?? ''] ?? 'Closed'}</AppText> : null}
      </Card>

      {n.agreement ? (
        <Card>
          <AppText weight="bold">Agreed at {formatRupees(n.agreement.price)}</AppText>
          <AppText tone="muted" size={13}>One unit is held for the buyer for {timeLeft(n.agreement.deadline, Date.now())}.</AppText>
          {n.agreement.dealAccess ? <AppText tone="muted" size={13}>{n.agreement.dealAccess.type === 'CODE' ? 'Coupon code' : 'Discount link'}: {n.agreement.dealAccess.value}</AppText> : null}
        </Card>
      ) : null}

      {n.needsReply ? (
        <Card>
          <AppText weight="bold">Your reply</AppText>
          {website ? <DealAccessFields type={dealType} value={dealValue} onType={setDealType} onValue={setDealValue} label="How does the buyer get the price?" error={error?.fields.dealAccess} /> : null}
          <Button title="Accept" loading={respond.isPending} onPress={() => run({ id: n.id, action: 'accept', dealAccess })} />
          {n.canCounter && bounds ? (
            <>
              <TextField
                label="Counter with"
                prefix="₹"
                keyboardType="number-pad"
                value={counter}
                onChangeText={setCounter}
                hint={`Between ${formatRupees(bounds.minExclusive + 100)} and ${formatRupees(bounds.maxExclusive - 100)}`}
                error={error?.fields.amount}
              />
              <Button title="Send counter" variant="outline" disabled={rupees == null} loading={respond.isPending} onPress={() => rupees != null && run({ id: n.id, action: 'counter', amount: rupees * 100, dealAccess })} />
            </>
          ) : (
            <AppText tone="muted" size={13}>This negotiation has reached its offer limit. Accept or decline the last offer.</AppText>
          )}
          {confirmDecline ? (
            <View style={{ gap: 8 }}>
              <AppText weight="bold">Decline this offer?</AppText>
              <Button title="Yes, decline" variant="danger" loading={respond.isPending} onPress={() => run({ id: n.id, action: 'decline' })} />
              <Button title="Keep it" variant="ghost" onPress={() => setConfirmDecline(false)} />
            </View>
          ) : (
            <Button title="Decline" variant="ghost" onPress={() => setConfirmDecline(true)} />
          )}
          <FieldError>{error && !Object.keys(error.fields).length ? error.message : undefined}</FieldError>
        </Card>
      ) : null}
    </Screen>
  );
}
