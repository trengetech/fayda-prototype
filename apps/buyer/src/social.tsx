import { useComments, usePostComment, useRemoveComment, useSetLike, useSetSave } from '@fayda/api-client';
import type { Comment } from '@fayda/contracts/schemas';
import { CommentSafety } from './safety';
import { COMMENT_MAX_CHARS, formatAgo, formatCount, formatRupees } from '@fayda/domain';
import { AppText, Badge, Button, Card, Icon, TextField, describeError, useTheme } from '@fayda/ui';
import * as Linking from 'expo-linking';
import { useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Share, View } from 'react-native';
import { newKey } from './orders';

/** The message a share sheet carries: what it is, the price, and a link that opens this listing in the app. */
export function shareMessage(l: { id: string; title: string; price: number }): string {
  return `${l.title} · ${formatRupees(l.price)} on Fayda\n${Linking.createURL(`listing/${l.id}`)}`;
}

/** Opens the phone's share sheet. Returns false if it could not be opened (it never throws into the screen). */
export async function shareListing(l: { id: string; title: string; price: number }): Promise<boolean> {
  try {
    await Share.share({ message: shareMessage(l), title: l.title });
    return true;
  } catch {
    return false;
  }
}

const chipStyle = (on: boolean, colors: ReturnType<typeof useTheme>['colors']) => ({ minHeight: 36, paddingHorizontal: 12, borderRadius: 99, borderWidth: 1.5, borderColor: on ? colors.accent : colors.border, backgroundColor: on ? colors.accentTint : colors.surface, alignItems: 'center' as const, justifyContent: 'center' as const, flexDirection: 'row' as const, gap: 6 });

export interface SocialItem { id: string; title: string; price: number; liked: boolean; saved: boolean; likeCount: number; commentCount: number; ownShop?: boolean; ownListing?: boolean }

/** Like, comments count, save and share in one row. Used on reels and on the product page. */
export function ReactionRow({ item, onComments, compact }: { item: SocialItem; onComments?: () => void; compact?: boolean }) {
  const { colors } = useTheme();
  const like = useSetLike();
  const save = useSetSave();
  const own = !!(item.ownShop || item.ownListing);
  if (compact) {
    const ico = (name: 'heart' | 'chat' | 'bookmark' | 'send', label: string, n: string | null, on: boolean, onPress: (() => void) | undefined, disabled: boolean) => (
      <Pressable key={name} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on, disabled }} disabled={disabled} onPress={onPress} hitSlop={6} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        <Icon name={name} size={18} color={on ? colors.accent : colors.muted} fill={on && (name === 'heart' || name === 'bookmark') ? colors.accent : 'none'} />
        {n ? <AppText size={11} tone="muted" weight="bold">{n}</AppText> : null}
      </Pressable>
    );
    return (
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        {ico('heart', own ? `${item.likeCount} likes` : item.liked ? `Unlike ${item.title} (${item.likeCount} likes)` : `Like ${item.title} (${item.likeCount} likes)`, formatCount(item.likeCount), item.liked, () => like.mutate({ listingId: item.id, like: !item.liked }), own || like.isPending)}
        {ico('chat', `Comments on ${item.title} (${item.commentCount})`, formatCount(item.commentCount), false, onComments, !onComments)}
        {ico('bookmark', item.saved ? `Remove ${item.title} from saved` : `Save ${item.title}`, null, item.saved, () => save.mutate({ listingId: item.id, save: !item.saved }), save.isPending)}
        {ico('send', `Share ${item.title}`, null, false, () => void shareListing(item), false)}
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={own ? `${item.likeCount} likes` : item.liked ? `Unlike ${item.title} (${item.likeCount} likes)` : `Like ${item.title} (${item.likeCount} likes)`}
        accessibilityState={{ selected: item.liked, disabled: own }}
        disabled={own || like.isPending}
        onPress={() => like.mutate({ listingId: item.id, like: !item.liked })}
        style={chipStyle(item.liked, colors)}
      >
        <AppText weight="bold" size={13} tone={item.liked ? 'accent' : 'ink'}>{item.liked ? '♥' : '♡'} {formatCount(item.likeCount)}</AppText>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Comments on ${item.title} (${item.commentCount})`} onPress={onComments} disabled={!onComments} style={chipStyle(false, colors)}>
        <AppText weight="bold" size={13}>Comments {formatCount(item.commentCount)}</AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={item.saved ? `Remove ${item.title} from saved` : `Save ${item.title}`}
        accessibilityState={{ selected: item.saved }}
        disabled={save.isPending}
        onPress={() => save.mutate({ listingId: item.id, save: !item.saved })}
        style={chipStyle(item.saved, colors)}
      >
        <AppText weight="bold" size={13} tone={item.saved ? 'accent' : 'ink'}>{item.saved ? 'Saved' : 'Save'}</AppText>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Share ${item.title}`} onPress={() => void shareListing(item)} style={chipStyle(false, colors)}>
        <AppText weight="bold" size={13}>Share</AppText>
      </Pressable>
    </View>
  );
}

/** The reel's right-hand rail: like, comments, save and share as round icon buttons with a caption (same actions and labels as ReactionRow). */
export function ReelRail({ item, onComments }: { item: SocialItem; onComments?: () => void }) {
  const like = useSetLike();
  const save = useSetSave();
  const own = !!(item.ownShop || item.ownListing);
  const Btn = ({ label, caption, onPress, disabled, selected, children }: { label: string; caption: string; onPress?: () => void; disabled?: boolean; selected?: boolean; children: React.ReactNode }) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!selected, disabled: !!disabled }} disabled={disabled} onPress={onPress} style={{ alignItems: 'center', gap: 2 }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' }}>{children}</View>
      <AppText weight="bold" size={12} style={{ color: '#fff', textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } }}>{caption}</AppText>
    </Pressable>
  );
  return (
    <View style={{ gap: 16, alignItems: 'center' }}>
      <Btn
        label={own ? `${item.likeCount} likes` : item.liked ? `Unlike ${item.title} (${item.likeCount} likes)` : `Like ${item.title} (${item.likeCount} likes)`}
        caption={formatCount(item.likeCount)} selected={item.liked} disabled={own || like.isPending}
        onPress={() => like.mutate({ listingId: item.id, like: !item.liked })}
      >
        <Icon name="heart" size={24} color={item.liked ? '#F43F5E' : '#fff'} fill={item.liked ? '#F43F5E' : 'none'} />
      </Btn>
      <Btn label={`Comments on ${item.title} (${item.commentCount})`} caption={formatCount(item.commentCount)} onPress={onComments} disabled={!onComments}>
        <Icon name="chat" size={24} color="#fff" />
      </Btn>
      <Btn
        label={item.saved ? `Remove ${item.title} from saved` : `Save ${item.title}`}
        caption={item.saved ? 'Saved' : 'Save'} selected={item.saved} disabled={save.isPending}
        onPress={() => save.mutate({ listingId: item.id, save: !item.saved })}
      >
        <Icon name="bookmark" size={24} color="#fff" fill={item.saved ? '#fff' : 'none'} />
      </Btn>
      <Btn label={`Share ${item.title}`} caption="Share" onPress={() => void shareListing(item)}>
        <Icon name="send" size={24} color="#fff" />
      </Btn>
    </View>
  );
}

function CommentRow({ c, onRemove, busy }: { c: Comment; onRemove: () => void; busy: boolean }) {
  return (
    <View style={{ gap: 2 }} accessibilityLabel={`Comment by ${c.author.name}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <AppText weight="bold" size={13}>{c.author.name}</AppText>
        {c.author.shop ? <Badge label="Seller" tone="accent" /> : null}
        <AppText tone="faint" size={12}>{formatAgo(c.at, Date.now())}</AppText>
      </View>
      <AppText selectable>{c.text}</AppText>
      {c.canRemove ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove comment by ${c.author.name}`} disabled={busy} onPress={onRemove} hitSlop={8}>
          <AppText tone="danger" size={12}>Remove</AppText>
        </Pressable>
      ) : null}
      <CommentSafety c={c} />
    </View>
  );
}

/** Public comments on a listing: newest first, load more, post your own, remove yours. */
export function CommentsSection({ listingId, onFocusInput }: { listingId: string; onFocusInput?: () => void }) {
  const { colors } = useTheme();
  const q = useComments('buyer', listingId);
  const post = usePostComment('buyer');
  const remove = useRemoveComment('buyer');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const attempt = useRef({ clientKey: newKey(), idem: newKey() });
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  const total = q.data?.pages[0]?.total ?? 0;

  const change = (v: string) => {
    setText(v);
    setError(null);
    attempt.current = { clientKey: newKey(), idem: newKey() }; // new words, new attempt; a retry of the same words keeps its keys
  };
  const send = () =>
    post.mutate(
      { listingId, input: { text, clientKey: attempt.current.clientKey }, idempotencyKey: attempt.current.idem },
      {
        onSuccess: () => {
          setText('');
          attempt.current = { clientKey: newKey(), idem: newKey() };
        },
        onError: (e) => setError(describeError(e).fields.text ?? describeError(e).message),
      },
    );
  const confirmRemove = (c: Comment) =>
    Alert.alert('Remove this comment?', 'It disappears for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(c.id) },
    ]);

  return (
    <Card>
      <AppText weight="bold">Comments{total ? ` (${total})` : ''}</AppText>
      <TextField label="Ask or say something" value={text} onChangeText={change} onFocus={onFocusInput} multiline maxLength={COMMENT_MAX_CHARS * 2} error={error ?? undefined} hint={`Public. Up to ${COMMENT_MAX_CHARS} characters. Be kind: comments can be removed.`} />
      <Button title="Post comment" loading={post.isPending} disabled={!text.trim()} onPress={send} />
      {q.isPending ? <ActivityIndicator color={colors.accent} /> : null}
      {q.isError ? (
        <View style={{ gap: 8 }}>
          <AppText tone="danger" size={13}>Can’t load comments. {q.error.message}</AppText>
          <Button title="Try again" variant="outline" size="sm" onPress={() => void q.refetch()} />
        </View>
      ) : null}
      {q.isSuccess && !items.length ? <AppText tone="muted" size={13}>No comments yet. Be the first to ask.</AppText> : null}
      <View style={{ gap: 14 }}>
        {items.map((c) => (
          <CommentRow key={c.id} c={c} busy={remove.isPending} onRemove={() => confirmRemove(c)} />
        ))}
      </View>
      {q.hasNextPage ? <Button title={q.isFetchingNextPage ? 'Loading…' : 'Show more comments'} variant="outline" size="sm" disabled={q.isFetchingNextPage} onPress={() => void q.fetchNextPage()} /> : null}
    </Card>
  );
}
