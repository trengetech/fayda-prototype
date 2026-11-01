import { z } from './zod.js';

/** Stable machine-readable error codes. The API returns one in every problem+json body. */
export const ERROR_CODES = [
  // generic
  'VALIDATION', 'NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED', 'UNKNOWN_COMMAND', 'RATE_LIMITED', 'INTERNAL', 'SERVICE_UNAVAILABLE', 'IDEMPOTENCY_KEY_REUSED', 'INVALID_STATE',
  // identity and profile
  'INVALID_PHONE', 'INVALID_OTP', 'NO_PROFILE', 'NO_SELLER', 'NO_ADDRESS', 'LAST_ADDRESS', 'WRONG_APP',
  // listings
  'NOT_AVAILABLE', 'OWN_LISTING', 'NO_VARIANT', 'NO_STOCK', 'INVALID_STATUS', 'NOT_DRAFT',
  // media
  'MEDIA_NOT_READY', 'UPLOAD_MISMATCH', 'UPLOAD_EXPIRED',
  // bargaining
  'FIXED_PRICE', 'OUT_OF_STOCK', 'INVALID_AMOUNT', 'AT_OR_ABOVE_LIST', 'BELOW_PLATFORM_FLOOR', 'ALREADY_OPEN', 'DAILY_LIMIT',
  'NOT_OPEN', 'NOT_YOUR_TURN', 'TURN_LIMIT', 'MUST_INCREASE', 'MUST_DECREASE', 'ACCEPT_INSTEAD', 'NOTHING_TO_ACCEPT',
  'CANT_WITHDRAW', 'INVALID_ACTION', 'DEAL_ACCESS_REQUIRED', 'NEGOTIATION_CLOSED',
  // orders
  'NOT_AGREED', 'USE_WEBSITE', 'NO_METHOD',
  // chat, reviews, requests
  'INVALID_LISTING', 'EMPTY', 'TOO_LONG', 'NOT_CONFIRMED', 'CLOSED', 'OWN_REQUEST', 'NOT_IN_CATEGORY', 'ALREADY_RESPONDED',
  // discovery
  'OWN_SHOP', 'FOLLOW_LIMIT', 'SAVE_LIMIT',
  // safety
  'BLOCKED',
] as const;
export type ApiErrorCode = (typeof ERROR_CODES)[number];

export const ErrorCodeSchema = z.enum(ERROR_CODES).openapi('ErrorCode');

/** application/problem+json (RFC 9457) with a stable `code` and optional per-field messages. */
export const ProblemSchema = z
  .object({
    type: z.string().default('about:blank'),
    title: z.string(),
    status: z.number().int(),
    code: ErrorCodeSchema,
    detail: z.string().optional(),
    fields: z.record(z.string(), z.string()).optional(),
  })
  .openapi('Problem');
export type Problem = z.infer<typeof ProblemSchema>;
