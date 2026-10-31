import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lt } from 'drizzle-orm';
import { AppError } from './app-error.js';
import { DbService } from '../db/db.service.js';
import { idempotencyKeys } from '../db/schema.js';

export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;

export type IdempotencyState =
  | { state: 'NEW' }
  | { state: 'REPLAY'; status: number; body: unknown }
  | { state: 'IN_PROGRESS' }
  | { state: 'MISMATCH' };

export const hashRequest = (method: string, path: string, body: unknown): string =>
  createHash('sha256').update(JSON.stringify([method, path, body ?? null])).digest('hex');

/**
 * Makes retries of mutating requests safe. `begin` claims the key atomically (insert, or read the existing row),
 * `complete` stores the response so a retry gets the same answer instead of a second effect.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(DbService) private readonly database: DbService) {}

  async begin(scope: string, key: string, requestHash: string, now: number): Promise<IdempotencyState> {
    const { db } = this.database;
    const inserted = await db
      .insert(idempotencyKeys)
      .values({ scope, key, requestHash, status: 'IN_PROGRESS', expiresAt: new Date(now + IDEMPOTENCY_TTL_MS) })
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });
    if (inserted.length) return { state: 'NEW' };
    const [row] = await db.select().from(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
    if (!row) return this.begin(scope, key, requestHash, now); // deleted between the two statements: claim it again
    if (row.requestHash !== requestHash) return { state: 'MISMATCH' };
    if (row.status === 'COMPLETED') return { state: 'REPLAY', status: row.responseStatus as number, body: row.responseBody };
    return { state: 'IN_PROGRESS' };
  }

  async complete(scope: string, key: string, status: number, body: unknown): Promise<void> {
    await this.database.db
      .update(idempotencyKeys)
      .set({ status: 'COMPLETED', responseStatus: status, responseBody: body ?? null })
      .where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key)));
  }

  /** Frees a claimed key after a failed attempt so the client can retry. */
  async abandon(scope: string, key: string): Promise<void> {
    await this.database.db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.scope, scope), eq(idempotencyKeys.key, key), eq(idempotencyKeys.status, 'IN_PROGRESS')));
  }

  async purgeExpired(now: number): Promise<number> {
    const gone = await this.database.db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, new Date(now))).returning({ key: idempotencyKeys.key });
    return gone.length;
  }

  /**
   * Runs `fn` at most once per (caller, route, key). A retry with the same key and body gets the stored answer; the same key with a
   * different body is refused. Without a key the request simply runs. A failed attempt frees the key so the client can retry.
   */
  async run<T>(who: { userId: string; method: string; path: string }, key: string | undefined, body: unknown, now: number, fn: () => Promise<{ status: number; body: T }>): Promise<{ status: number; body: T }> {
    if (!key) return fn();
    if (key.length < 8 || key.length > 100) throw new AppError(400, 'VALIDATION', 'Idempotency-Key must be 8 to 100 characters.');
    const scope = `${who.userId} ${who.method} ${who.path}`;
    const claim = await this.begin(scope, key, hashRequest(who.method, who.path, body), now);
    if (claim.state === 'REPLAY') return { status: claim.status, body: claim.body as T };
    if (claim.state === 'MISMATCH') throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.');
    if (claim.state === 'IN_PROGRESS') throw new AppError(409, 'INVALID_STATE', 'This request is still being processed. Try again in a moment.');
    try {
      const result = await fn();
      await this.complete(scope, key, result.status, result.body);
      return result;
    } catch (e) {
      await this.abandon(scope, key);
      throw e;
    }
  }
}
