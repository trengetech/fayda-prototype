import { OpenAPIRegistry, OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { ProblemSchema } from './errors.js';
import { AuthResultSchema, MeSchema, OtpRequestSchema, OtpRequestedSchema, OtpVerifySchema, RefreshSchema } from './auth.js';
import { BuyerContactUpdateSchema, BuyerProfileInputSchema, BuyerProfileSchema, PaymentInputSchema, SellerProfileSchema, SellerShopInputSchema } from './profiles.js';
import { HealthSchema, MetaSchema } from './system.js';

const problem = { 'application/problem+json': { schema: ProblemSchema } };
const json = <T>(schema: T) => ({ 'application/json': { schema } });
const body = <T>(schema: T) => ({ body: { content: json(schema), required: true } });
const bearer = [{ bearerAuth: [] }];

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
  registry.registerComponent('securitySchemes', 'bearerAuth', { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
  const fail = { 400: { description: 'Validation failed', content: problem }, 401: { description: 'Not signed in', content: problem } };
  registry.registerPath({ method: 'post', path: '/v1/auth/otp/request', tags: ['auth'], summary: 'Start sign-in (development OTP: no SMS is sent)', request: body(OtpRequestSchema), responses: { 200: { description: 'Code requested', content: json(OtpRequestedSchema) }, 400: fail[400], 429: { description: 'Too many requests', content: problem } } });
  registry.registerPath({ method: 'post', path: '/v1/auth/otp/verify', tags: ['auth'], summary: 'Verify the code and sign in to one app', request: body(OtpVerifySchema), responses: { 200: { description: 'Signed in', content: json(AuthResultSchema) }, 400: fail[400], 429: { description: 'Too many requests', content: problem } } });
  registry.registerPath({ method: 'post', path: '/v1/auth/refresh', tags: ['auth'], summary: 'Exchange a refresh token for a new pair (the old one stops working)', request: body(RefreshSchema), responses: { 200: { description: 'New tokens', content: json(AuthResultSchema) }, 401: fail[401] } });
  registry.registerPath({ method: 'post', path: '/v1/auth/logout', tags: ['auth'], summary: 'End this app’s session', security: bearer, responses: { 204: { description: 'Signed out' }, 401: fail[401] } });
  registry.registerPath({ method: 'get', path: '/v1/me', tags: ['auth'], summary: 'Who is signed in, and what is missing from their profile', security: bearer, responses: { 200: { description: 'Current user', content: json(MeSchema) }, 401: fail[401] } });
  registry.registerPath({ method: 'get', path: '/v1/buyer/profile', tags: ['buyer'], summary: 'Buyer profile', security: bearer, responses: { 200: { description: 'Profile', content: json(BuyerProfileSchema) }, 401: fail[401], 403: { description: 'Wrong app', content: problem } } });
  registry.registerPath({ method: 'put', path: '/v1/buyer/profile', tags: ['buyer'], summary: 'Create or complete the buyer profile (contact and agreement required)', security: bearer, request: body(BuyerProfileInputSchema), responses: { 200: { description: 'Saved', content: json(BuyerProfileSchema) }, 400: fail[400], 401: fail[401] } });
  registry.registerPath({ method: 'patch', path: '/v1/buyer/profile/contact', tags: ['buyer'], summary: 'Change the contact numbers sellers can see on open orders', security: bearer, request: body(BuyerContactUpdateSchema), responses: { 200: { description: 'Saved', content: json(BuyerProfileSchema) }, 400: fail[400], 401: fail[401] } });
  registry.registerPath({ method: 'get', path: '/v1/seller/profile', tags: ['seller'], summary: 'Seller profile (own view)', security: bearer, responses: { 200: { description: 'Profile', content: json(SellerProfileSchema) }, 401: fail[401], 404: { description: 'No shop yet', content: problem } } });
  registry.registerPath({ method: 'put', path: '/v1/seller/profile', tags: ['seller'], summary: 'Create or update the shop (steps 1 and 2: shop, categories, location, contact, declared times)', security: bearer, request: body(SellerShopInputSchema), responses: { 200: { description: 'Saved', content: json(SellerProfileSchema) }, 400: fail[400], 401: fail[401] } });
  registry.registerPath({ method: 'put', path: '/v1/seller/payment', tags: ['seller'], summary: 'Save payment details and accept the Code of Conduct (step 3)', security: bearer, request: body(PaymentInputSchema), responses: { 200: { description: 'Saved', content: json(SellerProfileSchema) }, 400: fail[400], 401: fail[401] } });
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'Fayda API', version },
    servers: [{ url: '/' }],
  });
}
