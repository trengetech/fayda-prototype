import { useBlockActions, useBlocks } from '@fayda/api-client';
import { AppText, Button, Card, useTheme } from '@fayda/ui';
import { ActivityIndicator, ScrollView, View } from 'react-native';

/** The people this person blocked, with a way to unblock. */
export default function BlockedScreen() {
  const { colors } = useTheme();
  const q = useBlocks('seller');
  const { unblock } = useBlockActions('seller');
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <AppText weight="extrabold" size={20}>Blocked people</AppText>
      <AppText tone="muted" size={13}>You don’t see their comments, and neither of you can message the other. Orders and past chats stay as they are.</AppText>
      {q.isPending ? <ActivityIndicator color={colors.accent} /> : null}
      {q.isError ? (
        <Card>
          <AppText tone="danger">Can’t load this list. {q.error.message}</AppText>
          <Button title="Try again" onPress={() => void q.refetch()} />
        </Card>
      ) : null}
      {q.isSuccess && !q.data.items.length ? <AppText tone="muted">You haven’t blocked anyone.</AppText> : null}
      {q.data?.items.map((b) => (
        <Card key={b.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <AppText weight="bold">{b.name}</AppText>
              <AppText tone="muted" size={12}>Blocked {new Date(b.since).toLocaleDateString()}</AppText>
            </View>
            <Button title="Unblock" variant="outline" size="sm" loading={unblock.isPending && unblock.variables === b.id} onPress={() => unblock.mutate(b.id)} />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
