import { useBlockActions, useReport } from '@fayda/api-client';
import type { Comment } from '@fayda/contracts/schemas';
import { SafetyActions } from '@fayda/ui';
import { Pressable, View } from 'react-native';
import { AppText } from '@fayda/ui';

/** Report and block on someone else's comment (I-31). Not shown on your own. */
export function CommentSafety({ c }: { c: Comment }) {
  const report = useReport('seller');
  const { block } = useBlockActions('seller');
  if (c.mine) return null;
  return (
    <SafetyActions
      what="this comment"
      who={c.author.name}
      onReport={async (reason, note) => void (await report.mutateAsync({ kind: 'COMMENT', commentId: c.id, input: { reason, note: note.trim() || null } }))}
      onBlock={async () => void (await block.mutateAsync({ source: 'COMMENT', id: c.id }))}
    />
  );
}

/** Report on a message or photo from the other person in a chat. */
export function MessageSafety({ threadId, messageId, who }: { threadId: string; messageId: string; who: string }) {
  const report = useReport('seller');
  const { block } = useBlockActions('seller');
  return (
    <SafetyActions
      what="this message"
      who={who}
      onReport={async (reason, note) => void (await report.mutateAsync({ kind: 'MESSAGE', threadId, messageId, input: { reason, note: note.trim() || null } }))}
      onBlock={async () => void (await block.mutateAsync({ source: 'THREAD', id: threadId }))}
    />
  );
}

/** Shown in a chat when messaging is off because of a block. If I blocked, I can undo it from here (in Blocked people). */
export function BlockedNotice({ youBlocked, onOpenBlocked }: { youBlocked: boolean; onOpenBlocked: () => void }) {
  return (
    <View style={{ gap: 6 }} accessibilityRole="alert">
      <AppText weight="bold">You can’t send messages in this chat.</AppText>
      <AppText tone="muted" size={13}>{youBlocked ? 'You blocked this person. Your orders and this history stay as they are.' : 'This chat is closed to new messages. Your orders and this history stay as they are.'}</AppText>
      {youBlocked ? (
        <Pressable accessibilityRole="button" onPress={onOpenBlocked} hitSlop={8}>
          <AppText tone="accent" weight="bold">Blocked people</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
