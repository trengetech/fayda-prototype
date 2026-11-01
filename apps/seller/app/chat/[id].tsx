import { useApiClient, useMarkThreadRead, useSellerListings, useSellerRequests, useSendMessage, useThread } from '@fayda/api-client';
import type { SendMessage } from '@fayda/contracts/schemas';
import { formatRupees } from '@fayda/domain';
import { ActionBar, AppBar, AppText, Badge, Bubble, BubbleText, Button, Card, Composer, FieldError, IconButton, Sheet, SystemNote, Thumb, describeError, useTheme } from '@fayda/ui';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { forgetKey, keyFor, type KeyMemory } from '../../src/chat';
import { BlockedNotice, MessageSafety } from '../../src/safety';
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
  const scroller = useRef<ScrollViewInstance>(null);
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
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppBar title={t.otherName} onBack={() => router.back()} right={t.orderId ? <Button title="View order" size="sm" variant="outline" block={false} onPress={() => router.push(`/order/${t.orderId}` as never)} /> : undefined} />
      <ScrollView ref={scroller} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })} contentContainerStyle={{ padding: 14, gap: 8 }} keyboardShouldPersistTaps="handled">
        <AppText tone="muted" size={12}>{t.title}</AppText>
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
        {t.messages.map((m) => {
          if (m.from === 'SYSTEM') return <SystemNote key={m.id}>{m.text}</SystemNote>;
          const mine = m.from === 'ME';
          if (m.listing)
            return (
              <View key={m.id} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%', flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface }}>
                <Thumb size={56} source={m.listing.coverUrl ? { uri: client.resolveUrl(m.listing.coverUrl) } : null} label={m.listing.title} />
                <View style={{ flexShrink: 1 }}>
                  <AppText weight="extrabold" size={12} numberOfLines={1}>{m.listing.title}</AppText>
                  <AppText weight="extrabold" size={13}>{formatRupees(m.listing.price)}</AppText>
                </View>
              </View>
            );
          return (
            <View key={m.id} style={{ gap: 4 }}>
              {m.media ? <Image source={client.getChatPhotoSource(m.media.url)} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', width: 180, height: 220, borderRadius: 14 }} accessibilityLabel="Photo in chat" accessibilityIgnoresInvertColors /> : null}
              {m.text ? <Bubble me={mine} maxWidth="80%"><BubbleText me={mine}>{m.text}</BubbleText></Bubble> : null}
              {m.from === 'OTHER' ? <View style={{ alignSelf: 'flex-start' }}><MessageSafety threadId={t.id} messageId={m.id} who={t.otherName} /></View> : null}
            </View>
          );
        })}
      </ScrollView>
      {t.messagingDisabled ? (
        <ActionBar><BlockedNotice youBlocked={t.youBlocked} onOpenBlocked={() => router.push('/blocked' as never)} /></ActionBar>
      ) : (
        <>
          {busy ? <View style={{ paddingHorizontal: 14, paddingTop: 6, backgroundColor: colors.surface }}><AppText tone="muted" size={12}>Uploading photo…</AppText></View> : null}
          {error ? <View style={{ paddingHorizontal: 14, backgroundColor: colors.surface }}><FieldError>{error}</FieldError></View> : null}
          <Composer
            value={text}
            onChangeText={setText}
            canSend={!!text.trim() && !send.isPending}
            sending={send.isPending}
            onSend={sendText}
            left={
              <>
                <IconButton plain icon="clip" label="Add a photo" onPress={() => void attach()} />
                <IconButton plain icon="tag" label="Share a listing" onPress={() => setSharing((x) => !x)} />
              </>
            }
          />
        </>
      )}
      <Sheet visible={sharing} title="Share a listing" onClose={() => setSharing(false)}>
        {live.length ? (
          live.map((l) => (
            <Button key={l.id} title={`${l.title} · ${formatRupees(l.price)}`} variant="outline" onPress={() => post({ listingId: l.id }, `listing:${l.id}`, () => setSharing(false))} />
          ))
        ) : (
          <AppText tone="muted" size={13}>You have no live listings to share. Publish one first.</AppText>
        )}
      </Sheet>
    </View>
  );
}
