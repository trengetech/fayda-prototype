import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

/**
 * Where uploaded files live. The disk adapter (I-9) is the only one today; R2 and Stream (I-10) will implement the
 * same two methods, so the apps and the media service do not change. `intent` says where the phone should send the
 * file; `inspect` looks at what actually arrived.
 */
export interface MediaStorage {
  readonly name: string;
  intent(media: { id: string; mime: string }, token: string): { url: string; headers: Record<string, string> };
  inspect(storageKey: string): Promise<{ size: number; head: Buffer } | null>;
  remove(storageKey: string): Promise<void>;
}
export const MEDIA_STORAGE = Symbol('MEDIA_STORAGE');

/** Raised while streaming an upload when the body is larger or smaller than the size the phone declared. */
export class UploadSizeError extends Error {}

const keyPattern = /^\d{4}\/\d{2}\/[0-9a-f-]{36}$/;

export class DiskMediaStorage implements MediaStorage {
  readonly name = 'local-disk';
  private readonly root: string;

  constructor(uploadsDir: string) {
    this.root = resolve(uploadsDir);
  }

  /** A new key for a file, grouped by month so no folder grows without bound. */
  newKey(id: string, now: number): string {
    const d = new Date(now);
    return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${id}`;
  }

  private path(storageKey: string): string {
    if (!keyPattern.test(storageKey)) throw new Error('invalid storage key');
    return join(this.root, storageKey);
  }

  intent(media: { id: string; mime: string }, token: string) {
    return { url: `/v1/media/upload/${media.id}?token=${token}`, headers: { 'Content-Type': media.mime } };
  }

  /**
   * Streams a request body to disk without holding it in memory (the API host has under 1 GB). The file only appears
   * under its real name when exactly `expectedSize` bytes arrived.
   */
  async write(storageKey: string, body: Readable, expectedSize: number): Promise<void> {
    const target = this.path(storageKey);
    const part = `${target}.part`;
    await mkdir(dirname(target), { recursive: true });
    let seen = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        seen += chunk.length;
        if (seen > expectedSize) cb(new UploadSizeError('The file is larger than declared.'));
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(body, counter, createWriteStream(part, { flags: 'w' }));
      if (seen !== expectedSize) throw new UploadSizeError('The file is smaller than declared.');
      await rename(part, target);
    } catch (e) {
      await rm(part, { force: true });
      throw e;
    }
  }

  async inspect(storageKey: string): Promise<{ size: number; head: Buffer } | null> {
    const file = this.path(storageKey);
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return null;
    const handle = await open(file, 'r');
    try {
      const head = Buffer.alloc(Math.min(32, info.size));
      await handle.read(head, 0, head.length, 0);
      return { size: info.size, head };
    } finally {
      await handle.close();
    }
  }

  read(storageKey: string, range?: { start: number; end: number }): Readable {
    return createReadStream(this.path(storageKey), range);
  }

  async remove(storageKey: string): Promise<void> {
    const file = this.path(storageKey);
    await rm(file, { force: true });
    await rm(`${file}.part`, { force: true });
  }
}

/** Does the start of the file look like the type the phone declared? Stops a text or script file being served as a photo. */
export function contentMatchesMime(mime: string, head: Buffer): boolean {
  const at = (offset: number, bytes: number[]) => bytes.every((b, i) => head[offset + i] === b);
  const ascii = (offset: number, s: string) => head.subarray(offset, offset + s.length).toString('latin1') === s;
  switch (mime) {
    case 'image/jpeg':
      return at(0, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/webp':
      return ascii(0, 'RIFF') && ascii(8, 'WEBP');
    case 'video/mp4':
    case 'video/quicktime':
      return ascii(4, 'ftyp');
    case 'video/webm':
      return at(0, [0x1a, 0x45, 0xdf, 0xa3]);
    default:
      return false;
  }
}
