import { useBlockActions, useBlocks } from '@fayda/api-client';
import { AppText, Button, Card, PersonRow, useTheme } from '@fayda/ui';
import { ActivityIndicator, ScrollView, View } from 'react-native';

/** The people this person blocked, with a way to unblock. */
export default function BlockedScreen() {
  const { colors } = useTheme();
  const q = useBlocks('buyer');
  const { unblock } = useBlockActions('buyer');
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <AppText tone="muted" size={13}>You don’t see their comments, and neither of you can message the other. Orders and past chats stay as they are.</AppText>
      {q.isPending ? <ActivityIndicator color={colors.accent} /> : null}
      {q.isError ? (
        <Card>
          <AppText tone="danger">Can’t load this list. {q.error.message}</AppText>
          <Button title="Try again" onPress={() => void q.refetch()} />
        </Card>
      ) : null}
      {q.isSuccess && !q.data.items.length ? <AppText tone="muted">You haven’t blocked anyone.</AppText> : null}
      {q.data?.items.length ? (
        <View style={{ marginHorizontal: -16 }}>
          {q.data.items.map((b) => (
            <PersonRow key={b.id} name={b.name} subtitle={`Blocked ${new Date(b.since).toLocaleDateString()}`}
              right={<Button title="Unblock" variant="outline" size="sm" block={false} loading={unblock.isPending && unblock.variables === b.id} onPress={() => unblock.mutate(b.id)} />} />
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
