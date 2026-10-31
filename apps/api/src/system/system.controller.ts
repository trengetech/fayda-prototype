import { Controller, Get, Inject, Res } from '@nestjs/common';
import { HealthSchema, MetaSchema, buildOpenApiDocument, type Health, type Meta } from '@fayda/contracts';
import type { Clock } from '@fayda/domain';
import type { FastifyReply } from 'fastify';
import { CLOCK } from '../common/clock.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { AUTH_VERIFIER, type AuthVerifier } from '../auth/auth-verifier.js';
import { DbService } from '../db/db.service.js';
import { APP_VERSION } from '../version.js';

@Controller()
export class SystemController {
  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUTH_VERIFIER) private readonly verifier: AuthVerifier,
  ) {}

  /** 200 when the database answers, 503 when it does not. Never includes error details. */
  @Get('health')
  async health(@Res({ passthrough: true }) reply: FastifyReply): Promise<Health> {
    let database: Health['database'];
    try {
      database = { status: 'up', latencyMs: (await this.database.ping()).latencyMs };
    } catch {
      database = { status: 'down', latencyMs: null };
      void reply.code(503);
    }
    return HealthSchema.parse({
      status: database.status === 'up' ? 'ok' : 'down',
      database,
      time: new Date(this.clock.now()).toISOString(),
    });
  }

  /** Environment and providers. `simulated: true` means the app must show it as a prototype, not real. */
  @Get('meta')
  meta(): Meta {
    return MetaSchema.parse({
      environment: this.config.environment,
      version: APP_VERSION,
      providers: [
        { key: 'auth', name: this.verifier.name, simulated: this.verifier.simulated },
        { key: 'media', name: 'local-disk', simulated: true },
      ],
    });
  }

  @Get('openapi.json')
  openapi(): unknown {
    return buildOpenApiDocument(APP_VERSION);
  }
}
