import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import type { Clock } from '@fayda/domain';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { CLOCK } from '../common/clock.js';

/** One kind of time-driven work: expiring offers, firing automatic counters, lapsing agreements, expiring orders. */
export interface SweepTask {
  name: string;
  /** Does the work due at `now` and returns how many rows it changed. Must be safe to run on two instances at once. */
  run(now: number): Promise<number>;
}

export const SWEEP_INTERVAL_MS = 1000;

/**
 * Runs every registered task once a second. Tasks claim rows with FOR UPDATE SKIP LOCKED, so a second API
 * instance would not double-process. A tick is skipped if the previous one is still running.
 */
@Injectable()
export class SweepRunner {
  private readonly log = new Logger('Sweep');
  private readonly tasks: SweepTask[] = [];
  private running = false;

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  register(task: SweepTask): void {
    this.tasks.push(task);
  }

  @Interval(SWEEP_INTERVAL_MS)
  async onInterval(): Promise<void> {
    if (this.config.sweepEnabled) await this.tick();
  }

  /** Runs all tasks once. A failing task is logged and does not stop the others. Returns changed rows per task. */
  async tick(): Promise<Record<string, number>> {
    const changed: Record<string, number> = {};
    if (this.running) return changed;
    this.running = true;
    try {
      const now = this.clock.now();
      for (const task of this.tasks) {
        try {
          changed[task.name] = await task.run(now);
        } catch (e) {
          this.log.error(`${task.name} failed: ${e instanceof Error ? e.message : 'unknown error'}`);
        }
      }
    } finally {
      this.running = false;
    }
    return changed;
  }
}
