import { and, eq, or } from 'drizzle-orm';
import type { Q } from '../community/shared.js';
import { userBlocks } from '../db/schema.js';

/** The people this person has blocked. */
export async function blockedBy(q: Q, userId: string): Promise<Set<string>> {
  const rows = await q.select({ id: userBlocks.blockedUserId }).from(userBlocks).where(eq(userBlocks.blockerUserId, userId));
  return new Set(rows.map((r) => r.id));
}

/** Who blocked whom between two people: either, both or neither. */
export async function blockState(q: Q, me: string, other: string): Promise<{ iBlocked: boolean; theyBlocked: boolean }> {
  const rows = await q
    .select({ blocker: userBlocks.blockerUserId })
    .from(userBlocks)
    .where(or(and(eq(userBlocks.blockerUserId, me), eq(userBlocks.blockedUserId, other)), and(eq(userBlocks.blockerUserId, other), eq(userBlocks.blockedUserId, me))));
  return { iBlocked: rows.some((r) => r.blocker === me), theyBlocked: rows.some((r) => r.blocker === other) };
}
