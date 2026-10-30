import { AppText, Button, Gallery, useTheme } from '@fayda/ui';
import { Stack, useRouter } from 'expo-router';
import { View } from 'react-native';
import { SHOW_GALLERY } from '../src/config';

export default function GalleryScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  if (!SHOW_GALLERY) return null;
  return (
    <>
      {/* The shell already pads the top, so a native header would add the status-bar height a second time. */}
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, minHeight: 58, borderBottomColor: colors.divider, borderBottomWidth: 1, backgroundColor: colors.surface }}>
        <Button title="‹ Back" variant="ghost" size="sm" onPress={() => router.back()} />
        <AppText weight="extrabold" size={17}>Gallery (dev only)</AppText>
      </View>
      <Gallery />
    </>
  );
}
