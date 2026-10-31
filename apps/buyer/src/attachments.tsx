import { useApiClient } from '@fayda/api-client';
import { AppText, Button, useTheme } from '@fayda/ui';
import { useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { UploadError, pickFiles, uploadMedia } from './upload';

export interface Attached {
  /** The media id once uploaded; a locally chosen file that is still uploading has none. */
  id: string;
  kind: 'image' | 'video';
  /** A local file address or the server's media address. */
  uri: string;
}

/**
 * Photos (and, for reviews, videos) the person attaches. Each is uploaded as soon as it is chosen, so "Send" only has to
 * send ids. A failed upload says why and can be tried again.
 */
export function AttachmentPicker({
  label,
  purpose,
  max,
  video,
  value,
  onChange,
  error,
}: {
  label: string;
  purpose: 'REVIEW' | 'REQUEST' | 'CHAT';
  max: number;
  video: boolean;
  value: Attached[];
  onChange: (v: Attached[]) => void;
  error?: string | undefined;
}) {
  const { colors } = useTheme();
  const client = useApiClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const add = async () => {
    setProblem(null);
    setBusy(true);
    try {
      const picked = await pickFiles({ video, max: max - value.length });
      const added: Attached[] = [];
      for (const f of picked) {
        const m = await uploadMedia(client, f, purpose);
        added.push({ id: m.id, kind: m.kind, uri: f.uri });
      }
      if (added.length) onChange([...value, ...added]);
    } catch (e) {
      setProblem(e instanceof UploadError ? e.message : e instanceof Error ? e.message : 'The upload did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <AppText weight="semibold" size={13}>{label}</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {value.map((a) => (
          <Pressable key={a.id} accessibilityRole="button" accessibilityLabel={`Remove ${a.kind}`} onPress={() => onChange(value.filter((x) => x.id !== a.id))}>
            <View style={{ width: 72, height: 72, borderRadius: 10, backgroundColor: colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
              {a.kind === 'image' ? <Image source={{ uri: a.uri }} style={{ width: 72, height: 72 }} accessibilityIgnoresInvertColors /> : <AppText size={12}>Video</AppText>}
            </View>
            <AppText tone="faint" size={11}>Tap to remove</AppText>
          </Pressable>
        ))}
      </View>
      {value.length < max ? <Button title={busy ? 'Uploading…' : video ? 'Add photo or video' : 'Add photo'} variant="outline" size="sm" loading={busy} onPress={() => void add()} /> : null}
      {problem ? <AppText tone="danger" size={12} accessibilityRole="alert">{problem}</AppText> : null}
      {error ? <AppText tone="danger" size={12} accessibilityRole="alert">{error}</AppText> : null}
    </View>
  );
}
