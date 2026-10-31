import type { ApiClient } from '@fayda/api-client';
import type { Media } from '@fayda/contracts/schemas';
import { validateMediaIntent } from '@fayda/domain';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

export interface PickedFile {
  uri: string;
  kind: 'image' | 'video';
  mime: string;
  size: number;
  durationSec?: number | null;
}
export class UploadError extends Error {}

type Purpose = 'REVIEW' | 'REQUEST' | 'CHAT';

/** Uploads one file in the API's three steps (address, bytes straight from disk, done). Limits are checked first. */
export async function uploadMedia(client: ApiClient, file: PickedFile, purpose: Purpose): Promise<Media> {
  const problems = validateMediaIntent({ kind: file.kind, purpose, mime: file.mime, size: file.size, durationSec: file.durationSec ?? null });
  const first = Object.values(problems)[0];
  if (first) throw new UploadError(first);
  const intent = await client.createMediaIntent({ kind: file.kind, purpose, mime: file.mime, size: file.size, ...(file.durationSec != null ? { durationSec: file.durationSec } : {}) }, 'buyer');
  const sent = await FileSystem.uploadAsync(client.resolveUrl(intent.upload.url), file.uri, {
    httpMethod: intent.upload.method,
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: intent.upload.headers,
  });
  if (sent.status < 200 || sent.status >= 300) throw new UploadError(sent.status === 410 ? 'The upload took too long. Try again.' : 'The upload did not go through. Check your connection and try again.');
  return client.completeMedia(intent.mediaId, 'buyer');
}

const MIMES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };

/** Opens the gallery. Photos only unless `video` is true. Returns the chosen files, or an empty list if the person backed out. */
export async function pickFiles(opts: { video: boolean; max: number }): Promise<PickedFile[]> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: opts.video ? ['images', 'videos'] : ['images'],
    allowsMultipleSelection: opts.max > 1,
    selectionLimit: opts.max,
    quality: 0.8,
  });
  if (res.canceled) return [];
  const out: PickedFile[] = [];
  for (const a of res.assets.slice(0, opts.max)) {
    const kind = a.type === 'video' ? 'video' : 'image';
    const ext = (a.fileName ?? a.uri).split('.').pop()?.toLowerCase() ?? '';
    const mime = a.mimeType ?? MIMES[ext] ?? (kind === 'video' ? 'video/mp4' : 'image/jpeg');
    let size = a.fileSize ?? 0;
    if (!size) {
      const info = await FileSystem.getInfoAsync(a.uri);
      size = info.exists && typeof info.size === 'number' ? info.size : 0;
    }
    out.push({ uri: a.uri, kind, mime, size, durationSec: a.duration != null ? a.duration / 1000 : null });
  }
  return out;
}
