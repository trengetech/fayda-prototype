import { useComments, usePostComment, useRemoveComment, useSellerListing } from '@fayda/api-client';
import type { Comment } from '@fayda/contracts/schemas';
import { COMMENT_MAX_CHARS, formatAgo } from '@fayda/domain';
import { AppText, Badge, Button, Card, TextField, describeError, useTheme } from '@fayda/ui';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, View } from 'react-native';

const newKey = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

/**
 * The public comments on one of the seller's listings: read them, reply as the shop, and remove any (the seller owns the
 * listing's page). Buyers are shown by first name only; the seller never sees who liked or saved.
 */
export default function CommentsScreen() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const listing = useSellerListing(id ?? null);
  const q = useComments('seller', id ?? null);
  const post = usePostComment('seller');
  const remove = useRemoveComment('seller');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef({ clientKey: newKey(), idem: newKey() });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;
  const { fetchNextPage } = q;

  const change = (v: string) => {
    setText(v);
    setError(null);
    attempt.current = { clientKey: newKey(), idem: newKey() };
  };
  const send = () =>
    post.mutate(
      { listingId: id as string, input: { text, clientKey: attempt.current.clientKey }, idempotencyKey: attempt.current.idem },
      {
        onSuccess: () => {
          setText('');
          attempt.current = { clientKey: newKey(), idem: newKey() };
        },
        onError: (e) => setError(describeError(e).fields.text ?? describeError(e).message),
      },
    );
  const confirmRemove = (c: Comment) =>
    Alert.alert('Remove this comment?', 'It disappears for everyone. The buyer is not told.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(c.id) },
    ]);

  return (
    <FlatList
      testID="comments-list"
      style={{ flex: 1, backgroundColor: colors.surface }}
      contentContainerStyle={{ padding: 16, gap: 12 }}
      data={items}
      keyExtractor={(c) => c.id}
      refreshing={q.isRefetching && !q.isFetchingNextPage}
      onRefresh={() => void q.refetch()}
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (q.hasNextPage && !q.isFetchingNextPage) void fetchNextPage();
      }}
      ListHeaderComponent={
        <View style={{ gap: 12 }}>
          <AppText weight="extrabold" size={20}>Comments</AppText>
          <AppText tone="muted" size={13}>{listing.data?.title ?? ''}{total ? ` · ${total} ${total === 1 ? 'comment' : 'comments'}` : ''}</AppText>
          <Card>
            <TextField label="Reply as your shop" value={text} onChangeText={change} multiline maxLength={COMMENT_MAX_CHARS * 2} error={error ?? undefined} hint={`Public. Up to ${COMMENT_MAX_CHARS} characters.`} />
            <Button title="Post reply" loading={post.isPending} disabled={!text.trim()} onPress={send} />
          </Card>
        </View>
      }
      renderItem={({ item: c }) => (
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AppText weight="bold" size={13}>{c.author.name}</AppText>
            {c.author.shop ? <Badge label="Your shop" tone="info" /> : null}
            <AppText tone="faint" size={12}>{formatAgo(c.at, Date.now())}</AppText>
          </View>
          <AppText selectable>{c.text}</AppText>
          {c.canRemove ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove comment by ${c.author.name}`} disabled={remove.isPending} onPress={() => confirmRemove(c)} hitSlop={8}>
              <AppText tone="danger" size={12}>Remove</AppText>
            </Pressable>
          ) : null}
        </Card>
      )}
      ListEmptyComponent={
        q.isPending ? (
          <Card><View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}><ActivityIndicator color={colors.accent} /><AppText>Loading…</AppText></View></Card>
        ) : q.isError ? (
          <Card><AppText weight="bold">Can’t load comments</AppText><AppText tone="muted" size={13}>{q.error.message}</AppText><Button title="Try again" onPress={() => void q.refetch()} /></Card>
        ) : (
          <Card><AppText weight="bold">No comments yet</AppText><AppText tone="muted" size={13}>When a buyer asks something about this listing, it shows up here.</AppText></Card>
        )
      }
      ListFooterComponent={q.isFetchingNextPage ? <ActivityIndicator color={colors.accent} /> : undefined}
    />
  );
}
