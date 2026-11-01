import { EpochMsSchema } from './common.js';
import { z } from './zod.js';

export const ReportReasonSchema = z.enum(['SPAM', 'ABUSE', 'SCAM', 'OTHER']).openapi('ReportReason');
/** The words are checked by the domain rule (`validateReport`), which gives the message. */
export const ReportInputSchema = z.object({ reason: ReportReasonSchema, note: z.string().max(2000).nullish() }).openapi('ReportInput');
export type ReportInput = z.infer<typeof ReportInputSchema>;
export const ReportReceiptSchema = z.object({ received: z.literal(true) }).openapi('ReportReceipt');
export type ReportReceipt = z.infer<typeof ReportReceiptSchema>;

/** Block the author of a comment, or the other person in a chat thread. The server finds the person; apps never see user ids. */
export const BlockInputSchema = z.object({ source: z.enum(['COMMENT', 'THREAD']), id: z.string().uuid() }).openapi('BlockInput');
export type BlockInput = z.infer<typeof BlockInputSchema>;

export const BlockedPersonSchema = z.object({ id: z.string(), name: z.string(), since: EpochMsSchema }).openapi('BlockedPerson');
export type BlockedPerson = z.infer<typeof BlockedPersonSchema>;
export const BlockedListSchema = z.object({ items: z.array(BlockedPersonSchema) }).openapi('BlockedList');
export type BlockedList = z.infer<typeof BlockedListSchema>;
