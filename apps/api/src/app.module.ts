import { Module, type DynamicModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { systemClock } from '@fayda/domain';
import { CLOCK } from './common/clock.js';
import { IdempotencyService } from './common/idempotency.service.js';
import { APP_CONFIG, type AppConfig } from './config.js';
import { DbService } from './db/db.service.js';
import { SweepRunner } from './scheduler/sweep-runner.js';
import { SystemController } from './system/system.controller.js';

@Module({})
export class AppModule {
  static register(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [ScheduleModule.forRoot()],
      controllers: [SystemController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: CLOCK, useValue: systemClock },
        DbService,
        IdempotencyService,
        SweepRunner,
      ],
      exports: [DbService, IdempotencyService, SweepRunner, CLOCK, APP_CONFIG],
    };
  }
}
