/** Time source injected into every rule so tests control time. Values are epoch milliseconds. */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = { now: () => Date.now() };

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
