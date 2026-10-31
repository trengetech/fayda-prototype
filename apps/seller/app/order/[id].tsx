import { useSellerOrder, useSellerOrderAction } from '@fayda/api-client';
import type { SellerOrder } from '@fayda/contracts/schemas';
import { formatRupees, timeLeft } from '@fayda/domain';
import { AppText, Badge, Button, Card, ChipGroup, FieldError, Screen, TextField, describeError } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { openLink } from '../../src/links';
import { PAY_LABEL, cancelOptions, confirmLabel, emptyShip, shipmentBody, statusBadge, telUrl, whatsappUrl, type ShipForm } from '../../src/orders';
import { newNonce } from '../../src/listing-form';

const Stars = ({ n }: { n: number }) => <AppText accessibilityLabel={`${n} out of 5 stars`}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</AppText>;

function ShipFields({ value, onChange, errors }: { value: ShipForm; onChange: (v: ShipForm) => void; errors: Record<string, string> }) {
  const set = (k: keyof ShipForm) => (t: string) => onChange({ ...value, [k]: t });
  return (
    <View style={{ gap: 8 }}>
      <TextField label="Courier" value={value.courier} onChangeText={set('courier')} optional />
      <TextField label="Tracking number" value={value.trackingNo} onChangeText={set('trackingNo')} autoCapitalize="characters" optional />
      <TextField label="Tracking link" value={value.trackingUrl} onChangeText={set('trackingUrl')} autoCapitalize="none" error={errors.trackingUrl} optional />
      <TextField label="Expected delivery date" value={value.expectedDate} onChangeText={set('expectedDate')} placeholder="2026-11-04" error={errors.expectedDate} optional />
      <TextField label="Note" value={value.note} onChangeText={set('note')} hint="For example “hand delivery”." optional />
      <FieldError>{errors.shipment}</FieldError>
    </View>
  );
}

export default function OrderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const query = useSellerOrder(id ?? null);
  const act = useSellerOrderAction();
  const nonce = useRef(newNonce());
  const [shipOpen, setShipOpen] = useState(false);
  const [ship, setShip] = useState<ShipForm>(emptyShip());
  const [shipErrors, setShipErrors] = useState<Record<string, string>>({});
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);

  if (query.isPending) return <Screen><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator /><AppText>Loading order…</AppText></View></Screen>;
  if (query.isError)
    return (
      <Screen>
        <AppText weight="bold">Can’t load this order</AppText>
        <AppText tone="muted">{query.error.message}</AppText>
        <Button title="Try again" onPress={() => void query.refetch()} />
      </Screen>
    );
  const o: SellerOrder = query.data;
  const badge = statusBadge(o);

  // One key per logical action, so pressing a button again after a lost reply cannot move the order twice.
  const run = (action: Parameters<typeof act.mutate>[0], then?: () => void) => {
    setError(null);
    act.mutate(action, {
      onSuccess: () => {
        nonce.current = newNonce();
        setShipOpen(false);
        setCancelOpen(false);
        then?.();
      },
      onError: (e) => setError(describeError(e).message),
    });
  };
  const key = (name: string) => `${name}-${o.id}-${nonce.current}`;

  const confirm = (withShipment: boolean) => {
    if (withShipment) {
      const r = shipmentBody(ship);
      if ('errors' in r) return setShipErrors(r.errors);
      setShipErrors({});
      return run({ id: o.id, action: 'confirm', shipment: r.body, idempotencyKey: key('confirm') });
    }
    run({ id: o.id, action: 'confirm', idempotencyKey: key('confirm') });
  };
  const sendShipment = () => {
    const r = shipmentBody(ship);
    if ('errors' in r) return setShipErrors(r.errors);
    setShipErrors({});
    run({ id: o.id, action: 'ship', shipment: r.body, idempotencyKey: key('ship') });
  };
  const cancel = () => {
    if (!reason) return setReasonError('Choose a reason.');
    setReasonError(null);
    run({ id: o.id, action: 'cancel', input: { reason: reason as never, note: note.trim() || null }, idempotencyKey: key('cancel') });
  };
  const options = cancelOptions(o.channel);

  return (
    <Screen>
      <View style={{ gap: 4 }}>
        <AppText weight="extrabold" size={20}>{o.listing.title}</AppText>
        <AppText tone="muted">{o.number} · Size {o.listing.variantLabel} · {o.buyerName}</AppText>
        <Badge label={badge.label} tone={badge.tone} />
        {o.status === 'PLACED' ? <AppText tone="faint" size={12}>Confirm within {timeLeft(o.confirmBy, Date.now())} or the order expires and the item goes back on sale.</AppText> : null}
      </View>

      <Card>
        <AppText weight="bold">{formatRupees(o.price)}</AppText>
        <AppText tone="muted" size={13}>{o.priceSource === 'NEGOTIATED' ? 'Agreed price (bargained)' : 'Listed price'}</AppText>
        <AppText tone="muted" size={13}>{o.channel === 'WEBSITE' ? 'Website deal' : `Pays by ${o.paymentMethod ? PAY_LABEL[o.paymentMethod] : 'a method the buyer chose'}`}</AppText>
        {o.dealAccess ? <AppText tone="muted" size={13}>{o.dealAccess.type === 'CODE' ? 'Coupon code' : 'Discount link'}: {o.dealAccess.value}</AppText> : null}
        {o.channel === 'WEBSITE' ? <AppText tone="muted" size={13}>Check this order on your website, then confirm it here.</AppText> : <AppText tone="muted" size={13}>Confirm after the money reaches you. Use {o.number} to match the payment note.</AppText>}
      </Card>

      {o.address ? (
        <Card>
          <AppText weight="bold">Deliver to</AppText>
          <AppText>{o.address.name}</AppText>
          <AppText tone="muted">{[o.address.line1, o.address.line2].filter(Boolean).join(', ')}</AppText>
          <AppText tone="muted">{o.address.city}, {o.address.state} {o.address.pin}</AppText>
        </Card>
      ) : null}

      {o.shipment ? (
        <Card>
          <AppText weight="bold">Shipment</AppText>
          {o.shipment.courier ? <AppText>Courier: {o.shipment.courier}</AppText> : null}
          {o.shipment.trackingNo ? <AppText>Tracking: {o.shipment.trackingNo}</AppText> : null}
          {o.shipment.trackingUrl ? <AppText tone="muted" size={13}>{o.shipment.trackingUrl}</AppText> : null}
          {o.shipment.expectedDate ? <AppText tone="muted">Expected {o.shipment.expectedDate}</AppText> : null}
          {o.shipment.note ? <AppText tone="muted">{o.shipment.note}</AppText> : null}
        </Card>
      ) : null}
      {o.cancelText ? <Card><AppText weight="bold">Closed</AppText><AppText tone="muted">{o.cancelText}</AppText></Card> : null}

      {o.buyerContact || o.threadId ? (
        <Card>
          <AppText weight="bold">Contact buyer</AppText>
          {o.threadId ? <Button title={o.unread ? `Chat in app (${o.unread} new)` : 'Chat in app'} variant="outline" onPress={() => router.push(`/chat/${o.threadId}` as never)} /> : null}
          {o.buyerContact?.whatsapp ? <Button title="WhatsApp" variant="outline" onPress={() => void openLink(whatsappUrl(o.buyerContact!.whatsapp!, o.number), `WhatsApp isn’t available. The number is ${o.buyerContact!.whatsapp}.`).then(setLinkNote)} /> : null}
          {o.buyerContact?.phone ? <Button title="Call" variant="outline" onPress={() => void openLink(telUrl(o.buyerContact!.phone!), `Can’t place a call here. The number is ${o.buyerContact!.phone}.`).then(setLinkNote)} /> : null}
          {o.buyerContact ? <AppText tone="faint" size={12}>The buyer’s numbers are shown only while the order is open.</AppText> : <AppText tone="faint" size={12}>The order is closed, so only the chat remains.</AppText>}
          <FieldError>{linkNote ?? undefined}</FieldError>
        </Card>
      ) : null}

      {o.review ? (
        <Card>
          <AppText weight="bold">Buyer’s review</AppText>
          <Stars n={o.review.rating} />
          {o.review.text ? <AppText>{o.review.text}</AppText> : null}
          <AppText tone="faint" size={12}>Verified order{o.review.editedAt ? ' · edited' : ''}</AppText>
        </Card>
      ) : null}

      {o.canConfirm || o.canShip || o.canDeliver || o.canCancel ? (
        <Card>
          <AppText weight="bold">Next step</AppText>
          {shipOpen && (o.canConfirm || o.canShip) ? <ShipFields value={ship} onChange={setShip} errors={shipErrors} /> : null}
          {o.canConfirm ? <Button title={shipOpen ? `${confirmLabel(o)} and shipped` : confirmLabel(o)} loading={act.isPending} onPress={() => confirm(shipOpen)} /> : null}
          {o.canShip && shipOpen ? <Button title="Save shipment details" loading={act.isPending} onPress={sendShipment} /> : null}
          {(o.canConfirm || o.canShip) && !shipOpen ? <Button title={o.canShip && o.shipment ? 'Update shipment details' : 'Add shipment details'} variant="outline" onPress={() => setShipOpen(true)} /> : null}
          {o.canDeliver ? <Button title="Mark delivered" variant={o.canConfirm ? 'outline' : 'primary'} loading={act.isPending} onPress={() => run({ id: o.id, action: 'deliver', idempotencyKey: key('deliver') })} /> : null}
          {o.canCancel && !cancelOpen ? <Button title="Cancel this order" variant="ghost" onPress={() => setCancelOpen(true)} /> : null}
          {cancelOpen ? (
            <View style={{ gap: 8 }}>
              <ChipGroup label="Why are you cancelling?" options={options.map((x) => x.key)} value={reason ? [reason as never] : []} onChange={(v) => setReason(v[0] ?? null)} format={(k) => options.find((x) => x.key === k)?.label ?? k} error={reasonError ?? undefined} />
              <TextField label="Note (optional)" value={note} onChangeText={setNote} maxLength={200} optional />
              <AppText tone="muted" size={13}>The buyer is told the reason. “Out of stock” keeps the item off sale; other reasons put it back.</AppText>
              <Button title="Yes, cancel the order" variant="danger" loading={act.isPending} onPress={cancel} />
              <Button title="Keep the order" variant="ghost" onPress={() => setCancelOpen(false)} />
            </View>
          ) : null}
          <FieldError>{error ?? undefined}</FieldError>
        </Card>
      ) : null}
    </Screen>
  );
}
