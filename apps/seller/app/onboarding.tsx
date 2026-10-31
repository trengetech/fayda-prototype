import { ApiError, useSession, useSessionManager } from '@fayda/api-client';
import {
  CATEGORY_NAMES,
  CONFIRM_HOURS,
  PaymentInputSchema,
  SHIP_DAYS,
  SellerShopInputSchema,
  type PaymentInput,
  type SellerProfile,
  type SellerShopInput,
} from '@fayda/contracts/schemas';
import { zodResolver } from '@hookform/resolvers/zod';
import { AppText, Button, Card, ChipGroup, Checkbox, FieldError, Screen, StepHeader, TextField, describeError } from '@fayda/ui';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm, type FieldPath } from 'react-hook-form';
import { Modal, ScrollView } from 'react-native';
import { CONDUCT_NOTE, CONDUCT_POINTS, CONDUCT_TITLE } from '../src/conduct';

const HOURS_TEXT = (h: number) => (h === 1 ? '1 hour' : h < 24 ? `${h} hours` : `${h / 24} day${h === 24 ? '' : 's'}`);
const DAYS_TEXT = (d: number) => (d === 1 ? '1 day' : `${d} days`);

/** Rules the server enforces too, so the next button explains itself without a round trip. */
const ShopForm = SellerShopInputSchema.superRefine((v, ctx) => {
  const need = (ok: boolean, path: string[], message: string) => ok || ctx.addIssue({ code: 'custom', path, message });
  need(v.name.trim().length >= 2, ['name'], 'Enter your shop name (2–60 characters).');
  need(/^[a-z0-9_.]{3,24}$/.test(v.handle.trim().toLowerCase()), ['handle'], 'Use 3–24 lowercase letters, numbers, dots or underscores.');
  need(v.area.trim().length > 0, ['area'], 'Enter your area or locality.');
  need(v.categories.length > 0, ['categories'], 'Choose at least one category you sell.');
  need(v.mapsUrl.trim().length > 0, ['mapsUrl'], 'Paste your shop’s Google Maps link.');
  need(!!v.contact.phone?.trim() || !!v.contact.whatsapp?.trim(), ['contact', 'phone'], 'Add a phone or WhatsApp number buyers can use for open orders.');
  need((CONFIRM_HOURS as readonly number[]).includes(v.sla.confirmHours), ['sla', 'confirmHours'], 'Choose how soon you usually confirm payments.');
  need((SHIP_DAYS as readonly number[]).includes(v.sla.shipDays), ['sla', 'shipDays'], 'Choose how soon you usually ship.');
});
const PayForm = PaymentInputSchema.refine((v) => v.conductAccepted, { path: ['conductAccepted'], message: 'You need to agree to the Seller Code of Conduct to register.' });

const STEP1: FieldPath<SellerShopInput>[] = ['sellerType', 'name', 'handle', 'area', 'city', 'gstin', 'bio', 'categories'];
const SHOP_MAP: Record<string, FieldPath<SellerShopInput>> = { contactPhone: 'contact.phone', contactWhatsapp: 'contact.whatsapp', contact: 'contact.phone', confirmHours: 'sla.confirmHours', shipDays: 'sla.shipDays' };
const PAY_MAP: Record<string, FieldPath<PaymentInput>> = { conduct: 'conductAccepted' };

const shopDefaults = (phone: string): SellerShopInput => ({
  sellerType: 'INDIVIDUAL', name: '', handle: '', area: '', city: 'Hyderabad', gstin: '', bio: '', categories: [],
  mapsUrl: '', googleProfileUrl: '', socialUrl: '', contact: { phone: '', whatsapp: phone }, sla: { confirmHours: 0, shipDays: 0 },
});
const fromProfile = (p: SellerProfile): SellerShopInput => ({
  sellerType: p.sellerType, name: p.name, handle: p.handle, area: p.area, city: p.city, gstin: p.gstin ?? '', bio: p.bio, categories: p.categories,
  mapsUrl: p.mapsUrl, googleProfileUrl: p.googleProfileUrl ?? '', socialUrl: p.socialUrl ?? '', contact: { phone: p.contact.phone ?? '', whatsapp: p.contact.whatsapp ?? '' }, sla: p.sla,
});

/** Seller sign-up in 3 steps: shop and categories, location and contact with declared times, then payment and the Code of Conduct. */
export default function SellerOnboarding() {
  const manager = useSessionManager();
  const { user } = useSession();
  const existing = useQuery({
    queryKey: ['seller-profile'],
    queryFn: async () => {
      try {
        return await manager.client.getSellerProfile();
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },
  });
  if (existing.isPending) return <Screen><AppText>Loading…</AppText></Screen>;
  if (existing.isError) return <Screen><AppText weight="bold">Can’t load your shop</AppText><AppText tone="muted">{existing.error.message}</AppText><Button title="Try again" onPress={() => void existing.refetch()} /></Screen>;
  return <Steps existing={existing.data} phone={user?.phone ?? ''} />;
}

function Steps({ existing, phone }: { existing: SellerProfile | null; phone: string }) {
  const manager = useSessionManager();
  // A shop that is saved and complete in steps 1 and 2 resumes at payment; anything else starts at step 1.
  const shopDone = !!existing && !existing.missing.some((m) => m !== 'payment' && m !== 'conduct');
  const [step, setStep] = useState<1 | 2 | 3>(shopDone ? 3 : 1);
  const [formError, setFormError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const shop = useForm<SellerShopInput>({ resolver: zodResolver(ShopForm), defaultValues: existing ? fromProfile(existing) : shopDefaults(phone) });
  const pay = useForm<PaymentInput>({
    resolver: zodResolver(PayForm),
    defaultValues: { upiId: existing?.payment?.upiId ?? '', bankHolder: existing?.payment?.bankHolder ?? '', bankAccount: existing?.payment?.bankAccount ?? '', bankIfsc: existing?.payment?.bankIfsc ?? '', bankName: existing?.payment?.bankName ?? '', paymentLink: existing?.payment?.paymentLink ?? '', website: existing?.payment?.website ?? '', conductAccepted: false },
  });

  const next1 = async () => { if (await shop.trigger(STEP1)) setStep(2); };
  const submitShop = shop.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await manager.client.saveSellerShop({ ...values, contact: { phone: values.contact.phone || null, whatsapp: values.contact.whatsapp || null } });
      await manager.refreshProfile();
      setStep(3);
    } catch (e) {
      const { message, fields } = describeError(e);
      const keys = Object.keys(fields);
      keys.forEach((k) => shop.setError((SHOP_MAP[k] ?? k) as FieldPath<SellerShopInput>, { message: fields[k] ?? message }));
      if (!keys.length) setFormError(message);
      else if (keys.some((k) => STEP1.includes((SHOP_MAP[k] ?? k) as FieldPath<SellerShopInput>))) setStep(1);
    }
  }, () => { if (STEP1.some((f) => shop.getFieldState(f).error)) setStep(1); });
  const next2 = () => void submitShop();

  const submitPay = pay.handleSubmit(async (values) => {
    setFormError(null);
    const clean = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' ? null : v])) as PaymentInput;
    try {
      await manager.client.saveSellerPayment(clean);
      await manager.refreshProfile();
    } catch (e) {
      const { message, fields } = describeError(e);
      const keys = Object.keys(fields);
      keys.forEach((k) => { if (k !== 'payment') pay.setError((PAY_MAP[k] ?? k) as FieldPath<PaymentInput>, { message: fields[k] ?? message }); });
      setFormError(fields.payment ?? (keys.length ? null : message));
    }
  });

  const sf = (name: FieldPath<SellerShopInput>, label: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <Controller control={shop.control} name={name} render={({ field: f, fieldState }) => <TextField label={label} value={String(f.value ?? '')} onChangeText={f.onChange} error={fieldState.error?.message} {...extra} />} />
  );
  const pf = (name: FieldPath<PaymentInput>, label: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <Controller control={pay.control} name={name} render={({ field: f, fieldState }) => <TextField label={label} value={String(f.value ?? '')} onChangeText={f.onChange} error={fieldState.error?.message} optional {...extra} />} />
  );

  return (
    <Screen>
      {step === 1 ? (
        <>
          <StepHeader step={1} total={3} title="Your shop" />
          <Controller control={shop.control} name="sellerType" render={({ field: f }) => <ChipGroup label="You sell as" options={['INDIVIDUAL', 'BUSINESS'] as const} value={[f.value]} onChange={(v) => f.onChange(v[0])} format={(v) => (v === 'BUSINESS' ? 'A business' : 'An individual')} />} />
          {sf('name', 'Shop name')}
          {sf('handle', 'Shop handle', { autoCapitalize: 'none', hint: 'Lowercase letters, numbers, dots and underscores. Buyers can find you by it.' })}
          {sf('area', 'Area or locality')}
          {sf('city', 'City')}
          {sf('gstin', 'GSTIN', { autoCapitalize: 'characters', optional: true, maxLength: 15 })}
          {sf('bio', 'About your shop', { multiline: true, optional: true, maxLength: 160 })}
          <Controller control={shop.control} name="categories" render={({ field: f, fieldState }) => <ChipGroup label="Categories you sell" multiple options={CATEGORY_NAMES} value={f.value as (typeof CATEGORY_NAMES)[number][]} onChange={f.onChange} error={fieldState.error?.message} />} />
          <Button title="Next" size="lg" onPress={() => void next1()} />
        </>
      ) : step === 2 ? (
        <>
          <StepHeader step={2} total={3} title="Location and contact" />
          {sf('mapsUrl', 'Google Maps link to your shop', { autoCapitalize: 'none', hint: 'Open your shop in Google Maps, tap Share, and paste the link.' })}
          {sf('googleProfileUrl', 'Google Business Profile link', { autoCapitalize: 'none', optional: true })}
          {sf('socialUrl', 'Instagram or Facebook page', { autoCapitalize: 'none', optional: true })}
          <AppText weight="bold" size={15}>Contact for open orders</AppText>
          <AppText tone="muted" size={13}>Add a phone or WhatsApp number (at least one). Buyers see it only while their order is open.</AppText>
          {sf('contact.phone', 'Phone number', { keyboardType: 'number-pad', prefix: '+91', maxLength: 13, optional: true })}
          {sf('contact.whatsapp', 'WhatsApp number', { keyboardType: 'number-pad', prefix: '+91', maxLength: 13, optional: true })}
          <AppText weight="bold" size={15}>How fast you work</AppText>
          <Controller control={shop.control} name="sla.confirmHours" render={({ field: f, fieldState }) => <ChipGroup label="You usually confirm payment within" options={CONFIRM_HOURS} value={f.value ? [f.value as (typeof CONFIRM_HOURS)[number]] : []} onChange={(v) => f.onChange(v[0])} format={HOURS_TEXT} error={fieldState.error?.message} />} />
          <Controller control={shop.control} name="sla.shipDays" render={({ field: f, fieldState }) => <ChipGroup label="You usually ship within" options={SHIP_DAYS} value={f.value ? [f.value as (typeof SHIP_DAYS)[number]] : []} onChange={(v) => f.onChange(v[0])} format={DAYS_TEXT} error={fieldState.error?.message} />} />
          <FieldError>{formError ?? undefined}</FieldError>
          <Button title="Next" size="lg" loading={shop.formState.isSubmitting} onPress={next2} />
          <Button title="Back" variant="ghost" onPress={() => setStep(1)} />
        </>
      ) : (
        <>
          <StepHeader step={3} total={3} title="How buyers pay you" />
          <AppText tone="muted" size={13}>Buyers pay you directly; Fayda never handles the money. Add at least one way, or your website.</AppText>
          {pf('upiId', 'UPI ID', { autoCapitalize: 'none', placeholder: 'name@okbank' })}
          {pf('bankHolder', 'Bank account holder')}
          {pf('bankAccount', 'Bank account number', { keyboardType: 'number-pad' })}
          {pf('bankIfsc', 'IFSC', { autoCapitalize: 'characters', maxLength: 11 })}
          {pf('bankName', 'Bank name')}
          {pf('paymentLink', 'Payment link', { autoCapitalize: 'none' })}
          {pf('website', 'Your website', { autoCapitalize: 'none' })}
          <FieldError>{formError ?? undefined}</FieldError>
          <Card>
            <AppText weight="bold">{CONDUCT_TITLE}</AppText>
            <Button title="Read the Code of Conduct" variant="outline" size="sm" onPress={() => setReading(true)} />
            <Controller control={pay.control} name="conductAccepted" render={({ field: f, fieldState }) => <Checkbox checked={f.value} onChange={f.onChange} error={fieldState.error?.message}><AppText size={14}>I agree to the Seller Code of Conduct</AppText></Checkbox>} />
          </Card>
          <Button title="Finish setup" size="lg" loading={pay.formState.isSubmitting} onPress={() => void submitPay()} />
          <Button title="Back" variant="ghost" onPress={() => setStep(2)} />
        </>
      )}
      <Modal visible={reading} animationType="slide" onRequestClose={() => setReading(false)}>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingTop: 48 }}>
          <AppText weight="extrabold" size={20}>{CONDUCT_TITLE}</AppText>
          {CONDUCT_POINTS.map((p) => <AppText key={p}>• {p}</AppText>)}
          <AppText tone="muted" size={13}>{CONDUCT_NOTE}</AppText>
          <Button title="Close" onPress={() => setReading(false)} />
        </ScrollView>
      </Modal>
    </Screen>
  );
}
