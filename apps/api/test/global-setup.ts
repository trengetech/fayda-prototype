import { runMigrations } from '../src/db/run-migrations.js';
import { loadTestEnv } from './env.js';

/** Brings the test database to the latest schema once before any test file runs. */
export default async function setup(): Promise<void> {
  loadTestEnv();
  await runMigrations(process.env.DATABASE_URL_DIRECT as string);
}
