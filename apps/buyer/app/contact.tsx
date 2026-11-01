import { useApiClient } from '@fayda/api-client';
import { AppText, Button, Screen, TextField, describeError } from '@fayda/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { PROFILE_KEY, useBuyerProfile } from '../src/profile';

/** The phone and WhatsApp numbers sellers see on your open orders. Never shown publicly. */
export default function ContactScreen() {
  const client = useApiClient();
  const qc = useQueryClient();
  const profile = useBuyerProfile();
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<{ message: string; fields: Record<string, string> } | null>(null);
  const [busy, setBusy] = useState(false);
  const data = profile.data;
  useEffect(() => {
    if (data) {
      setPhone(data.contact.phone ?? '');
      setWhatsapp(data.contact.whatsapp ?? '');
    }
  }, [data]);

  if (profile.isPending) return <Screen><AppText>Loading…</AppText></Screen>;
  if (profile.isError)
    return (
      <Screen>
        <AppText weight="bold">Can’t load your contact details</AppText>
        <AppText tone="muted">{profile.error.message}</AppText>
        <Button title="Try again" onPress={() => void profile.refetch()} />
      </Screen>
    );

  const save = async () => {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await client.updateBuyerContact({ phone: phone.trim() || null, whatsapp: whatsapp.trim() || null });
      await qc.invalidateQueries({ queryKey: [PROFILE_KEY] });
      setSaved(true);
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <AppText tone="muted" size={13}>Sellers you order from see these numbers only while an order is open (placed, confirmed or shipped). Add at least one.</AppText>
      <TextField label="Phone" prefix="+91" keyboardType="number-pad" value={phone} onChangeText={setPhone} maxLength={10} error={error?.fields.phone ?? error?.fields.contactPhone} />
      <TextField label="WhatsApp" prefix="+91" keyboardType="number-pad" value={whatsapp} onChangeText={setWhatsapp} maxLength={10} optional error={error?.fields.whatsapp ?? error?.fields.contactWhatsapp} />
      <Button title="Save" loading={busy} onPress={() => void save()} />
      {saved ? <AppText tone="success" accessibilityRole="alert">Saved.</AppText> : null}
      {error && !Object.keys(error.fields).length ? <AppText tone="danger" size={12} accessibilityRole="alert">{error.message}</AppText> : null}
    </Screen>
  );
}
