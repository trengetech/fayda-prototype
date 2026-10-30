import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApp } from '../src/create-app.js';
import { loadConfig } from '../src/config.js';
import { DbService } from '../src/db/db.service.js';

export async function startApp(overrides: Record<string, string> = {}): Promise<NestFastifyApplication> {
  const app = await createApp(loadConfig({ ...process.env, NODE_ENV: 'test', SWEEP_ENABLED: 'false', ...overrides }));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export const dbOf = (app: NestFastifyApplication): DbService => app.get(DbService);
