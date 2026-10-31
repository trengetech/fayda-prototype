import { useApiClient, useMarkThreadRead, useSendMessage, useThread } from '@fayda/api-client';
import type { ChatMessageView } from '@fayda/contracts/schemas';
import { formatRupees } from '@fayda/domain';
import { AppText, Button, Card, TextField, describeError, useTheme } from '@fayda/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, View } from 'react-native';
import { AttachmentPicker, type Attached } from '../../src/attachments';
import { newKey } from '../../src/orders';

function Bubble({ m }: { m: ChatMessageView }) {
  const { colors } = useTheme();
  const client = useApiClient();
  const router = useRouter();
  if (m.from === 'SYSTEM')
    return <AppText tone="muted" size={12} style={{ textAlign: 'center' }}>{m.text}</AppText>;
  const mine = m.from === 'ME';
  return (
    <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: mine ? colors.accentTint : colors.border, borderRadius: 14, padding: 10, gap: 6 }}>
      {m.media ? <Image source={client.getChatPhotoSource(m.media.url)} style={{ width: 200, height: 200, borderRadius: 10 }} accessibilityLabel="Photo in the chat" accessibilityIgnoresInvertColors /> : null}
      {m.text ? <AppText selectable>{m.text}</AppText> : null}
      {m.listing ? (
        <View style={{ gap: 4 }}>
          {m.listing.coverUrl ? <Image source={{ uri: client.resolveUrl(m.listing.coverUrl) }} style={{ width: 200, height: 120, borderRadius: 10 }} accessibilityIgnoresInvertColors /> : null}
          <AppText weight="bold">{m.listing.title}</AppText>
          <AppText>{formatRupees(m.listing.price)}</AppText>
          <Button title="View and buy" size="sm" onPress={() => router.push(`/listing/${m.listing?.id}` as never)} />
        </View>
      ) : null}
    </View>
  );
}

/** One chat: the timeline (system messages included), text and photos. Opening it marks the messages read. */
export default function ChatScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useThread('buyer', id ?? null);
  const send = useSendMessage('buyer');
  const markRead = useMarkThreadRead('buyer');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<Attached[]>([]);
  const [error, setError] = useState<string | null>(null);
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
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, gap: 10 }} keyboardShouldPersistTaps="handled">
      <AppText weight="extrabold" size={18}>{t.title}</AppText>
      <AppText tone="muted" size={12}>Chatting with {t.otherName}</AppText>
      {t.messages.map((m) => <Bubble key={m.id} m={m} />)}
      <Card>
        <TextField label="Message" multiline value={text} onChangeText={edited(setText)} maxLength={1000} />
        <AttachmentPicker label="Photo" purpose="CHAT" max={1} video={false} value={photo} onChange={edited(setPhoto)} />
        <Button title="Send" disabled={!canSend} loading={send.isPending} onPress={submit} />
        {error ? <AppText tone="danger" size={12} accessibilityRole="alert">{error}</AppText> : null}
      </Card>
    </ScrollView>
  );
}
