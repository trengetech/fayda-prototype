// TEMPORARY M3.2 Gate 0 spike (I-12): does Camera.scanFromURLAsync decode a QR from a picked image? Delete after the gate.
import { AppText, Button } from '@fayda/ui';
import { Camera } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ScrollView } from 'react-native';

export default function QrSpike() {
  const [out, setOut] = useState('Pick an image containing a QR code.');
  const run = async () => {
    try {
      const pick = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (pick.canceled) return setOut('Cancelled');
      const a = pick.assets[0]!;
      setOut(`Picked ${a.uri}\n${a.width}x${a.height}, ${a.fileSize ?? '?'} bytes\nScanning...`);
      const t0 = Date.now();
      const res = await Camera.scanFromURLAsync(a.uri, ['qr']);
      setOut(`Picked ${a.uri}\n${a.width}x${a.height}\n${Date.now() - t0} ms\nResults: ${JSON.stringify(res.map((r) => r.data))}`);
    } catch (e) {
      setOut(`ERROR: ${String(e)}`);
    }
  };
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Button title="Pick image and scan" onPress={run} />
      <AppText>{out}</AppText>
    </ScrollView>
  );
}
