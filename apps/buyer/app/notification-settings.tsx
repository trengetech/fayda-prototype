import { useNotificationSettings, useSetNotificationSetting } from '@fayda/api-client';
import { AppText, Button, Card, useTheme } from '@fayda/ui';
import { ActivityIndicator, ScrollView, Switch, View } from 'react-native';

/** Which kinds of notification this person wants: a push to the phone, and a place in the notification centre. Orders are always on. */
export default function NotificationSettingsScreen() {
  const { colors } = useTheme();
  const q = useNotificationSettings('buyer');
  const set = useSetNotificationSetting('buyer');
  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.surface }} contentContainerStyle={{ padding: 16, gap: 12 }}>
      <AppText weight="extrabold" size={20}>Notification settings</AppText>
      <AppText tone="muted" size={13}>Choose what reaches you. Switching a kind off in the centre only hides it; turn it back on and it returns. Orders can’t be switched off.</AppText>
      {q.isPending ? <ActivityIndicator color={colors.accent} /> : null}
      {q.isError ? (
        <Card>
          <AppText tone="danger">Can’t load your settings. {q.error.message}</AppText>
          <Button title="Try again" onPress={() => void q.refetch()} />
        </Card>
      ) : null}
      {set.isError ? <AppText tone="danger">Couldn’t save that. {set.error.message}</AppText> : null}
      {q.data?.items.map((s) => (
        <Card key={s.category}>
          <AppText weight="bold">{s.label}{s.alwaysOn ? ' (always on)' : ''}</AppText>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <AppText tone="muted">Push to this phone</AppText>
            <Switch accessibilityLabel={`${s.label}: push`} testID={`push-${s.category}`} disabled={s.alwaysOn || set.isPending} value={s.push} onValueChange={(v) => set.mutate({ category: s.category, push: v, inApp: s.inApp })} />
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <AppText tone="muted">Show in notifications</AppText>
            <Switch accessibilityLabel={`${s.label}: show in notifications`} testID={`inapp-${s.category}`} disabled={s.alwaysOn || set.isPending} value={s.inApp} onValueChange={(v) => set.mutate({ category: s.category, push: s.push, inApp: v })} />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
