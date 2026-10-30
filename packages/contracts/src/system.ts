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
    key: z.enum(['auth', 'media']),
    name: z.string(),
    /** True when the provider fakes real behaviour. Apps must never present simulated behaviour as real. */
    simulated: z.boolean(),
  })
  .openapi('Provider');

export const MetaSchema = z
  .object({
    environment: EnvironmentSchema,
    version: z.string(),
    providers: z.array(ProviderSchema),
  })
  .openapi('Meta');
export type Meta = z.infer<typeof MetaSchema>;
