import type { AddressInput } from '@fayda/contracts/schemas';
import { validateAddress } from '@fayda/domain';
import { AppText, Button, Checkbox, FieldError, TextField } from '@fayda/ui';
import { useState } from 'react';
import { View } from 'react-native';

export const EMPTY_ADDRESS: AddressInput = { name: '', line1: '', line2: '', pin: '', city: 'Hyderabad', state: 'Telangana' };

/**
 * The delivery address fields, as in onboarding. The same rules the server uses (`validateAddress`) are checked first so a
 * mistake is flagged without a round trip; the server's messages for any field are shown too.
 */
export function AddressForm({
  initial,
  title,
  submitLabel,
  busy,
  serverFields,
  serverMessage,
  offerDefault,
  onSubmit,
  onCancel,
}: {
  initial: AddressInput;
  title: string;
  submitLabel: string;
  busy: boolean;
  serverFields?: Record<string, string>;
  serverMessage?: string | null;
  /** Show "Make this my default address" (when adding a second or later address). */
  offerDefault?: boolean;
  onSubmit: (values: AddressInput, makeDefault: boolean) => void;
  onCancel?: () => void;
}) {
  const [v, setV] = useState<AddressInput>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [makeDefault, setMakeDefault] = useState(false);
  const set = (k: keyof AddressInput) => (t: string) => setV((x) => ({ ...x, [k]: t }));
  const err = (k: string) => errors[k] ?? serverFields?.[k];

  const submit = () => {
    const found = validateAddress(v);
    setErrors(found);
    if (!Object.keys(found).length) onSubmit(v, makeDefault);
  };

  return (
    <View style={{ gap: 10 }}>
      <AppText weight="bold" size={16}>{title}</AppText>
      <TextField label="Name on the delivery" value={v.name} onChangeText={set('name')} autoCapitalize="words" error={err('name')} />
      <TextField label="Flat, house or building" value={v.line1} onChangeText={set('line1')} error={err('line1')} />
      <TextField label="Area or street" value={v.line2} onChangeText={set('line2')} error={err('line2')} />
      <TextField label="PIN code" value={v.pin} onChangeText={set('pin')} keyboardType="number-pad" maxLength={6} error={err('pin')} />
      <TextField label="City" value={v.city} onChangeText={set('city')} error={err('city')} />
      <TextField label="State" value={v.state} onChangeText={set('state')} error={err('state')} />
      {offerDefault ? <Checkbox checked={makeDefault} onChange={setMakeDefault}><AppText size={14}>Make this my default address</AppText></Checkbox> : null}
      <FieldError>{serverMessage ?? serverFields?.address ?? undefined}</FieldError>
      <Button title={submitLabel} loading={busy} onPress={submit} />
      {onCancel ? <Button title="Cancel" variant="ghost" onPress={onCancel} /> : null}
    </View>
  );
}
