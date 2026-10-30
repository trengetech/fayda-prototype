import 'reflect-metadata';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { ProblemFilter } from './common/problem.filter.js';
import type { AppConfig } from './config.js';

export async function createApp(config: AppConfig): Promise<NestFastifyApplication> {
  // trustProxy: Caddy terminates TLS and forwards the real client address.
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(config), new FastifyAdapter({ trustProxy: true }), {
    logger: config.environment === 'test' ? false : ['log', 'warn', 'error'],
  });
  await app.register(helmet);
  await app.register(cors, { origin: config.corsOrigins.length ? config.corsOrigins : false });
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  return app;
}
