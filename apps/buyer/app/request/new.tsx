import { useCreateRequest, useRequestReach } from '@fayda/api-client';
import { CATEGORIES, formatRupees, parseRupees, validateRequest } from '@fayda/domain';
import { AppText, Button, ChipGroup, Screen, TextField, describeError } from '@fayda/ui';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { AttachmentPicker, type Attached } from '../../src/attachments';
import { newKey } from '../../src/orders';

/** "Can't find it? Ask sellers": describe what you want, add photos, and it goes to sellers who sell that category. */
export default function NewRequestScreen() {
  const router = useRouter();
  const create = useCreateRequest();
  const [category, setCategory] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [size, setSize] = useState('');
  const [budgetText, setBudgetText] = useState('');
  const [media, setMedia] = useState<Attached[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const reach = useRequestReach(category);
  const key = useRef(newKey());
  const changed = <T,>(set: (v: T) => void) => (v: T) => {
    key.current = newKey();
    set(v);
  };

  const rupees = budgetText.trim() ? parseRupees(budgetText) : null;
  const budget = rupees == null ? null : rupees * 100;
  const count = reach.data?.count;

  const submit = () => {
    setFormError(null);
    const found = validateRequest({ ...(category ? { category } : {}), title, description, size, budget: budgetText.trim() && budget == null ? -1 : budget, mediaCount: media.length });
    setErrors(found);
    if (Object.keys(found).length) return;
    create.mutate(
      { input: { category: category as string, title: title.trim(), description: description.trim() || null, size: size.trim() || null, budget, mediaIds: media.map((m) => m.id) }, idempotencyKey: key.current },
      {
        onSuccess: (r) => {
          key.current = newKey();
          router.replace(`/request/${r.id}` as never);
        },
        onError: (e) => {
          const d = describeError(e);
          setErrors(d.fields);
          setFormError(d.message);
        },
      },
    );
  };

  return (
    <Screen>
      <AppText tone="muted" size={13}>Describe what you’re looking for. Sellers who sell this category can reply with a photo, a price and a message. You choose who to talk to.</AppText>
      <ChipGroup label="Category" options={CATEGORIES} value={category ? [category] : []} onChange={(v) => changed(setCategory)(v[0] ?? null)} error={errors.category} />
      <TextField label="What are you looking for?" value={title} onChangeText={changed(setTitle)} maxLength={80} error={errors.title} placeholder="Green silk saree, size free" />
      <TextField label="Details" optional multiline value={description} onChangeText={changed(setDescription)} maxLength={500} error={errors.description} />
      <TextField label="Size" optional value={size} onChangeText={changed(setSize)} maxLength={20} />
      <TextField label="Budget" optional prefix="₹" keyboardType="number-pad" value={budgetText} onChangeText={changed(setBudgetText)} error={errors.budget} hint="Whole rupees." />
      <AttachmentPicker label="Photos of what you want (1 to 4)" purpose="REQUEST" max={4} video={false} value={media} onChange={changed(setMedia)} error={errors.media} />
      <Button title={count != null ? `Send to ${count} ${count === 1 ? 'seller' : 'sellers'}` : 'Send to sellers'} loading={create.isPending} onPress={submit} />
      {category && count === 0 ? <AppText tone="muted" size={12}>No seller sells this category yet. Your request will wait for 7 days in case one joins.</AppText> : null}
      {budget != null && budget > 0 ? <AppText tone="muted" size={12}>Budget: {formatRupees(budget)}</AppText> : null}
      {formError && !Object.keys(errors).length ? <AppText tone="danger" size={12} accessibilityRole="alert">{formError}</AppText> : null}
      <AppText tone="muted" size={12}>Requests close after 7 days. Fayda may ban accounts that post false or abusive requests.</AppText>
    </Screen>
  );
}
