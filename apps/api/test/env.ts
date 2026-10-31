import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const isLocalUrl = (url: string | undefined): boolean => {
  try {
    return ['localhost', '127.0.0.1'].includes(new URL(url ?? '').hostname);
  } catch {
    return false;
  }
};

const ref = (text: string): string | undefined => /^DATABASE_URL=\S*?postgres\.([a-z0-9]+):/m.exec(text)?.[1];

/**
 * Loads .env.test and refuses to continue if it points at the development project.
 * Tests wipe tables, so a mix-up here would destroy dev data.
 */
export function loadTestEnv(): void {
  const testFile = fileURLToPath(new URL('../.env.test', import.meta.url));
  const devFile = fileURLToPath(new URL('../.env', import.meta.url));
  if (!existsSync(testFile)) throw new Error('apps/api/.env.test is missing (see .env.example)');
  process.loadEnvFile(testFile);
  const testRef = ref(readFileSync(testFile, 'utf8'));
  const devRef = existsSync(devFile) ? ref(readFileSync(devFile, 'utf8')) : undefined;
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL_DIRECT) throw new Error('.env.test must define DATABASE_URL and DATABASE_URL_DIRECT');
  // A database on this machine (e.g. the CI service container) can never be the Supabase dev project.
  if (isLocalUrl(process.env.DATABASE_URL) && isLocalUrl(process.env.DATABASE_URL_DIRECT)) return;
  if (!testRef) throw new Error('Could not find a Supabase project ref in .env.test');
  if (devRef && devRef === testRef) throw new Error('.env.test points at the same database as .env. Refusing to run tests.');
}
