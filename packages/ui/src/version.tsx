import { View } from 'react-native';
import { AppText } from './components';
import { useTheme } from './theme';

/** Shown instead of the app when the server no longer accepts this version of it. */
export function UpdateRequired({ appName }: { appName: string }) {
  const { colors } = useTheme();
  return (
    <View testID="update-required" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24, backgroundColor: colors.surface }}>
      <AppText weight="extrabold" size={20}>Please update {appName}</AppText>
      <AppText tone="muted" style={{ textAlign: 'center' }}>This version is too old to work with the server. Install the latest version of the app, then open it again.</AppText>
    </View>
  );
}

/** A quiet line for the case where the app is newer than the server: some screens may not work until the server is updated. */
export function VersionNote() {
  const { colors } = useTheme();
  return (
    <View testID="version-note" style={{ paddingHorizontal: 16, paddingVertical: 6, backgroundColor: colors.surface }}>
      <AppText tone="muted" size={12}>This app is newer than the server it is talking to. Some screens may not work until the server is updated.</AppText>
    </View>
  );
}
