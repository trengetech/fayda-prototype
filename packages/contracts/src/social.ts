import { EpochMsSchema } from './common.js';
import { z } from './zod.js';

/** The result of liking or unliking. Always the real count after the change. */
export const LikeStateSchema = z.object({ liked: z.boolean(), likeCount: z.number().int() }).openapi('LikeState');
export type LikeState = z.infer<typeof LikeStateSchema>;

/** Saves are private: the person sees their own state, never anyone's count. */
export const SaveStateSchema = z.object({ saved: z.boolean() }).openapi('SaveState');
export type SaveState = z.infer<typeof SaveStateSchema>;

/**
 * One comment. No user ids: a person is shown by first name, and the listing owner's own comments are marked as the
 * shop's (`shop: true`, name = the shop). `mine` and `canRemove` are for the person asking.
 */
export const CommentSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    at: EpochMsSchema,
    author: z.object({ name: z.string(), shop: z.boolean() }),
    mine: z.boolean(),
    /** The author may remove it, and so may the listing's owner. */
    canRemove: z.boolean(),
  })
  .openapi('Comment');
export type Comment = z.infer<typeof CommentSchema>;

export const CommentListSchema = z.object({ items: z.array(CommentSchema), nextCursor: z.string().nullable(), total: z.number().int() }).openapi('CommentList');
export type CommentList = z.infer<typeof CommentListSchema>;

/** Characters are counted by the domain rule (`validateComment`), which gives the message. `clientKey` makes a retried post safe. */
export const PostCommentSchema = z.object({ text: z.string().max(2000), clientKey: z.string().min(8).max(64).nullish() }).openapi('PostComment');
export type PostComment = z.infer<typeof PostCommentSchema>;

export const CommentQuerySchema = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(50).optional() }).openapi('CommentQuery');
export type CommentQuery = z.infer<typeof CommentQuerySchema>;

/** Real-time: a comment was posted on one of the seller's listings. Ids only; the app refetches. */
export const CommentEventSchema = z.object({ listingId: z.string(), commentId: z.string() });
export type CommentEventPayload = z.infer<typeof CommentEventSchema>;
