import { z } from './zod.js';

export const EnvironmentSchema = z.enum(['development', 'test', 'production']).openapi('Environment');

export const HealthSchema = z
  .object({
    status: z.enum(['ok', 'down']),
    database: z.object({
      status: z.enum(['up', 'down']),
      latencyMs: z.number().nonnegative().nullable(),
    }),
    time: z.iso.datetime(),
  })
  .openapi('Health');
export type Health = z.infer<typeof HealthSchema>;

export const ProviderSchema = z
  .object({
    key: z.enum(['auth', 'media', 'push']),
    name: z.string(),
    /** True when the provider fakes real behaviour. Apps must never present simulated behaviour as real. */
    simulated: z.boolean(),
  })
  .openapi('Provider');

/**
 * The contract level. Raise it by one whenever a request or response changes in a way an older app cannot handle (a new required
 * field, a renamed field, a removed route). Each app is built with the level of the contracts it was built from and sends it with
 * every request; the server reports its own level and the oldest level it still accepts per app (`/v1/meta`).
 * 1 = before M3.8, 2 = M3.8 (per-listing numbers, view count, notification settings).
 */
export const CONTRACT_LEVEL = 2;

export const ClientAppSchema = z.enum(['buyer', 'seller']).openapi('ClientApp');
export type ClientApp = z.infer<typeof ClientAppSchema>;

export const MetaSchema = z
  .object({
    environment: EnvironmentSchema,
    version: z.string(),
    providers: z.array(ProviderSchema),
    /** The server's contract level. Absent on servers older than level 2. */
    apiLevel: z.number().int().optional(),
    /** The oldest app contract level the server still accepts, per app. Absent on servers older than level 2. */
    minClientLevel: z.object({ buyer: z.number().int(), seller: z.number().int() }).optional(),
  })
  .openapi('Meta');
export type Meta = z.infer<typeof MetaSchema>;

/** `ok`; `update-required` (this app is older than the server accepts); `server-older` (this app is newer than the server). */
export type VersionStatus = 'ok' | 'update-required' | 'server-older';

/**
 * Compares an app's contract level with what the server says. A server that reports nothing is level 1 (it predates this check),
 * so a newer app sees `server-older` rather than guessing it is fine.
 */
export function versionStatus(app: ClientApp, clientLevel: number, meta: Pick<Meta, 'apiLevel' | 'minClientLevel'>): VersionStatus {
  const min = meta.minClientLevel?.[app] ?? 1;
  if (clientLevel < min) return 'update-required';
  if (clientLevel > (meta.apiLevel ?? 1)) return 'server-older';
  return 'ok';
}
