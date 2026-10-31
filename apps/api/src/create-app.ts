import 'reflect-metadata';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { HttpException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { ProblemFilter } from './common/problem.filter.js';
import { registerMediaRoutes } from './media/media-routes.js';
import type { AppConfig } from './config.js';
import type { Clock } from '@fayda/domain';

/** `clock` is for tests, which move time by hand to check timers (5 s counters, 24 h expiry) without waiting. */
export async function createApp(config: AppConfig, clock?: Clock): Promise<NestFastifyApplication> {
  // trustProxy: Caddy terminates TLS and forwards the real client address.
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(config, clock), new FastifyAdapter({ trustProxy: true }), {
    logger: config.environment === 'test' ? false : ['log', 'warn', 'error'],
  });
  await app.register(helmet);
  // Sign-in routes get a tight limit per client address; everything else allows 20 times as many requests.
  await app.register(rateLimit, {
    global: true,
    timeWindow: '1 minute',
    max: (req) => (req.url.startsWith('/v1/auth/') ? config.authRateLimitPerMin : config.authRateLimitPerMin * 20),
    errorResponseBuilder: (_req, ctx) => new HttpException(`Too many requests. Try again in ${Math.ceil(ctx.ttl / 1000)} seconds.`, 429),
  });
  await app.register(cors, { origin: config.corsOrigins.length ? config.corsOrigins : false });
  await registerMediaRoutes(app);
  app.useWebSocketAdapter(new IoAdapter(app));
  app.setGlobalPrefix('v1');
  app.useGlobalFilters(new ProblemFilter());
  app.enableShutdownHooks();
  return app;
}
