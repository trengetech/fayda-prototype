import { Linking } from 'react-native';

/**
 * Opens a link in another app (WhatsApp, the phone dialler, Maps). If nothing can open it, returns a message that
 * shows what the person can do by hand instead (for example the number to copy).
 */
export async function openLink(url: string, fallback: string): Promise<string | null> {
  try {
    await Linking.openURL(url);
    return null;
  } catch {
    return fallback;
  }
}
