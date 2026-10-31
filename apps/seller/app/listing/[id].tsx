import { useApiClient, useDeleteListingDraft, useSaveListing, useSellerListing, useSetListingStatus } from '@fayda/api-client';
import { CATEGORY_NAMES, type SellerListing } from '@fayda/contracts/schemas';
import { RULES } from '@fayda/domain';
import { zodResolver } from '@hookform/resolvers/zod';
import { AppText, Button, Card, ChipGroup, FieldError, Screen, TextField, describeError, useTheme } from '@fayda/ui';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { useRef, useState } from 'react';
import { Controller, useFieldArray, useForm, type FieldPath } from 'react-hook-form';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, View } from 'react-native';
import {
  EXPIRY_MINUTES,
  expiryLabel,
  EditorSchema,
  FIELD_MAP,
  MODES,
  MODE_HINT,
  MODE_LABEL,
  emptyValues,
  fromListing,
  newNonce,
  saveKey,
  toInput,
  type EditorMedia,
  type EditorValues,
} from '../../src/listing-form';
import { sizeOf, uploadMedia } from '../../src/upload';

const CHANNEL_LABEL = { DIRECT: 'Pay me directly', WEBSITE: 'My website' } as const;
const DEAL_LABEL = { CODE: 'Coupon code', LINK: 'Discount link' } as const;
const SECTION_FIELDS = ['media', 'variants', 'channel'] as const;

/** Opens the editor for a new listing (`/listing/new`) or an existing one (`/listing/<id>`). */
export default function ListingScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const existingId = id && id !== 'new' ? id : null;
  const listing = useSellerListing(existingId);
  if (!existingId) return <Editor existing={null} />;
  if (listing.isPending) return <Screen><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator /><AppText>Loading…</AppText></View></Screen>;
  if (listing.isError) return <Screen><AppText weight="bold">Can’t load this listing</AppText><AppText tone="muted">{listing.error.message}</AppText><Button title="Try again" onPress={() => void listing.refetch()} /></Screen>;
  return <Editor existing={listing.data} />;
}

function Editor({ existing }: { existing: SellerListing | null }) {
  const router = useRouter();
  const client = useApiClient();
  const { colors } = useTheme();
  const save = useSaveListing();
  const setStatus = useSetListingStatus();
  const remove = useDeleteListingDraft();
  const nonce = useRef(newNonce());
  const initial = existing ? fromListing(existing) : { values: emptyValues(), media: [] as EditorMedia[] };

  const form = useForm<EditorValues>({ resolver: zodResolver(EditorSchema), defaultValues: initial.values });
  const sizes = useFieldArray({ control: form.control, name: 'variants' });
  const [media, setMedia] = useState<EditorMedia[]>(initial.media);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaNote, setMediaNote] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sectionErrors, setSectionErrors] = useState<Record<string, string>>({});
  const [moreRules, setMoreRules] = useState(!!existing && (existing.rules.autoDeclineBelow != null || existing.rules.autoCounterAt != null));

  const mode = form.watch('mode');
  const channel = form.watch('channel');
  const priced = mode === 'BOTH';
  const status = existing?.status ?? 'DRAFT';
  const isDraft = status === 'DRAFT';
  const src = (u: string) => client.resolveUrl(u);

  // ---------- media ----------
  const addFiles = async () => {
    setMediaNote(null);
    const room = RULES.MAX_MEDIA_PER_LISTING - media.length;
    if (room < 1) return setMediaNote(`Up to ${RULES.MAX_MEDIA_PER_LISTING} photos or videos per listing.`);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], allowsMultipleSelection: true, selectionLimit: room, quality: 1 });
    if (picked.canceled) return;
    setMediaBusy(true);
    const notes: string[] = [];
    const added: EditorMedia[] = [];
    for (const asset of picked.assets.slice(0, room)) {
      const name = asset.fileName ?? 'File';
      const kind = asset.type === 'video' ? 'video' : 'image';
      try {
        const size = asset.fileSize ?? (await sizeOf(asset.uri));
        const durationSec = asset.duration != null ? asset.duration / 1000 : null;
        const main = await uploadMedia(client, { uri: asset.uri, kind, mime: asset.mimeType ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg'), size, durationSec }, 'LISTING');
        let poster: { id: string } | null = null;
        let preview = asset.uri;
        if (kind === 'video') {
          // The cover photo for a video is made on this phone (I-14), so feed cards have a picture.
          const thumb = await VideoThumbnails.getThumbnailAsync(asset.uri, { time: 0 });
          poster = await uploadMedia(client, { uri: thumb.uri, kind: 'image', mime: 'image/jpeg', size: await sizeOf(thumb.uri) }, 'LISTING');
          preview = thumb.uri;
        }
        added.push({ mediaId: main.id, kind, previewUri: preview, posterMediaId: poster?.id ?? null });
      } catch (e) {
        notes.push(`${name}: ${e instanceof Error ? e.message : 'could not upload.'}`);
      }
    }
    setMedia((cur) => [...cur, ...added]);
    setSectionErrors((cur) => ({ ...cur, media: '' }));
    setMediaBusy(false);
    if (notes.length) setMediaNote(notes.join(' '));
  };
  const move = (i: number, by: number) =>
    setMedia((cur) => {
      const j = i + by;
      if (j < 0 || j >= cur.length) return cur;
      const next = cur.slice();
      [next[i], next[j]] = [next[j] as EditorMedia, next[i] as EditorMedia];
      return next;
    });

  // ---------- saving ----------
  const submit = (publish: boolean) =>
    form.handleSubmit(async (values) => {
      setFormError(null);
      setSectionErrors({});
      const input = toInput(values, media, publish);
      try {
        await save.mutateAsync({ id: existing?.id ?? null, input, idempotencyKey: saveKey(nonce.current, input) });
        router.replace('/listings' as never);
      } catch (e) {
        const { message, fields } = describeError(e);
        const sections: Record<string, string> = {};
        let shown = false;
        for (const [key, text] of Object.entries(fields)) {
          const name = FIELD_MAP[key] ?? key;
          if ((SECTION_FIELDS as readonly string[]).includes(name)) sections[name] = text;
          else form.setError(name as FieldPath<EditorValues>, { message: text });
          shown = true;
          if (name === 'autoCounterAt' || name === 'autoDeclineBelow') setMoreRules(true);
        }
        setSectionErrors(sections);
        setFormError(shown ? 'Check the highlighted fields.' : message);
      }
    })();

  const changeStatus = (next: 'ACTIVE' | 'PAUSED') => {
    if (!existing) return;
    setFormError(null);
    setStatus.mutate({ id: existing.id, status: next }, { onSuccess: () => router.replace('/listings' as never), onError: (e) => setFormError(e.message) });
  };
  const confirmDelete = () => {
    if (!existing) return;
    Alert.alert('Delete this draft?', 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(existing.id, { onSuccess: () => router.replace('/listings' as never), onError: (e) => setFormError(e.message) }) },
    ]);
  };

  const tf = (name: FieldPath<EditorValues>, label: string, extra: Partial<React.ComponentProps<typeof TextField>> = {}) => (
    <Controller control={form.control} name={name} render={({ field: f, fieldState }) => <TextField label={label} value={String(f.value ?? '')} onChangeText={f.onChange} error={fieldState.error?.message} {...extra} />} />
  );
  const busy = save.isPending || mediaBusy;

  return (
    <Screen>
      <AppText weight="extrabold" size={22}>{existing ? 'Edit listing' : 'New listing'}</AppText>

      {/* Media */}
      <View style={{ gap: 8 }}>
        <AppText weight="semibold" size={13}>Photos and videos ({media.length}/{RULES.MAX_MEDIA_PER_LISTING})</AppText>
        <AppText tone="muted" size={12}>The first one is the cover. Reels up to {RULES.MAX_REEL_SECONDS} seconds (80 MB), photos up to 15 MB.</AppText>
        {media.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
            {media.map((m, i) => (
              <View key={m.mediaId} style={{ width: 96, gap: 4 }}>
                <Image source={{ uri: src(m.previewUri) }} style={{ width: 96, height: 96, borderRadius: 10, backgroundColor: colors.border }} accessibilityIgnoresInvertColors />
                <AppText size={11} tone="muted">{i === 0 ? 'Cover' : m.kind === 'video' ? 'Video' : 'Photo'}{i === 0 && m.kind === 'video' ? ' · Video' : ''}</AppText>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Pressable accessibilityLabel={`Move ${m.kind} ${i + 1} earlier`} onPress={() => move(i, -1)} hitSlop={8}><AppText>◀</AppText></Pressable>
                  <Pressable accessibilityLabel={`Remove ${m.kind} ${i + 1}`} onPress={() => setMedia((cur) => cur.filter((x) => x.mediaId !== m.mediaId))} hitSlop={8}><AppText tone="danger">✕</AppText></Pressable>
                  <Pressable accessibilityLabel={`Move ${m.kind} ${i + 1} later`} onPress={() => move(i, 1)} hitSlop={8}><AppText>▶</AppText></Pressable>
                </View>
              </View>
            ))}
          </ScrollView>
        ) : null}
        <Button title={media.length ? 'Add more' : 'Add photos or videos'} variant="outline" size="sm" loading={mediaBusy} onPress={() => void addFiles()} disabled={busy} />
        {mediaBusy ? <AppText tone="muted" size={12}>Uploading… keep this screen open.</AppText> : null}
        <FieldError>{mediaNote ?? (sectionErrors.media || undefined)}</FieldError>
      </View>

      {tf('title', 'Title', { maxLength: 80 })}
      {tf('description', 'Description', { multiline: true, optional: true, maxLength: 600 })}
      <Controller control={form.control} name="category" render={({ field: f, fieldState }) => <ChipGroup label="Category" options={CATEGORY_NAMES} value={f.value ? [f.value as (typeof CATEGORY_NAMES)[number]] : []} onChange={(v) => f.onChange(v[0] ?? '')} error={fieldState.error?.message} />} />
      {tf('price', 'Price', { keyboardType: 'number-pad', prefix: '₹', maxLength: 8, hint: 'Whole rupees, from ₹50 to ₹10,00,000.' })}

      {/* Sizes */}
      <View style={{ gap: 8 }}>
        <AppText weight="semibold" size={13}>Sizes and stock</AppText>
        {sizes.fields.map((f, i) => (
          <Card key={f.id}>
            {tf(`variants.${i}.label` as FieldPath<EditorValues>, 'Size or option', { placeholder: 'M', maxLength: 60 })}
            {tf(`variants.${i}.stock` as FieldPath<EditorValues>, 'Units in stock', { keyboardType: 'number-pad', maxLength: 5 })}
            {sizes.fields.length > 1 ? <Button title="Remove this size" variant="ghost" size="sm" onPress={() => sizes.remove(i)} /> : null}
          </Card>
        ))}
        <Button title="Add a size" variant="outline" size="sm" onPress={() => sizes.append({ label: '', stock: '' })} />
        <FieldError>{sectionErrors.variants || undefined}</FieldError>
      </View>

      {/* Bargaining */}
      <Controller control={form.control} name="mode" render={({ field: f, fieldState }) => <ChipGroup label="How can buyers buy?" options={MODES} value={[f.value]} onChange={(v) => v[0] && f.onChange(v[0])} format={(m) => MODE_LABEL[m]} error={fieldState.error?.message} />} />
      <AppText tone="muted" size={12}>{MODE_HINT[mode]}</AppText>
      {priced ? (
        <>
          <Controller control={form.control} name="expiryMinutes" render={({ field: f, fieldState }) => <ChipGroup label="Offers expire after" options={EXPIRY_MINUTES} value={[f.value]} onChange={(v) => v[0] && f.onChange(v[0])} format={expiryLabel} error={fieldState.error?.message} />} />
          <Card>
            <AppText weight="bold">Your private rules</AppText>
            <AppText tone="muted" size={12}>Only you see these. Buyers never learn that a reply was automatic.</AppText>
            {tf('autoAcceptAt', 'Accept automatically at or above', { keyboardType: 'number-pad', prefix: '₹', optional: true, maxLength: 8, hint: 'Your lowest price.' })}
            {moreRules ? (
              <>
                {tf('autoCounterAt', 'Counter automatically with', { keyboardType: 'number-pad', prefix: '₹', optional: true, maxLength: 8, hint: 'Sent 5 seconds after an offer below your lowest price. At or above your lowest price.' })}
                {tf('autoDeclineBelow', 'Decline automatically below', { keyboardType: 'number-pad', prefix: '₹', optional: true, maxLength: 8, hint: 'Declined after 2 minutes. Below your lowest price.' })}
              </>
            ) : (
              <Button title="More rules" variant="ghost" size="sm" onPress={() => setMoreRules(true)} />
            )}
          </Card>
        </>
      ) : null}

      {/* Checkout */}
      <Controller control={form.control} name="channel" render={({ field: f }) => <ChipGroup label="Where do buyers complete the purchase?" options={['DIRECT', 'WEBSITE'] as const} value={[f.value]} onChange={(v) => v[0] && f.onChange(v[0])} format={(c) => CHANNEL_LABEL[c]} error={sectionErrors.channel || undefined} />} />
      {channel === 'WEBSITE' ? (
        <>
          {tf('productUrl', 'Link to this product on your website', { autoCapitalize: 'none', placeholder: 'https://' })}
          {priced && form.watch('autoAcceptAt') ? (
            <Card>
              <Controller control={form.control} name="acceptType" render={({ field: f }) => <ChipGroup label="For your automatic price" options={['CODE', 'LINK'] as const} value={[f.value]} onChange={(v) => v[0] && f.onChange(v[0])} format={(t) => DEAL_LABEL[t]} />} />
              {tf('acceptValue', 'Code or link buyers use', { autoCapitalize: 'none' })}
            </Card>
          ) : null}
          {priced && form.watch('autoCounterAt') ? (
            <Card>
              <Controller control={form.control} name="counterType" render={({ field: f }) => <ChipGroup label="For your automatic counter" options={['CODE', 'LINK'] as const} value={[f.value]} onChange={(v) => v[0] && f.onChange(v[0])} format={(t) => DEAL_LABEL[t]} />} />
              {tf('counterValue', 'Code or link buyers use', { autoCapitalize: 'none' })}
            </Card>
          ) : null}
        </>
      ) : null}

      <FieldError>{formError ?? undefined}</FieldError>
      {isDraft ? (
        <View style={{ gap: 8 }}>
          <Button title="Publish" size="lg" loading={save.isPending} disabled={busy} onPress={() => void submit(true)} />
          <Button title="Save draft" variant="outline" disabled={busy} onPress={() => void submit(false)} />
          {existing ? <Button title="Delete draft" variant="ghost" onPress={confirmDelete} /> : null}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Button title="Save changes" size="lg" loading={save.isPending} disabled={busy} onPress={() => void submit(status === 'ACTIVE')} />
          <Button title={status === 'ACTIVE' ? 'Pause listing' : 'Resume listing'} variant="outline" loading={setStatus.isPending} disabled={busy} onPress={() => changeStatus(status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE')} />
        </View>
      )}
      <Button title="Cancel" variant="ghost" onPress={() => router.back()} />
    </Screen>
  );
}
