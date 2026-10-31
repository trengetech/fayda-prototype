import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Media, MediaIntent, MediaIntentInput } from '@fayda/contracts';
import { validateMediaIntent, type Clock } from '@fayda/domain';
import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { DbService } from '../db/db.service.js';
import { media, sellers } from '../db/schema.js';
import { SweepRunner, type SweepTask } from '../scheduler/sweep-runner.js';
import { DiskMediaStorage, MEDIA_STORAGE, UploadSizeError, contentMatchesMime } from './media-storage.js';

export const UPLOAD_TTL_MS = 15 * 60_000;
/** Unfinished uploads one user may hold at once, so a client bug or abuse cannot fill the disk. */
export const MAX_PENDING_PER_USER = 50;
const PURGE_EVERY_MS = 10 * 60_000;
const PENDING_GRACE_MS = 60 * 60_000;
const ORPHAN_AFTER_MS = 24 * 3_600_000;

type MediaRow = typeof media.$inferSelect;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
const sameHash = (a: string, b: string): boolean => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The public address of a ready listing file. A UPI QR is private, so it has none. */
export const publicMediaUrl = (id: string): string => `/v1/media/${id}`;

@Injectable()
export class MediaService implements SweepTask {
  readonly name = 'media-purge';
  private readonly log = new Logger('Media');
  private lastPurge = 0;

  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(MEDIA_STORAGE) private readonly storage: DiskMediaStorage,
    @Inject(SweepRunner) sweep: SweepRunner,
  ) {
    sweep.register(this);
  }

  private get db() {
    return this.database.db;
  }

  toMedia(row: MediaRow): Media {
    return {
      id: row.id,
      kind: row.kind,
      purpose: row.purpose,
      status: row.status,
      size: row.size,
      url: row.status === 'READY' && row.purpose === 'LISTING' ? publicMediaUrl(row.id) : null,
    };
  }

  /** Step 1 of an upload: check the limits, record the file as PENDING and say where to send it. */
  async createIntent(userId: string, input: MediaIntentInput): Promise<MediaIntent> {
    const [seller] = await this.db.select({ id: sellers.id }).from(sellers).where(eq(sellers.userId, userId)).limit(1);
    if (!seller) throw new AppError(403, 'NO_SELLER', 'Set up your shop first.');
    const errors = validateMediaIntent(input);
    if (Object.keys(errors).length) throw new AppError(400, 'VALIDATION', 'Check the file.', errors);
    const [pending] = await this.db.select({ n: count() }).from(media).where(and(eq(media.ownerUserId, userId), eq(media.status, 'PENDING')));
    if ((pending?.n ?? 0) >= MAX_PENDING_PER_USER) throw new AppError(429, 'RATE_LIMITED', 'Too many unfinished uploads. Finish or wait a few minutes.');

    const now = this.clock.now();
    const id = randomUUID();
    const token = randomBytes(24).toString('base64url');
    const expiresAt = now + UPLOAD_TTL_MS;
    await this.db.insert(media).values({
      id,
      ownerUserId: userId,
      kind: input.kind as 'image' | 'video',
      purpose: input.purpose as 'LISTING' | 'UPI_QR',
      mime: input.mime,
      declaredSize: input.size,
      durationSec: input.durationSec == null ? null : Math.round(input.durationSec),
      adapter: this.storage.name,
      storageKey: this.storage.newKey(id, now),
      uploadTokenHash: hashToken(token),
      uploadExpiresAt: new Date(expiresAt),
    });
    const where = this.storage.intent({ id, mime: input.mime }, token);
    return { mediaId: id, upload: { method: 'PUT', url: where.url, headers: where.headers }, expiresAt };
  }

  /** The disk adapter's upload route: checks the one-time token and the declared type and size, then streams to disk. */
  async receiveUpload(id: string, token: string, contentType: string | undefined, contentLength: number | undefined, body: Readable): Promise<void> {
    const [row] = await this.db.select().from(media).where(eq(media.id, id)).limit(1);
    if (!row || row.adapter !== this.storage.name) throw new AppError(404, 'NOT_FOUND', 'Unknown upload.');
    if (!row.uploadTokenHash || !token || !sameHash(row.uploadTokenHash, hashToken(token))) throw new AppError(401, 'UNAUTHENTICATED', 'This upload address is not valid.');
    if (!row.uploadExpiresAt || row.uploadExpiresAt.getTime() < this.clock.now()) throw new AppError(410, 'UPLOAD_EXPIRED', 'This upload address has expired. Start the upload again.');
    if ((contentType ?? '').split(';')[0]!.trim().toLowerCase() !== row.mime) throw new AppError(400, 'VALIDATION', `Send the file with Content-Type ${row.mime}.`);
    if (contentLength !== undefined && contentLength !== row.declaredSize) throw new AppError(400, 'UPLOAD_MISMATCH', 'The file size does not match what was declared.');
    try {
      await this.storage.write(row.storageKey, body, row.declaredSize);
    } catch (e) {
      if (e instanceof UploadSizeError) throw new AppError(400, 'UPLOAD_MISMATCH', e.message);
      throw e;
    }
    // One use only: a second PUT with the same address is refused.
    await this.db.update(media).set({ uploadTokenHash: null }).where(eq(media.id, id));
  }

  /** Step 3: the phone says it has uploaded. Check what is on storage, then mark the file READY. */
  async complete(userId: string, id: string): Promise<Media> {
    const [row] = await this.db.select().from(media).where(and(eq(media.id, id), eq(media.ownerUserId, userId))).limit(1);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Upload not found.');
    if (row.status === 'READY') return this.toMedia(row);
    const found = await this.storage.inspect(row.storageKey);
    if (!found) throw new AppError(409, 'MEDIA_NOT_READY', 'The file has not arrived yet.');
    if (found.size !== row.declaredSize) {
      await this.discard(row);
      throw new AppError(422, 'UPLOAD_MISMATCH', 'The file size does not match what was declared. Upload it again.');
    }
    if (!contentMatchesMime(row.mime, found.head)) {
      await this.discard(row);
      throw new AppError(400, 'VALIDATION', 'Check the file.', { file: row.kind === 'image' ? 'This is not a valid photo.' : 'This is not a valid video.' });
    }
    const [done] = await this.db.update(media).set({ status: 'READY', size: found.size, readyAt: new Date(this.clock.now()), uploadTokenHash: null }).where(eq(media.id, id)).returning();
    return this.toMedia(done!);
  }

  /** A ready file the seller owns, for attaching to a listing or a payment profile. */
  async requireOwnedReady(userId: string, id: string, purpose: 'LISTING' | 'UPI_QR', kind?: 'image' | 'video'): Promise<MediaRow> {
    const [row] = await this.db.select().from(media).where(and(eq(media.id, id), eq(media.ownerUserId, userId))).limit(1);
    if (!row || row.purpose !== purpose || (kind && row.kind !== kind)) throw new AppError(400, 'VALIDATION', 'Check the file.', { media: 'One of the files is not valid. Upload it again.' });
    if (row.status !== 'READY') throw new AppError(409, 'MEDIA_NOT_READY', 'One of the files has not finished uploading.');
    return row;
  }

  /** What the public download route needs, or null when the file is not public. */
  async publicFile(id: string): Promise<{ mime: string; size: number; storageKey: string } | null> {
    const [row] = await this.db.select().from(media).where(and(eq(media.id, id), eq(media.status, 'READY'), eq(media.purpose, 'LISTING'))).limit(1);
    return row?.size ? { mime: row.mime, size: row.size, storageKey: row.storageKey } : null;
  }

  openFile(storageKey: string, range?: { start: number; end: number }): Readable {
    return this.storage.read(storageKey, range);
  }

  private async discard(row: MediaRow): Promise<void> {
    await this.storage.remove(row.storageKey);
    await this.db.delete(media).where(eq(media.id, row.id));
  }

  /**
   * Housekeeping, at most every 10 minutes: removes uploads that never finished, and finished files nobody attached to a
   * listing or a payment profile within a day (an editor that was abandoned).
   */
  async run(now: number): Promise<number> {
    if (now - this.lastPurge < PURGE_EVERY_MS) return 0;
    this.lastPurge = now;
    const stale = await this.db.execute<{ id: string }>(sql`
      select m.id from media m
      where (m.status = 'PENDING' and m.created_at < ${new Date(now - PENDING_GRACE_MS).toISOString()}::timestamptz)
         or (m.status = 'READY' and m.ready_at < ${new Date(now - ORPHAN_AFTER_MS).toISOString()}::timestamptz
             and not exists (select 1 from listing_media lm where lm.media_id = m.id or lm.poster_media_id = m.id)
             and not exists (select 1 from seller_payment_profiles sp where sp.upi_qr_media_id = m.id))
      limit 100`);
    const ids = stale.map((r) => r.id);
    if (!ids.length) return 0;
    const rows = await this.db.select().from(media).where(inArray(media.id, ids));
    let removed = 0;
    for (const row of rows) {
      try {
        await this.discard(row);
        removed++;
      } catch (e) {
        // For example a file attached a moment ago (the foreign key refuses the delete). It is picked up again next time.
        this.log.warn(`Could not remove media ${row.id}: ${e instanceof Error ? e.message : 'unknown error'}`);
      }
    }
    return removed;
  }
}
