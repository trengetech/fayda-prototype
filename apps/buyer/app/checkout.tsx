import { useBuyerListing, useBuyerNegotiation, usePlaceOrder } from '@fayda/api-client';
import type { PlaceOrder } from '@fayda/contracts/schemas';
import { formatRupees } from '@fayda/domain';
import { AppText, Button, Card, ChipGroup, FieldError, Screen, describeError } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { newKey, PAY_LABELS } from '../src/orders';
import { useBuyerProfile } from '../src/profile';

type Method = keyof typeof PAY_LABELS;

/**
 * Checkout for a direct listing: size, delivery address, and how you will pay the seller. The price is never sent; the server
 * takes it from the listing, or from the agreement when you are placing an agreed offer. Fayda does not take the payment.
 */
export default function CheckoutScreen() {
  const params = useLocalSearchParams<{ listingId?: string; variantId?: string; negotiationId?: string }>();
  const router = useRouter();
  const negotiation = useBuyerNegotiation(params.negotiationId ?? null);
  const listingId = params.listingId ?? negotiation.data?.listing.id ?? null;
  const listing = useBuyerListing(listingId);
  const profile = useBuyerProfile();
  const place = usePlaceOrder();
  const [variantId, setVariantId] = useState<string | null>(params.variantId ?? null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [method, setMethod] = useState<Method | null>(null);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const key = useRef(newKey());
  // The address ids we have seen. One that appears later was just added on the addresses screen, so it becomes the choice.
  const seen = useRef<Set<string> | null>(null);
  // A different checkout is a different attempt; a retry of the same one keeps its key so a lost reply cannot make two orders.
  const changed = <T,>(set: (v: T) => void) => (v: T) => {
    key.current = newKey();
    set(v);
  };

  const known = profile.data?.addresses;
  useEffect(() => {
    if (!known) return;
    const added = seen.current ? known.find((a) => !seen.current!.has(a.id)) : undefined;
    seen.current = new Set(known.map((a) => a.id));
    if (added) {
      key.current = newKey();
      setAddressId(added.id);
    }
  }, [known]);

  const failure = listing.error ?? profile.error ?? negotiation.error;
  const loading = !failure && (listing.isPending || profile.isPending || (!!params.negotiationId && negotiation.isPending));
  if (loading) return <Screen><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator /><AppText>Getting checkout ready…</AppText></View></Screen>;
  if (failure || !listing.data || !profile.data)
    return (
      <Screen>
        <AppText weight="bold">Can’t start checkout</AppText>
        <AppText tone="muted">{failure?.message ?? 'Something went wrong.'}</AppText>
        <Button title="Try again" onPress={() => void Promise.all([listing.refetch(), profile.refetch()])} />
      </Screen>
    );

  const l = listing.data;
  const agreed = negotiation.data?.agreement ?? null;
  const price = agreed ? agreed.price : l.price;
  const fixedSize = !!params.negotiationId;
  const sizeId = fixedSize ? (negotiation.data?.variantId ?? variantId) : variantId;
  const available = l.variants.filter((v) => v.available);
  // Only the ways this seller can actually be paid (names only; the details come with the order).
  const offered = l.checkout.payMethods as Method[];
  const addresses = profile.data.addresses;
  const addrId = addressId ?? profile.data.defaultAddressId ?? addresses[0]?.id ?? null;
  const ready = !!sizeId && !!addrId && !!method;

  const submit = () => {
    if (!sizeId || !addrId || !method) return;
    setError(null);
    const input: PlaceOrder = params.negotiationId ? { negotiationId: params.negotiationId, addressId: addrId, paymentMethod: method } : { listingId: l.id, variantId: sizeId, addressId: addrId, paymentMethod: method };
    place.mutate(
      { input, idempotencyKey: key.current },
      {
        onSuccess: (o) => {
          key.current = newKey();
          router.replace(`/order/${o.id}` as never);
        },
        onError: (e) => setError(describeError(e)),
      },
    );
  };

  return (
    <Screen>
      <Card>
        <AppText weight="bold">{l.title}</AppText>
        <AppText tone="muted" size={13}>{l.seller.name} · {l.seller.area}</AppText>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <AppText>{agreed ? 'Agreed price' : 'Price'}</AppText>
          <AppText weight="extrabold">{formatRupees(price)}</AppText>
        </View>
        {agreed ? <AppText tone="muted" size={12}>Listed at {formatRupees(l.price)}. This price is held for you until the checkout window closes.</AppText> : null}
      </Card>

      {fixedSize ? (
        <AppText>Size {l.variants.find((v) => v.id === sizeId)?.label ?? ''}</AppText>
      ) : (
        <ChipGroup label="Size" options={available.map((v) => v.id)} value={sizeId ? [sizeId] : []} onChange={(v) => changed(setVariantId)(v[0] ?? null)} format={(id) => l.variants.find((v) => v.id === id)?.label ?? ''} />
      )}

      {addresses.length ? (
        <>
          <ChipGroup label="Deliver to" options={addresses.map((a) => a.id)} value={addrId ? [addrId] : []} onChange={(v) => changed(setAddressId)(v[0] ?? null)} format={(id) => { const a = addresses.find((x) => x.id === id); return a ? `${a.name}, ${a.line1}, ${a.pin}` : ''; }} />
          <Button title="Add or change address" variant="ghost" size="sm" onPress={() => router.push('/addresses?pick=1' as never)} />
        </>
      ) : (
        <Card>
          <AppText weight="bold">No delivery address</AppText>
          <AppText tone="muted" size={13}>Add the address you want this order delivered to.</AppText>
          <Button title="Add address" onPress={() => router.push('/addresses?pick=1&add=1' as never)} />
        </Card>
      )}

      {offered.length ? null : <Card><AppText weight="bold">No way to pay yet</AppText><AppText tone="muted" size={13}>This seller hasn’t added a way to be paid directly. Try again later or message them.</AppText></Card>}
      <ChipGroup label="How will you pay the seller?" options={offered} value={method ? [method] : []} onChange={(v) => changed(setMethod)(v[0] ?? null)} format={(m) => PAY_LABELS[m]} />
      <AppText tone="muted" size={12}>You pay the seller directly after placing the order. Fayda does not handle payments or delivery. There is no cash on delivery.</AppText>

      <Button title={`Place order · ${formatRupees(price)}`} disabled={!ready} loading={place.isPending} onPress={submit} />
      <FieldError>{error?.message}</FieldError>
    </Screen>
  );
}
