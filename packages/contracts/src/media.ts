import { EpochMsSchema } from './common.js';
import { z } from './zod.js';

export const MediaKindSchema = z.enum(['image', 'video']).openapi('MediaKind');
export const MediaPurposeSchema = z.enum(['LISTING', 'UPI_QR']).openapi('MediaPurpose');

/** Asks to upload one file. The server checks kind, type and size before handing out an upload address. */
export const MediaIntentInputSchema = z
  .object({
    kind: z.string().max(10),
    purpose: z.string().max(20),
    mime: z.string().max(60),
    size: z.number().int(),
    durationSec: z.number().nullish(),
  })
  .openapi('MediaIntentInput');
export type MediaIntentInput = z.infer<typeof MediaIntentInputSchema>;

/**
 * Where and how to upload. `url` is either absolute (a signed storage address) or starts with `/` (the API itself);
 * clients resolve a leading `/` against the API address. The same shape serves the disk adapter now and R2/Stream later.
 */
export const MediaIntentSchema = z
  .object({
    mediaId: z.string().uuid(),
    upload: z.object({ method: z.literal('PUT'), url: z.string(), headers: z.record(z.string(), z.string()) }),
    expiresAt: EpochMsSchema,
  })
  .openapi('MediaIntent');
export type MediaIntent = z.infer<typeof MediaIntentSchema>;

export const MediaSchema = z
  .object({
    id: z.string().uuid(),
    kind: MediaKindSchema,
    purpose: MediaPurposeSchema,
    status: z.enum(['PENDING', 'READY']),
    size: z.number().int().nullable(),
    /** Public address of a ready listing file. Null for pending uploads and for private files such as a UPI QR. */
    url: z.string().nullable(),
  })
  .openapi('Media');
export type Media = z.infer<typeof MediaSchema>;
