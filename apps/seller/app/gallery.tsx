import { Gallery } from '@fayda/ui';
import { Stack } from 'expo-router';
import { SHOW_GALLERY } from '../src/config';

export default function GalleryScreen() {
  if (!SHOW_GALLERY) return null;
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Gallery (dev only)' }} />
      <Gallery />
    </>
  );
}
