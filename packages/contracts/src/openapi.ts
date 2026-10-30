import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { ProblemSchema } from './errors.js';
import { HealthSchema, MetaSchema } from './system.js';

const problem = { 'application/problem+json': { schema: ProblemSchema } };

/** Builds the OpenAPI 3.1 document from the same Zod schemas the API validates with. */
export type OpenApiDocument = ReturnType<OpenApiGeneratorV31['generateDocument']>;

export function buildOpenApiDocument(version: string): OpenApiDocument {
  const registry = new OpenAPIRegistry();
  registry.registerPath({
    method: 'get',
    path: '/v1/health',
    tags: ['system'],
    summary: 'Liveness and database status',
    responses: {
      200: { description: 'API and database are up', content: { 'application/json': { schema: HealthSchema } } },
      503: { description: 'The database is down', content: { 'application/json': { schema: HealthSchema } } },
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/v1/meta',
    tags: ['system'],
    summary: 'Environment and providers (each with a simulated flag)',
    responses: {
      200: { description: 'Environment metadata', content: { 'application/json': { schema: MetaSchema } } },
      500: { description: 'Unexpected error', content: problem },
    },
  });
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'Fayda API', version },
    servers: [{ url: '/' }],
  });
}
