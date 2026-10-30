import { describe, expect, it } from 'vitest';
import type { Clock } from '@fayda/domain';
import { SweepRunner } from '../src/scheduler/sweep-runner.js';
import type { AppConfig } from '../src/config.js';

const config = { sweepEnabled: true } as AppConfig;
const clock = (t: number): Clock => ({ now: () => t });

describe('SweepRunner', () => {
  it('runs every task with the clock time and reports changes', async () => {
    const seen: number[] = [];
    const r = new SweepRunner(clock(1234), config);
    r.register({ name: 'a', run: async (now) => (seen.push(now), 2) });
    r.register({ name: 'b', run: async () => 0 });
    expect(await r.tick()).toEqual({ a: 2, b: 0 });
    expect(seen).toEqual([1234]);
  });

  it('keeps going when one task fails', async () => {
    const r = new SweepRunner(clock(1), config);
    r.register({ name: 'bad', run: async () => { throw new Error('boom'); } });
    r.register({ name: 'good', run: async () => 1 });
    expect(await r.tick()).toEqual({ good: 1 });
  });

  it('skips a tick while the previous one is still running', async () => {
    const r = new SweepRunner(clock(1), config);
    let release!: () => void;
    let runs = 0;
    r.register({ name: 'slow', run: () => new Promise<number>((res) => { runs++; release = () => res(1); }) });
    const first = r.tick();
    expect(await r.tick()).toEqual({});
    release();
    await first;
    expect(runs).toBe(1);
  });

  it('does nothing on the interval when sweeping is disabled', async () => {
    const r = new SweepRunner(clock(1), { sweepEnabled: false } as AppConfig);
    let runs = 0;
    r.register({ name: 'x', run: async () => (runs++, 0) });
    await r.onInterval();
    expect(runs).toBe(0);
  });
});
