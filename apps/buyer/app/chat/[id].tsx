import { useApiClient, useMarkThreadRead, useSendMessage, useThread } from '@fayda/api-client';
import type { ChatMessageView } from '@fayda/contracts/schemas';
import { formatRupees } from '@fayda/domain';
import { ActionBar, AppBar, AppText, Bubble, BubbleText, Button, Card, Composer, IconButton, SystemNote, Thumb, describeError, useTheme } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, View, type ScrollViewInstance } from 'react-native';
import { AttachmentPicker, type Attached } from '../../src/attachments';
import { newKey } from '../../src/orders';
import { BlockedNotice, MessageSafety } from '../../src/safety';

function Message({ m, threadId, who }: { m: ChatMessageView; threadId: string; who: string }) {
  const { colors } = useTheme();
  const client = useApiClient();
  const router = useRouter();
  if (m.from === 'SYSTEM') return <SystemNote>{m.text}</SystemNote>;
  const mine = m.from === 'ME';
  if (m.listing)
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${m.listing.title}`} onPress={() => router.push(`/listing/${m.listing?.id}` as never)} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%', flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 14, borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.surface }}>
        <Thumb size={56} source={m.listing.coverUrl ? { uri: client.resolveUrl(m.listing.coverUrl) } : null} label={m.listing.title} />
        <View style={{ flexShrink: 1 }}>
          <AppText weight="extrabold" size={12} numberOfLines={1}>{m.listing.title}</AppText>
          <AppText weight="extrabold" size={13}>{formatRupees(m.listing.price)}</AppText>
          <AppText tone="accent" weight="extrabold" size={11}>View and buy ›</AppText>
        </View>
      </Pressable>
    );
  return (
    <View style={{ gap: 4 }}>
      {m.media ? <Image source={client.getChatPhotoSource(m.media.url)} style={{ alignSelf: mine ? 'flex-end' : 'flex-start', width: 180, height: 220, borderRadius: 14 }} accessibilityLabel="Photo in the chat" accessibilityIgnoresInvertColors /> : null}
      {m.text ? (
        <Bubble me={mine} maxWidth="80%">
          <BubbleText me={mine}>{m.text}</BubbleText>
        </Bubble>
      ) : null}
      {m.from === 'OTHER' ? <View style={{ alignSelf: 'flex-start' }}><MessageSafety threadId={threadId} messageId={m.id} who={who} /></View> : null}
    </View>
  );
}

/** One chat: the timeline (system messages included), text and photos. Opening it marks the messages read. */
export default function ChatScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const q = useThread('buyer', id ?? null);
  const send = useSendMessage('buyer');
  const markRead = useMarkThreadRead('buyer');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<Attached[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const scroller = useRef<ScrollViewInstance>(null);
  const clientKey = useRef(newKey());
  const unread = q.data?.unread ?? 0;
  const read = markRead.mutate;

  // Mark read when the chat opens, and again whenever new messages arrive while it is open.
  useEffect(() => {
    if (id && unread > 0) read(id);
  }, [id, unread, read]);

  if (q.isPending) return <View style={{ flex: 1, padding: 16, backgroundColor: colors.surface }}><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading the chat…</AppText></View></View>;
  if (q.isError)
    return (
      <View style={{ flex: 1, padding: 16, backgroundColor: colors.surface }}>
        <Card>
          <AppText weight="bold">Can’t open this chat</AppText>
          <AppText tone="muted" size={13}>{q.error.message}</AppText>
          <Button title="Try again" onPress={() => void q.refetch()} />
        </Card>
      </View>
    );
  const t = q.data;
  const canSend = (text.trim().length > 0 || photo.length > 0) && !send.isPending;

  const submit = () => {
    setError(null);
    const mediaId = photo[0]?.id;
    send.mutate(
      { threadId: t.id, input: { text: text.trim() || null, mediaId: mediaId ?? null, clientKey: clientKey.current } },
      {
        onSuccess: () => {
          clientKey.current = newKey();
          setText('');
          setPhoto([]);
        },
        // The same clientKey is kept on failure, so a retry cannot post the message twice.
        onError: (e) => setError(describeError(e).message),
      },
    );
  };
  const edited = <T,>(set: (v: T) => void) => (v: T) => {
    clientKey.current = newKey();
    set(v);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <AppBar title={t.otherName} onBack={() => router.back()} />
      <ScrollView ref={scroller} onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: false })} contentContainerStyle={{ padding: 14, gap: 8 }} keyboardShouldPersistTaps="handled">
        <AppText tone="muted" size={12}>{t.title}</AppText>
        {t.messages.map((m) => <Message key={m.id} m={m} threadId={t.id} who={t.otherName} />)}
      </ScrollView>
      {t.messagingDisabled ? (
        <ActionBar><BlockedNotice youBlocked={t.youBlocked} onOpenBlocked={() => router.push('/blocked' as never)} /></ActionBar>
      ) : (
        <>
          {photoOpen || photo.length ? (
            <View style={{ paddingHorizontal: 14, paddingTop: 8, backgroundColor: colors.surface }}>
              <AttachmentPicker label="Photo" purpose="CHAT" max={1} video={false} value={photo} onChange={edited(setPhoto)} />
            </View>
          ) : null}
          {error ? <View style={{ paddingHorizontal: 14, backgroundColor: colors.surface }}><AppText tone="danger" size={12} accessibilityRole="alert">{error}</AppText></View> : null}
          <Composer value={text} onChangeText={edited(setText)} canSend={canSend} sending={send.isPending} onSend={submit} left={<IconButton plain icon="clip" label="Attach photo" onPress={() => setPhotoOpen((o) => !o)} />} />
        </>
      )}
    </View>
  );
}
