import { useApiClient } from '@fayda/api-client';
import { AppText, Button, Card, FieldError } from '@fayda/ui';
import { upiPayeeFromQr, validateUpiQr } from '@fayda/domain';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { UploadError, sizeOf, uploadMedia } from './upload';

export interface UpiQrValue {
  mediaId: string;
  /** The text decoded from the QR image. The server needs it again to check the QR against the UPI ID. */
  payload: string;
}

/**
 * Upload the seller's UPI QR. The phone decodes the picked image, and the payee in it must match the UPI ID typed above
 * (same rule as the server) before anything is uploaded. Decoding needs no camera permission.
 */
export function UpiQrField({ upiId, value, onChange, error }: { upiId: string; value: UpiQrValue | null; onChange: (v: UpiQrValue | null) => void; error?: string | undefined }) {
  const client = useApiClient();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const pick = async () => {
    setProblem(null);
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setBusy(true);
    try {
      const found = await Camera.scanFromURLAsync(asset.uri, ['qr']);
      const payload = found[0]?.data;
      if (!payload) throw new UploadError('No QR code found in that image. Pick the QR image saved from your UPI app.');
      const mismatch = validateUpiQr(upiId, payload);
      if (mismatch) throw new UploadError(mismatch);
      const size = asset.fileSize ?? (await sizeOf(asset.uri));
      const media = await uploadMedia(client, { uri: asset.uri, kind: 'image', mime: asset.mimeType ?? 'image/jpeg', size }, 'UPI_QR');
      onChange({ mediaId: media.id, payload });
    } catch (e) {
      setProblem(e instanceof Error ? e.message : 'Could not use that image. Try again.');
    } finally {
      setBusy(false);
    }
  };

  // The UPI ID can be edited after the QR was added, so the match is re-checked as it changes.
  const stale = value ? validateUpiQr(upiId, value.payload) : null;
  return (
    <Card>
      <AppText weight="bold">UPI QR code <AppText tone="faint" weight="regular"> (optional)</AppText></AppText>
      <AppText tone="muted" size={13}>Buyers can scan it to pay you. We check it belongs to the UPI ID you entered.</AppText>
      {value ? (
        <View style={{ gap: 8 }}>
          <AppText tone={stale ? 'danger' : 'success'} weight="semibold">{stale ?? `QR added · pays to ${upiPayeeFromQr(value.payload)}`}</AppText>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="Replace" variant="outline" size="sm" onPress={() => void pick()} disabled={busy} />
            <Button title="Remove" variant="ghost" size="sm" onPress={() => onChange(null)} disabled={busy} />
          </View>
        </View>
      ) : (
        <Button title="Upload QR image" variant="outline" size="sm" onPress={() => void pick()} loading={busy} />
      )}
      {busy ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator /><AppText tone="muted" size={13}>Checking and uploading…</AppText></View> : null}
      <FieldError>{problem ?? error}</FieldError>
    </Card>
  );
}
