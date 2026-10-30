import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const MIGRATIONS_DIR = new URL('../../drizzle', import.meta.url).pathname;

/** Applies pending migrations. Use the session pooler (port 5432) URL: migrations need a real session. */
export async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1, prepare: false, connect_timeout: 15, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await client.end({ timeout: 5 });
  }
}
