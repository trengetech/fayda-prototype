import type { ApiClient } from '@fayda/api-client';
import type { Media } from '@fayda/contracts/schemas';
import { validateMediaIntent } from '@fayda/domain';
import * as FileSystem from 'expo-file-system/legacy';

export interface PickedFile {
  uri: string;
  kind: 'image' | 'video';
  mime: string;
  size: number;
  /** Video length in seconds, when the picker reports it. */
  durationSec?: number | null;
}

/** A user-readable problem found before or during an upload. */
export class UploadError extends Error {}

/** Reads the size of a local file when the picker did not report it. */
export async function sizeOf(uri: string): Promise<number> {
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists && typeof info.size === 'number' ? info.size : 0;
}

/**
 * Uploads one file in the three steps the API defines: ask for an address (the server checks type and size), send the
 * bytes straight from disk (never loaded into memory), then say it is done. Nothing is attached to a listing yet.
 */
export async function uploadMedia(client: ApiClient, file: PickedFile, purpose: 'LISTING' | 'UPI_QR'): Promise<Media> {
  // The same limits as the server, checked first so a too-big video fails at once instead of after minutes of uploading.
  const problems = validateMediaIntent({ kind: file.kind, purpose, mime: file.mime, size: file.size, durationSec: file.durationSec ?? null });
  const first = Object.values(problems)[0];
  if (first) throw new UploadError(first);

  const intent = await client.createMediaIntent({ kind: file.kind, purpose, mime: file.mime, size: file.size, ...(file.durationSec != null ? { durationSec: file.durationSec } : {}) });
  const sent = await FileSystem.uploadAsync(client.resolveUrl(intent.upload.url), file.uri, {
    httpMethod: intent.upload.method,
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: intent.upload.headers,
  });
  if (sent.status < 200 || sent.status >= 300) throw new UploadError(sent.status === 410 ? 'The upload took too long. Try again.' : 'The upload did not go through. Check your connection and try again.');
  return client.completeMedia(intent.mediaId);
}
