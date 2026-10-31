/** Time source injected into every rule so tests control time. Values are epoch milliseconds. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** "2 h 5 min", "12 min", "less than a minute", or "expired" - for countdown labels. */
export function timeLeft(until: number, now: number): string {
  const ms = until - now;
  if (ms <= 0) return 'expired';
  const mins = Math.ceil(ms / MINUTE);
  if (ms < MINUTE) return 'less than a minute';
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} h`;
  return m ? `${h} h ${m} min` : `${h} h`;
}
