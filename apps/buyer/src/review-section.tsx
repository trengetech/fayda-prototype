import { useApiClient, usePutReview } from '@fayda/api-client';
import type { BuyerOrder } from '@fayda/contracts/schemas';
import { validateReview } from '@fayda/domain';
import { AppText, Button, Card, TextField, describeError } from '@fayda/ui';
import { useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { AttachmentPicker, type Attached } from './attachments';
import { newKey } from './orders';
import { StarPicker, starsText } from './stars';

/** Your review of this order: the posted review with Edit, or the form. The server decides who may review (the order must have been confirmed). */
export function ReviewSection({ order, startOpen = false }: { order: BuyerOrder; startOpen?: boolean }) {
  const client = useApiClient();
  const put = usePutReview();
  const r = order.review;
  const [editing, setEditing] = useState(startOpen);
  const [rating, setRating] = useState(r?.rating ?? 0);
  const [text, setText] = useState(r?.text ?? '');
  const [media, setMedia] = useState<Attached[]>((r?.media ?? []).map((m) => ({ id: m.id, kind: m.kind, uri: client.resolveUrl(m.url) })));
  const [touched, setTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const key = useRef(newKey());

  if (!r && !order.canReview) return null;

  if (r && !editing)
    return (
      <Card>
        <AppText weight="bold">Your review</AppText>
        <AppText size={18} tone="accent" accessibilityLabel={`${r.rating} out of 5 stars`}>{starsText(r.rating)}</AppText>
        {r.text ? <AppText>{r.text}</AppText> : null}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {r.media.map((m) => (m.kind === 'image' ? <Image key={m.id} source={{ uri: client.resolveUrl(m.url) }} style={{ width: 64, height: 64, borderRadius: 8 }} accessibilityIgnoresInvertColors /> : <AppText key={m.id} tone="muted" size={12}>Video</AppText>))}
        </View>
        <Button title="Edit review" variant="outline" onPress={() => setEditing(true)} />
      </Card>
    );

  const submit = () => {
    setFormError(null);
    const v = validateReview({ rating, text, media });
    setErrors(v.errors);
    if (Object.keys(v.errors).length) return;
    put.mutate(
      { orderId: order.id, input: { rating: v.rating, text: v.text, ...(touched || !r ? { mediaIds: media.map((m) => m.id) } : {}) }, idempotencyKey: key.current },
      {
        onSuccess: () => {
          key.current = newKey();
          setEditing(false);
          setTouched(false);
        },
        onError: (e) => {
          const d = describeError(e);
          setErrors(d.fields);
          setFormError(d.message);
        },
      },
    );
  };
  const changed = <T,>(set: (v: T) => void) => (v: T) => {
    key.current = newKey();
    set(v);
  };

  return (
    <Card>
      <AppText weight="bold">{r ? 'Edit your review' : 'Rate this seller'}</AppText>
      <StarPicker value={rating} onChange={changed(setRating)} />
      {errors.rating ? <AppText tone="danger" size={12} accessibilityRole="alert">{errors.rating}</AppText> : null}
      <TextField label="Your review" multiline value={text} onChangeText={changed(setText)} maxLength={1000} error={errors.text} hint="Be honest. Reviews are public on the seller’s page. Fayda may ban accounts that post false or abusive reviews." />
      <AttachmentPicker label="Photos or videos (up to 4)" purpose="REVIEW" max={4} video value={media} onChange={(v) => { setTouched(true); changed(setMedia)(v); }} error={errors.media} />
      <Button title={r ? 'Save changes' : 'Post review'} loading={put.isPending} onPress={submit} />
      {r ? <Button title="Cancel" variant="ghost" onPress={() => setEditing(false)} /> : null}
      {formError && !errors.rating && !errors.text && !errors.media ? <AppText tone="danger" size={12} accessibilityRole="alert">{formError}</AppText> : null}
    </Card>
  );
}
