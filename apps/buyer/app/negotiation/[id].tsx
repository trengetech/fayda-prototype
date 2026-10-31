import { useBuyerNegotiation, useBuyerRespond } from '@fayda/api-client';
import { formatRupees, parseRupees, timeLeft } from '@fayda/domain';
import { AppText, Badge, Button, Card, FieldError, Screen, TextField, describeError } from '@fayda/ui';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { offerLine, statusBadge } from '../../src/offers';

export default function NegotiationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useBuyerNegotiation(id ?? null);
  const respond = useBuyerRespond();
  const [counter, setCounter] = useState('');
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);

  if (query.isPending) return <Screen><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator /><AppText>Loading your offer…</AppText></View></Screen>;
  if (query.isError)
    return (
      <Screen>
        <AppText weight="bold">Can’t load this offer</AppText>
        <AppText tone="muted">{query.error.message}</AppText>
        <Button title="Try again" onPress={() => void query.refetch()} />
      </Screen>
    );
  const n = query.data;
  const badge = statusBadge(n);
  const last = n.offers[n.offers.length - 1];
  const bounds = n.counterBounds;
  const rupees = parseRupees(counter);
  const run = (a: Parameters<typeof respond.mutate>[0]) => {
    setError(null);
    respond.mutate(a, { onSuccess: () => setCounter(''), onError: (e) => setError(describeError(e)) });
  };

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <AppText weight="extrabold" size={20}>{n.listing.title}</AppText>
        <AppText tone="muted">Size {n.listing.variantLabel} · listed at {formatRupees(n.listing.price)} · {n.listing.sellerName}</AppText>
        <Badge label={badge.label} tone={badge.tone} />
        {n.pendingExpiresAt ? <AppText tone="faint" size={12}>Expires in {timeLeft(n.pendingExpiresAt, Date.now())}</AppText> : null}
      </View>

      <Card>
        <AppText weight="bold">Timeline</AppText>
        {n.offers.map((o) => (
          <AppText key={o.id}>{offerLine(o)}</AppText>
        ))}
        {n.status === 'CLOSED' || n.status === 'LAPSED' ? <AppText tone="muted">{n.closeText ?? n.statusLabel}</AppText> : null}
      </Card>

      {n.agreement ? (
        <Card>
          <AppText weight="bold">Agreed at {formatRupees(n.agreement.price)}</AppText>
          <AppText tone="muted" size={13}>One unit is held for you for {timeLeft(n.agreement.deadline, Date.now())}.</AppText>
          {n.agreement.dealAccess ? (
            <AppText size={13}>{n.agreement.dealAccess.type === 'CODE' ? 'Your coupon code' : 'Your discount link'}: {n.agreement.dealAccess.value}</AppText>
          ) : null}
          <AppText tone="muted" size={12}>Placing the order is not available yet. It arrives with the next update.</AppText>
        </Card>
      ) : null}

      {n.canRespond && last ? (
        <Card>
          <AppText weight="bold">The seller replied with {formatRupees(last.amount)}</AppText>
          <Button title={`Accept ${formatRupees(last.amount)}`} loading={respond.isPending} onPress={() => run({ id: n.id, action: 'accept' })} />
          {n.canCounter && bounds ? (
            <>
              <TextField label="Counter with" prefix="₹" keyboardType="number-pad" value={counter} onChangeText={setCounter} hint={`Between ${formatRupees(bounds.minExclusive + 100)} and ${formatRupees(bounds.maxExclusive - 100)}. ${n.offersLeft - 1} more ${n.offersLeft - 1 === 1 ? 'offer' : 'offers'} after this.`} error={error?.fields.amount} />
              <Button title="Send counter" variant="outline" disabled={rupees == null} loading={respond.isPending} onPress={() => rupees != null && run({ id: n.id, action: 'counter', amount: rupees * 100 })} />
            </>
          ) : (
            <AppText tone="muted" size={13}>This is the last offer. Accept it or decline.</AppText>
          )}
          <Button title="Decline" variant="ghost" loading={respond.isPending} onPress={() => run({ id: n.id, action: 'decline' })} />
        </Card>
      ) : null}

      {n.canWithdraw ? <Button title="Withdraw my offer" variant="outline" loading={respond.isPending} onPress={() => run({ id: n.id, action: 'withdraw' })} /> : null}
      <FieldError>{error && !Object.keys(error.fields).length ? error.message : undefined}</FieldError>
    </Screen>
  );
}
