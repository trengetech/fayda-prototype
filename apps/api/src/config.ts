import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** The label reported by /v1/meta. Defaults to NODE_ENV. Set it to `development` on a server that runs production code against dev data. */
  APP_ENV: z.enum(['development', 'test', 'production']).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().startsWith('postgres', 'DATABASE_URL must be a postgres connection string'),
  /** Comma-separated browser origins allowed by CORS. Native apps do not need CORS. */
  CORS_ORIGINS: z.string().default(''),
  SWEEP_ENABLED: z.enum(['true', 'false']).default('true'),
  /** `all`: card and product-page comment counts include everyone. `viewer`: they leave out people the viewer has blocked. */
  COMMENT_COUNT_MODE: z.enum(['all', 'viewer']).default('all'),
  /** `scored`: For You is ordered by the ranking score (I-39). `newest`: newest first, the fallback. */
  FEED_RANKER: z.enum(['newest', 'scored']).default('scored'),
  /** The oldest app contract level each app may use; older apps get 426 CLIENT_TOO_OLD. Raise it to force an update. */
  MIN_CLIENT_LEVEL_BUYER: z.coerce.number().int().min(1).max(1000).default(1),
  MIN_CLIENT_LEVEL_SELLER: z.coerce.number().int().min(1).max(1000).default(1),
  /** Signs access tokens. At least 32 characters; never commit it. */
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /** Only `dev-otp` exists today: a fixed code, no SMS. It is reported as simulated by /v1/meta. */
  AUTH_PROVIDER: z.enum(['dev-otp']).default('dev-otp'),
  ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  /** Per client address, for /v1/auth/*. Other routes allow 20 times as many. */
  AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(10000).default(20),
  /** Where the local-disk media adapter keeps uploads. Must be outside any folder a deploy replaces (I-11). */
  UPLOADS_DIR: z.string().min(1).default('./uploads'),
  /** `off` sends nothing (reported as simulated by /v1/meta); `expo` sends through the Expo push service (Android and iOS). */
  PUSH_PROVIDER: z.enum(['off', 'expo']).default('off'),
  /** Optional: only if the Expo project turns on enhanced push security. Never commit it. */
  EXPO_ACCESS_TOKEN: z.string().min(1).optional(),
});

export interface AppConfig {
  environment: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  corsOrigins: string[];
  sweepEnabled: boolean;
  feedRanker: 'newest' | 'scored';
  jwtSecret: string;
  authProvider: 'dev-otp';
  accessTtlSeconds: number;
  refreshTtlDays: number;
  authRateLimitPerMin: number;
  uploadsDir: string;
  pushProvider: 'off' | 'expo';
  commentCountMode: 'all' | 'viewer';
  minClientLevel: { buyer: number; seller: number };
  expoAccessToken: string | null;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Parses the environment once at start. Error messages name the variable, never its value. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${problems}`);
  }
  const e = parsed.data;
  return {
    environment: e.APP_ENV ?? e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    sweepEnabled: e.SWEEP_ENABLED === 'true',
    feedRanker: e.FEED_RANKER,
    commentCountMode: e.COMMENT_COUNT_MODE,
    minClientLevel: { buyer: e.MIN_CLIENT_LEVEL_BUYER, seller: e.MIN_CLIENT_LEVEL_SELLER },
    jwtSecret: e.JWT_SECRET,
    authProvider: e.AUTH_PROVIDER,
    accessTtlSeconds: e.ACCESS_TTL_SECONDS,
    refreshTtlDays: e.REFRESH_TTL_DAYS,
    authRateLimitPerMin: e.AUTH_RATE_LIMIT_PER_MIN,
    uploadsDir: e.UPLOADS_DIR,
    pushProvider: e.PUSH_PROVIDER,
    expoAccessToken: e.EXPO_ACCESS_TOKEN ?? null,
  };
}
