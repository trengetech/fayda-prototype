import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { APP_CONFIG, type AppConfig } from '../config.js';
import * as schema from './schema.js';

export const PING_TIMEOUT_MS = 3000;

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly client: postgres.Sql;
  readonly db: PostgresJsDatabase<typeof schema>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    // Supabase's transaction pooler (port 6543) needs two settings, both verified against it:
    // - prepare: false, because it does not support prepared statements;
    // - max_pipeline: 1, because with postgres.js's default pipelining, concurrent queries hang (even plain selects).
    this.client = postgres(config.databaseUrl, { prepare: false, max_pipeline: 1, max: 5, idle_timeout: 20, connect_timeout: 10 });
    this.db = drizzle(this.client, { schema });
  }

  /** Round-trips a trivial query. Rejects on failure or after PING_TIMEOUT_MS. */
  async ping(): Promise<{ latencyMs: number }> {
    const started = performance.now();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('database ping timed out')), PING_TIMEOUT_MS);
    });
    try {
      await Promise.race([this.client`select 1`, timeout]);
      return { latencyMs: Math.round(performance.now() - started) };
    } finally {
      clearTimeout(timer);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.end({ timeout: 5 });
  }
}
