/** A new key for one message. */
export const newMessageKey = (): string => `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * The key for a send. A retry of the same content reuses the key, so a lost reply cannot post the message twice; once it
 * is sent (or the content changes) the next send gets a fresh key.
 */
export interface KeyMemory {
  sig: string | null;
  key: string | null;
}
export function keyFor(mem: KeyMemory, sig: string): string {
  if (mem.sig !== sig || !mem.key) {
    mem.sig = sig;
    mem.key = newMessageKey();
  }
  return mem.key;
}
export const forgetKey = (mem: KeyMemory): void => {
  mem.sig = null;
  mem.key = null;
};
