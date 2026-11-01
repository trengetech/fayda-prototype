import { useApiClient, useRespondToRequest, useSellerRequests } from '@fayda/api-client';
import type { SellerRequest } from '@fayda/contracts/schemas';
import { RULES, formatRupees } from '@fayda/domain';
import { AppText, Badge, Button, Card, ChipGroup, FieldError, TextField, Thumb, describeError, useTheme } from '@fayda/ui';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Image, RefreshControl, ScrollView, View } from 'react-native';
import { newNonce } from '../../src/listing-form';
import { REQUEST_TABS, RESPONSE_LABEL, inRequestTab, validateRespondForm, type RequestTab } from '../../src/requests';
import { sizeOf, uploadMedia } from '../../src/upload';

function Photos({ media }: { media: SellerRequest['media'] }) {
  const client = useApiClient();
  const { colors } = useTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {media.map((m) => (
        <Image key={m.id} source={{ uri: client.resolveUrl(m.url) }} style={{ width: 96, height: 96, borderRadius: 10, backgroundColor: colors.border }} accessibilityIgnoresInvertColors />
      ))}
    </ScrollView>
  );
}

/** "I have this": a photo of the item, an optional price and message. */
function RespondForm({ request, onDone }: { request: SellerRequest; onDone: () => void }) {
  const client = useApiClient();
  const respond = useRespondToRequest();
  const nonce = useRef(newNonce());
  const [photos, setPhotos] = useState<{ id: string; uri: string }[]>([]);
  const [price, setPrice] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const addPhoto = async () => {
    setError(null);
    const room = RULES.MAX_MEDIA_PER_REQUEST - photos.length;
    if (room < 1) return setErrors({ media: 'Up to 4 photos.' });
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: room, quality: 1 });
    if (picked.canceled) return;
    setBusy(true);
    try {
      const added: { id: string; uri: string }[] = [];
      for (const a of picked.assets.slice(0, room)) {
        const up = await uploadMedia(client, { uri: a.uri, kind: 'image', mime: a.mimeType ?? 'image/jpeg', size: a.fileSize ?? (await sizeOf(a.uri)) }, 'REQUEST');
        added.push({ id: up.id, uri: a.uri });
      }
      setPhotos((cur) => [...cur, ...added]);
      setErrors((e) => ({ ...e, media: '' }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the photo.');
    } finally {
      setBusy(false);
    }
  };
  const submit = () => {
    const v = validateRespondForm({ mediaCount: photos.length, price, text });
    setErrors(v.errors);
    if (Object.keys(v.errors).length) return;
    setError(null);
    respond.mutate(
      { requestId: request.id, input: { text: text.trim() || null, price: v.price, mediaIds: photos.map((p) => p.id) }, idempotencyKey: `respond-${request.id}-${nonce.current}` },
      { onSuccess: onDone, onError: (e) => { const d = describeError(e); setErrors(d.fields); setError(d.message); } },
    );
  };
  return (
    <View style={{ gap: 8 }}>
      <AppText weight="semibold" size={13}>Photos of the item you have ({photos.length}/{RULES.MAX_MEDIA_PER_REQUEST})</AppText>
      {photos.length ? (
        <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>
          {photos.map((p) => <Image key={p.id} source={{ uri: p.uri }} style={{ width: 72, height: 72, borderRadius: 10 }} accessibilityIgnoresInvertColors />)}
        </ScrollView>
      ) : null}
      <Button title="Add a photo" variant="outline" loading={busy} onPress={() => void addPhoto()} />
      <FieldError>{errors.media || undefined}</FieldError>
      <TextField label="Your price" prefix="₹" keyboardType="number-pad" value={price} onChangeText={setPrice} error={errors.price} optional />
      <TextField label="Message" value={text} onChangeText={setText} multiline maxLength={500} error={errors.text} optional />
      <Button title="Send to the buyer" loading={respond.isPending} onPress={submit} />
      <FieldError>{error ?? undefined}</FieldError>
    </View>
  );
}

function RequestCard({ r }: { r: SellerRequest }) {
  const router = useRouter();
  const client = useApiClient();
  const [open, setOpen] = useState(false);
  const res = r.response;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Thumb size={72} source={r.media[0] ? { uri: client.resolveUrl(r.media[0].url) } : null} label={`Photo of ${r.title}`} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText weight="extrabold">{r.title}</AppText>
          <AppText tone="muted" size={12}>{[r.category, r.size ? `Size ${r.size}` : null, r.budget != null ? `Budget ${formatRupees(r.budget)}` : null, r.buyerFirstName].filter(Boolean).join(' · ')}</AppText>
        </View>
      </View>
      {r.description ? <AppText size={13}>{r.description}</AppText> : null}
      {r.media.length > 1 ? <Photos media={r.media} /> : null}
      {res ? (
        <View style={{ gap: 6 }}>
          <Badge label={RESPONSE_LABEL[res.status]} tone={res.status === 'WANTED' ? 'success' : res.status === 'DECLINED' ? 'danger' : 'info'} />
          {res.price != null ? <AppText size={13}>You offered {formatRupees(res.price)}</AppText> : null}
          {res.status === 'WANTED' && res.threadId ? <Button title="Open chat" variant="outline" onPress={() => router.push(`/chat/${res.threadId}` as never)} /> : null}
          {res.status === 'WANTED' && !res.listingId ? <Button title="Create listing" onPress={() => router.push({ pathname: '/listing/[id]', params: { id: 'new', fromResponseId: res.id } } as never)} /> : null}
          {res.listingId ? <AppText tone="success" size={13}>A listing was made for this request.</AppText> : null}
        </View>
      ) : r.status !== 'OPEN' ? (
        <Badge label="Closed" tone="danger" />
      ) : open ? (
        <RespondForm request={r} onDone={() => setOpen(false)} />
      ) : (
        <Button title="I have this — send a photo" onPress={() => setOpen(true)} />
      )}
    </Card>
  );
}

/** What buyers are looking for in the categories you sell. */
export default function RequestsScreen() {
  const { colors } = useTheme();
  const reqs = useSellerRequests();
  const [tab, setTab] = useState<RequestTab>('New');
  const items = (reqs.data?.items ?? []).filter((r) => inRequestTab(r, tab));
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      refreshControl={<RefreshControl refreshing={reqs.isRefetching} onRefresh={() => void reqs.refetch()} />}
    >
      <ChipGroup label="Show" options={REQUEST_TABS} value={[tab]} onChange={(v) => v[0] && setTab(v[0])} format={(t) => (t === 'New' && reqs.data?.newCount ? `New (${reqs.data.newCount})` : t)} />
      {reqs.isPending ? (
        <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading requests…</AppText></View></Card>
      ) : reqs.isError ? (
        <Card>
          <AppText weight="bold">Can’t load requests</AppText>
          <AppText tone="muted" size={13}>{reqs.error.message}</AppText>
          <Button title="Try again" onPress={() => void reqs.refetch()} />
        </Card>
      ) : items.length ? (
        items.map((r) => <RequestCard key={r.id} r={r} />)
      ) : (
        <Card>
          <AppText weight="bold">{tab === 'New' ? 'No new requests' : 'You haven’t responded to any request yet'}</AppText>
          <AppText tone="muted" size={13}>When a buyer asks for something in a category you sell, it shows up here.</AppText>
        </Card>
      )}
    </ScrollView>
  );
}
