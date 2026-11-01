import { and, count, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { DbService } from '../db/db.service.js';
import { comments, likes, listingViews, saves, userBlocks } from '../db/schema.js';

type Q = DbService['db'];

/** What a card or a product page shows about one listing's social side, for one viewer. */
export interface SocialCounts {
  likeCount: number;
  commentCount: number;
  saveCount: number;
  /** Product-page opens since `viewsSince` (the last 30 days where it is shown). */
  viewCount: number;
  liked: boolean;
  saved: boolean;
}
const NONE: SocialCounts = { likeCount: 0, commentCount: 0, saveCount: 0, viewCount: 0, liked: false, saved: false };

/** Counts (and this viewer's own like and save) for a page of listings: four small grouped queries, none per listing. */
export async function socialCounts(q: Q, viewerUserId: string | null, listingIds: string[], commentCountMode: 'all' | 'viewer' = 'all', viewsSince?: Date): Promise<Map<string, SocialCounts>> {
  const out = new Map<string, SocialCounts>(listingIds.map((id) => [id, { ...NONE }]));
  if (!listingIds.length) return out;
  // `viewer` mode leaves out comments by people this viewer has blocked (needs a signed-in viewer).
  const hideBlocked = commentCountMode === 'viewer' && viewerUserId
    ? sql`not exists (select 1 from ${userBlocks} where ${userBlocks.blockerUserId} = ${viewerUserId} and ${userBlocks.blockedUserId} = ${comments.authorUserId})`
    : undefined;
  const [likeRows, saveRows, commentRows, mine, viewRows] = await Promise.all([
    q.select({ id: likes.targetId, n: count() }).from(likes).where(and(eq(likes.targetType, 'LISTING'), inArray(likes.targetId, listingIds))).groupBy(likes.targetId),
    q.select({ id: saves.targetId, n: count() }).from(saves).where(and(eq(saves.targetType, 'LISTING'), inArray(saves.targetId, listingIds))).groupBy(saves.targetId),
    q.select({ id: comments.listingId, n: count() }).from(comments).where(and(inArray(comments.listingId, listingIds), isNull(comments.removedAt), hideBlocked)).groupBy(comments.listingId),
    viewerUserId
      ? Promise.all([
          q.select({ id: likes.targetId }).from(likes).where(and(eq(likes.userId, viewerUserId), eq(likes.targetType, 'LISTING'), inArray(likes.targetId, listingIds))),
          q.select({ id: saves.targetId }).from(saves).where(and(eq(saves.userId, viewerUserId), eq(saves.targetType, 'LISTING'), inArray(saves.targetId, listingIds))),
        ])
      : Promise.resolve([[], []] as [{ id: string }[], { id: string }[]]),
    viewsSince
      ? q.select({ id: listingViews.listingId, n: count() }).from(listingViews).where(and(inArray(listingViews.listingId, listingIds), gte(listingViews.createdAt, viewsSince))).groupBy(listingViews.listingId)
      : Promise.resolve([] as { id: string; n: number }[]),
  ]);
  for (const r of likeRows) out.get(r.id)!.likeCount = r.n;
  for (const r of saveRows) out.get(r.id)!.saveCount = r.n;
  for (const r of commentRows) out.get(r.id)!.commentCount = r.n;
  for (const r of viewRows) out.get(r.id)!.viewCount = r.n;
  for (const r of mine[0]) out.get(r.id)!.liked = true;
  for (const r of mine[1]) out.get(r.id)!.saved = true;
  return out;
}
