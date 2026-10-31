import { useApiClient, useMarkThreadRead, useSellerListings, useSellerRequests, useSendMessage, useThread } from '@fayda/api-client';
import type { SendMessage } from '@fayda/contracts/schemas';
import { formatRupees } from '@fayda/domain';
import { AppText, Badge, Button, Card, FieldError, TextField, describeError, useTheme } from '@fayda/ui';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, View } from 'react-native';
import { forgetKey, keyFor, type KeyMemory } from '../../src/chat';
import { sizeOf, uploadMedia } from '../../src/upload';

/** One chat: the timeline, a box to write in, a photo button, and a way to share one of your live listings. */
export default function ChatScreen() {
  const { id, published } = useLocalSearchParams<{ id: string; published?: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const client = useApiClient();
  const thread = useThread('seller', id ?? null);
  const send = useSendMessage('seller');
  const markRead = useMarkThreadRead('seller');
  const requests = useSellerRequests();
  const listings = useSellerListings();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [busy, setBusy] = useState(false);
  const mem = useRef<KeyMemory>({ sig: null, key: null });
  const messageCount = thread.data?.messages.length ?? 0;

  // Opening the chat (and new messages arriving while it is open) marks it read.
  useEffect(() => {
    if (id && thread.data && thread.data.unread > 0) markRead.mutate(id);
  }, [id, messageCount, thread.data?.unread]);

  if (thread.isPending) return <View style={{ flex: 1, padding: 16 }}><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator /><AppText>Loading chat…</AppText></View></View>;
  if (thread.isError)
    return (
      <View style={{ flex: 1, padding: 16, gap: 8 }}>
        <AppText weight="bold">Can’t load this chat</AppText>
        <AppText tone="muted">{thread.error.message}</AppText>
        <Button title="Try again" onPress={() => void thread.refetch()} />
      </View>
    );
  const t = thread.data;
  const request = t.kind === 'REQUEST' ? (requests.data?.items ?? []).find((r) => r.id === t.requestId) : undefined;

  const post = (input: SendMessage, sig: string, after?: () => void) => {
    setError(null);
    // A retry of the same message reuses its key, so a lost reply cannot post it twice.
    const clientKey = keyFor(mem.current, sig);
    send.mutate(
      { threadId: t.id, input: { ...input, clientKey } },
      {
        onSuccess: () => {
          forgetKey(mem.current);
          after?.();
        },
        onError: (e) => setError(describeError(e).message),
      },
    );
  };
  const sendText = () => {
    const body = text.trim();
    if (!body) return setError('Write a message first.');
    post({ text: body }, `text:${body}`, () => setText(''));
  };
  const attach = async () => {
    setError(null);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (picked.canceled || !picked.assets[0]) return;
    const a = picked.assets[0];
    setBusy(true);
    try {
      const up = await uploadMedia(client, { uri: a.uri, kind: 'image', mime: a.mimeType ?? 'image/jpeg', size: a.fileSize ?? (await sizeOf(a.uri)) }, 'CHAT');
      post({ mediaId: up.id }, `media:${up.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload the photo.');
    } finally {
      setBusy(false);
    }
  };
  const live = (listings.data ?? []).filter((l) => l.status === 'ACTIVE');

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, gap: 10 }}>
      <View style={{ gap: 2 }}>
        <AppText weight="extrabold" size={18}>{t.title}</AppText>
        <AppText tone="muted" size={13}>{t.otherName}</AppText>
        {t.orderId ? <Button title="View order" size="sm" variant="outline" onPress={() => router.push(`/order/${t.orderId}` as never)} /> : null}
      </View>
      {published ? <Badge label="Published and shared in the chat" tone="success" /> : null}
      {request ? (
        <Card>
          <AppText weight="bold">Request: {request.title}</AppText>
          {request.description ? <AppText tone="muted" size={13}>{request.description}</AppText> : null}
          {request.size ? <AppText tone="muted" size={13}>Size {request.size}</AppText> : null}
          {request.response?.status === 'WANTED' && !request.response.listingId ? (
            <Button title="Create listing" onPress={() => router.push({ pathname: '/listing/[id]', params: { id: 'new', fromResponseId: request.response!.id } } as never)} />
          ) : request.response?.listingId ? (
            <AppText tone="success" size={13}>A listing was made for this request.</AppText>
          ) : null}
        </Card>
      ) : null}

      {t.messages.map((m) => (
        <View key={m.id} style={{ alignItems: m.from === 'ME' ? 'flex-end' : m.from === 'SYSTEM' ? 'center' : 'flex-start' }}>
          <View style={{ maxWidth: '85%', padding: 10, borderRadius: 14, gap: 6, backgroundColor: m.from === 'ME' ? colors.accent : m.from === 'SYSTEM' ? colors.border : colors.surface, borderWidth: m.from === 'OTHER' ? 1 : 0, borderColor: colors.border }}>
            {m.media ? <Image source={{ uri: client.resolveUrl(m.media.url) }} style={{ width: 200, height: 200, borderRadius: 10 }} accessibilityLabel="Photo in chat" accessibilityIgnoresInvertColors /> : null}
            {m.listing ? (
              <View style={{ gap: 2 }}>
                <AppText weight="bold" tone={m.from === 'ME' ? 'ink' : 'ink'}>{m.listing.title}</AppText>
                <AppText>{formatRupees(m.listing.price)}</AppText>
              </View>
            ) : null}
            {m.text ? <AppText tone={m.from === 'SYSTEM' ? 'muted' : 'ink'} size={m.from === 'SYSTEM' ? 12 : undefined}>{m.text}</AppText> : null}
          </View>
        </View>
      ))}

      {sharing ? (
        <Card>
          <AppText weight="bold">Share a listing</AppText>
          {live.length ? (
            live.map((l) => (
              <Button key={l.id} title={`${l.title} · ${formatRupees(l.price)}`} variant="outline" onPress={() => post({ listingId: l.id }, `listing:${l.id}`, () => setSharing(false))} />
            ))
          ) : (
            <AppText tone="muted" size={13}>You have no live listings to share. Publish one first.</AppText>
          )}
          <Button title="Close" variant="ghost" onPress={() => setSharing(false)} />
        </Card>
      ) : null}

      <TextField label="Message" value={text} onChangeText={setText} multiline maxLength={1000} />
      <Button title="Send" loading={send.isPending} onPress={sendText} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Button title="Add a photo" variant="outline" loading={busy} onPress={() => void attach()} /></View>
        <View style={{ flex: 1 }}><Button title="Share a listing" variant="outline" onPress={() => setSharing((s) => !s)} /></View>
      </View>
      <FieldError>{error ?? undefined}</FieldError>
    </ScrollView>
  );
}
