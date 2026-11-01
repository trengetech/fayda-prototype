import { useAddressAction } from '@fayda/api-client';
import type { AddressInput } from '@fayda/contracts/schemas';
import { AppText, Badge, Button, Card, Screen, describeError } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AddressForm, EMPTY_ADDRESS } from '../src/address-form';
import { useBuyerProfile } from '../src/profile';

type Mode = { kind: 'list' } | { kind: 'new' } | { kind: 'edit'; id: string };

/**
 * Your delivery addresses: add, edit, delete (with a confirm) and choose the default. Opened from checkout with `pick=1`, a
 * new address is saved as the default and the screen goes straight back to checkout, which then selects it.
 */
export default function AddressesScreen() {
  const params = useLocalSearchParams<{ pick?: string; add?: string }>();
  const router = useRouter();
  const profile = useBuyerProfile();
  const change = useAddressAction();
  const pick = params.pick === '1';
  const [mode, setMode] = useState<Mode>(params.add === '1' ? { kind: 'new' } : { kind: 'list' });
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);

  if (profile.isPending) return <Screen><AppText>Loading…</AppText></Screen>;
  if (profile.isError || !profile.data)
    return (
      <Screen>
        <AppText weight="bold">Can’t load your addresses</AppText>
        <AppText tone="muted">{profile.error?.message}</AppText>
        <Button title="Try again" onPress={() => void profile.refetch()} />
      </Screen>
    );

  const { addresses, defaultAddressId } = profile.data;
  const run = (a: Parameters<typeof change.mutate>[0], done: () => void) => {
    setError(null);
    change.mutate(a, { onSuccess: done, onError: (e) => setError(describeError(e)) });
  };
  const back = () => {
    setMode({ kind: 'list' });
    setError(null);
  };
  const strip = ({ name, line1, line2, pin, city, state }: AddressInput): AddressInput => ({ name, line1, line2, pin, city, state });

  if (mode.kind === 'new' || (mode.kind === 'list' && !addresses.length))
    return (
      <Screen>
        <AddressForm
          title={addresses.length ? 'Add an address' : 'Add your delivery address'}
          submitLabel="Save address"
          initial={{ ...EMPTY_ADDRESS, name: profile.data.name ?? '' }}
          busy={change.isPending}
          serverFields={error?.fields}
          serverMessage={error && !Object.keys(error.fields).length ? error.message : null}
          offerDefault={addresses.length > 0 && !pick}
          onSubmit={(values, makeDefault) => run({ action: 'add', input: { ...values, makeDefault: pick || makeDefault } }, () => (pick ? router.back() : back()))}
          onCancel={addresses.length ? (pick ? () => router.back() : back) : undefined}
        />
      </Screen>
    );

  if (mode.kind === 'edit') {
    const a = addresses.find((x) => x.id === mode.id);
    if (!a) return <Screen><AppText>That address is gone.</AppText><Button title="Back" onPress={back} /></Screen>;
    return (
      <Screen>
        <AddressForm
          title="Edit address"
          submitLabel="Save changes"
          initial={strip(a)}
          busy={change.isPending}
          serverFields={error?.fields}
          serverMessage={error && !Object.keys(error.fields).length ? error.message : null}
          onSubmit={(values) => run({ action: 'update', id: a.id, input: values }, back)}
          onCancel={back}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <AppText tone="muted" size={13}>Orders keep the address you chose when you placed them, so changing or deleting one here never changes an order.</AppText>
      {addresses.map((a) => (
        <Card key={a.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <AppText weight="bold" style={{ flex: 1 }}>{a.name}</AppText>
            {a.id === defaultAddressId ? <Badge label="Default" tone="accent" /> : null}
          </View>
          <AppText tone="muted" size={13}>{a.line1}, {a.line2}</AppText>
          <AppText tone="muted" size={13}>{a.city}, {a.state} {a.pin}</AppText>
          {confirming === a.id ? (
            <View style={{ gap: 8 }}>
              <AppText weight="bold" size={14}>Delete this address?</AppText>
              <Button title="Yes, delete it" variant="danger" size="sm" loading={change.isPending} onPress={() => run({ action: 'delete', id: a.id }, () => setConfirming(null))} />
              <Button title="Keep it" variant="ghost" size="sm" onPress={() => setConfirming(null)} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Button title="Edit" size="sm" variant="outline" onPress={() => setMode({ kind: 'edit', id: a.id })} />
              {a.id !== defaultAddressId ? <Button title="Make default" size="sm" variant="outline" onPress={() => run({ action: 'default', id: a.id }, () => undefined)} /> : null}
              {addresses.length > 1 ? <Button title="Delete" size="sm" variant="ghost" onPress={() => setConfirming(a.id)} /> : null}
            </View>
          )}
        </Card>
      ))}
      {error ? <AppText tone="danger" size={13} accessibilityRole="alert">{error.message}</AppText> : null}
      <Button title="Add an address" onPress={() => { setError(null); setMode({ kind: 'new' }); }} />
    </Screen>
  );
}
