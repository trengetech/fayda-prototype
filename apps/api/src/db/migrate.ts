import { runMigrations } from './run-migrations.js';

const url = process.env.DATABASE_URL_DIRECT;
if (!url) {
  console.error('DATABASE_URL_DIRECT is not set. Run with: node --env-file=.env dist/db/migrate.js');
  process.exit(1);
}
try {
  await runMigrations(url);
  console.log('Migrations applied.');
} catch (e) {
  console.error('Migration failed:', e instanceof Error ? e.message : 'unknown error');
  process.exit(1);
}
