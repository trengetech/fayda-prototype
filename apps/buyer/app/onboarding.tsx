import { useSession, useSessionManager } from '@fayda/api-client';
import { BuyerProfileInputSchema, type BuyerProfileInput } from '@fayda/contracts/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { ActionBar, AppText, Button, Card, Checkbox, FieldError, Screen, SectionTitle, TextField, describeError, useTheme } from '@fayda/ui';
import { useState } from 'react';
import { Controller, useForm, type FieldPath } from 'react-hook-form';
import { Modal, ScrollView, View } from 'react-native';
import { AGREEMENT_NOTE, AGREEMENT_POINTS, AGREEMENT_TITLE } from '../src/agreement';

/** The same rule the server enforces, so the checkbox is flagged without a round trip. */
const FormSchema = BuyerProfileInputSchema.refine((v) => v.agreementAccepted, { path: ['agreementAccepted'], message: 'You need to accept the user agreement to continue.' });

/** The server names some fields differently from the form. */
const FIELD_MAP: Record<string, FieldPath<BuyerProfileInput>> = { contactPhone: 'contact.phone', contactWhatsapp: 'contact.whatsapp', agreement: 'agreementAccepted' };

/** Buyer sign-up: name, address, a contact number sellers can use on open orders, and the user agreement. */
export default function BuyerOnboarding() {
  const { colors } = useTheme();
  const manager = useSessionManager();
  const { user } = useSession();
  const [reading, setReading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<BuyerProfileInput>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: user?.name ?? '',
      address: { name: user?.name ?? '', line1: '', line2: '', pin: '', city: 'Hyderabad', state: 'Telangana' },
      contact: { phone: user?.phone ?? '', whatsapp: '' },
      agreementAccepted: false,
    },
  });
  const { control, handleSubmit, setError, formState: { errors, isSubmitting } } = form;

  const submit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await manager.client.saveBuyerProfile({ ...values, contact: { phone: values.contact.phone || null, whatsapp: values.contact.whatsapp || null } });
      await manager.refreshProfile();
    } catch (e) {
      const { message, fields } = describeError(e);
      const keys = Object.keys(fields);
      keys.forEach((k) => setError((FIELD_MAP[k] ?? k) as FieldPath<BuyerProfileInput>, { message: fields[k] ?? message }));
      if (!keys.length || fields.contact) setFormError(fields.contact ?? message);
    }
  });

  const field = (name: FieldPath<BuyerProfileInput>, label: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <Controller
      control={control}
      name={name}
      render={({ field: f, fieldState }) => <TextField label={label} value={String(f.value ?? '')} onChangeText={f.onChange} error={fieldState.error?.message} {...extra} />}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
    <Screen>
      <View style={{ gap: 6 }}>
        <AppText tone="muted" weight="extrabold" size={12}>One last step</AppText>
        <AppText weight="extrabold" size={24} style={{ letterSpacing: -0.4 }}>Set up your profile</AppText>
        <AppText tone="muted">So sellers know where to deliver and how to reach you about an order.</AppText>
      </View>

      {field('name', 'Your name', { autoCapitalize: 'words' })}
      <SectionTitle>Delivery address</SectionTitle>
      {field('address.name', 'Name on the delivery', { autoCapitalize: 'words' })}
      {field('address.line1', 'Flat, house or building')}
      {field('address.line2', 'Area or street')}
      {field('address.pin', 'PIN code', { keyboardType: 'number-pad', maxLength: 6 })}
      {field('address.city', 'City')}
      {field('address.state', 'State')}

      <SectionTitle>Contact for your orders</SectionTitle>
      <AppText tone="muted" size={13}>Add a phone or WhatsApp number (at least one). The seller sees it only while your order is open.</AppText>
      {field('contact.phone', 'Phone number', { keyboardType: 'number-pad', prefix: '+91', maxLength: 13, optional: true })}
      {field('contact.whatsapp', 'WhatsApp number', { keyboardType: 'number-pad', prefix: '+91', maxLength: 13, optional: true })}
      <FieldError>{formError ?? undefined}</FieldError>

      <Card>
        <AppText weight="bold">{AGREEMENT_TITLE}</AppText>
        <AppText tone="muted" size={13}>Payment and delivery are between you and the seller. Disputes are resolved with the seller. Reviews must be honest.</AppText>
        <Button title="Read the full agreement" variant="outline" size="sm" onPress={() => setReading(true)} />
        <Controller control={control} name="agreementAccepted" render={({ field: f }) => <Checkbox checked={f.value} onChange={f.onChange} error={errors.agreementAccepted?.message}><AppText size={14}>I have read and agree to the user agreement</AppText></Checkbox>} />
      </Card>


      <Modal visible={reading} animationType="slide" onRequestClose={() => setReading(false)}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingTop: 48 }}>
          <AppText weight="extrabold" size={20}>{AGREEMENT_TITLE}</AppText>
          {AGREEMENT_POINTS.map((p) => <AppText key={p}>• {p}</AppText>)}
          <AppText tone="muted" size={13}>{AGREEMENT_NOTE}</AppText>
          <Button title="Close" onPress={() => setReading(false)} />
        </ScrollView>
      </Modal>
    </Screen>
    <ActionBar>
      <Button title="Agree and start shopping" size="lg" loading={isSubmitting} onPress={() => void submit()} />
      <Button title="Use a different number" variant="ghost" size="sm" onPress={() => void manager.signOut()} />
    </ActionBar>
    </View>
  );
}
