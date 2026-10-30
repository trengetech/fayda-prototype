import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().startsWith('postgres', 'DATABASE_URL must be a postgres connection string'),
  /** Comma-separated browser origins allowed by CORS. Native apps do not need CORS. */
  CORS_ORIGINS: z.string().default(''),
  SWEEP_ENABLED: z.enum(['true', 'false']).default('true'),
});

export interface AppConfig {
  environment: 'development' | 'test' | 'production';
  port: number;
  host: string;
  databaseUrl: string;
  corsOrigins: string[];
  sweepEnabled: boolean;
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
    environment: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    sweepEnabled: e.SWEEP_ENABLED === 'true',
  };
}
