import type { ApiErrorCode } from '@fayda/contracts';

/** An expected failure that maps to a problem+json response. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/** HTTP status for each domain failure code. Unlisted codes are 422 (the request was understood but refused). */
const STATUS: Partial<Record<string, number>> = {
  VALIDATION: 400,
  INVALID_PHONE: 400,
  INVALID_OTP: 400,
  INVALID_AMOUNT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NO_SELLER: 403,
  NO_PROFILE: 403,
  ALREADY_OPEN: 409,
  OUT_OF_STOCK: 409,
  NOT_OPEN: 409,
  NOT_YOUR_TURN: 409,
  NOTHING_TO_ACCEPT: 409,
  CANT_WITHDRAW: 409,
  TURN_LIMIT: 409,
  OWN_LISTING: 403,
  NOT_AVAILABLE: 404,
  DEAL_ACCESS_REQUIRED: 400,
  INVALID_STATE: 409,
  NOT_AGREED: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  DAILY_LIMIT: 429,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
};
export const statusForCode = (code: string): number => STATUS[code] ?? 422;
