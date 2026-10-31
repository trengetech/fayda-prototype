import { OpenAPIRegistry, OpenApiGeneratorV31, type RouteConfig } from '@asteasolutions/zod-to-openapi';
import { ProblemSchema } from './errors.js';
import { AuthResultSchema, MeSchema, OtpRequestSchema, OtpRequestedSchema, OtpVerifySchema, RefreshSchema } from './auth.js';
import { BuyerContactUpdateSchema, BuyerProfileInputSchema, BuyerProfileSchema, PaymentInputSchema, SellerProfileSchema, SellerShopInputSchema } from './profiles.js';
import { BuyerFeedSchema, BuyerListingSchema, ListingInputSchema, ListingStatusChangeSchema, SellerListingListSchema, SellerListingSchema } from './listings.js';
import { MediaIntentInputSchema, MediaIntentSchema, MediaSchema } from './media.js';
import { HealthSchema, MetaSchema } from './system.js';
import { z } from './zod.js';

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
  const id = { params: z.object({ id: z.string().uuid() }) };
  const idem = z.object({ 'Idempotency-Key': z.string().min(8).max(100).optional().openapi({ description: 'Repeat a write safely: the same key and body returns the first answer.' }) });
  const found = { 404: { description: 'Not found', content: problem }, 403: { description: 'Wrong app or no shop', content: problem } };
  const seller = (route: RouteConfig): RouteConfig => ({ tags: ['seller'], security: bearer, ...route });
  registry.registerPath(seller({ method: 'post', path: '/v1/seller/media/intents', summary: 'Ask to upload a photo or video (checks type and size first)', request: body(MediaIntentInputSchema), responses: { 201: { description: 'Where to upload', content: json(MediaIntentSchema) }, 400: fail[400], 429: { description: 'Too many unfinished uploads', content: problem }, ...found } }));
  registry.registerPath(seller({ method: 'post', path: '/v1/seller/media/{id}/complete', summary: 'Say the upload is done; the server checks size and content, then marks it ready', request: id, responses: { 200: { description: 'Ready', content: json(MediaSchema) }, 409: { description: 'The file has not arrived', content: problem }, 422: { description: 'Size mismatch', content: problem }, ...found } }));
  registry.registerPath({ method: 'put', path: '/v1/media/upload/{id}', tags: ['media'], summary: 'Disk adapter only: send the file bytes to the address from the intent (one-time token in the query)', request: { params: z.object({ id: z.string().uuid() }), query: z.object({ token: z.string() }) }, responses: { 204: { description: 'Stored' }, 400: { description: 'Wrong type or size', content: problem }, 401: { description: 'Bad or used token', content: problem }, 410: { description: 'Expired', content: problem } } });
  registry.registerPath({ method: 'get', path: '/v1/media/{id}', tags: ['media'], summary: 'A public listing photo or video (supports Range requests). A UPI QR is never public.', request: id, responses: { 200: { description: 'The file' }, 206: { description: 'Part of the file' }, 404: { description: 'Not found', content: problem }, 416: { description: 'Bad range' } } });
  registry.registerPath(seller({ method: 'get', path: '/v1/seller/listings', summary: 'My listings, including private rules and deal codes', responses: { 200: { description: 'Listings', content: json(SellerListingListSchema) }, ...found } }));
  registry.registerPath(seller({ method: 'post', path: '/v1/seller/listings', summary: 'Create a draft, or publish at once with publish=true', request: { ...body(ListingInputSchema), headers: idem }, responses: { 201: { description: 'Created', content: json(SellerListingSchema) }, 400: { description: 'Field errors, by field name', content: problem }, ...found } }));
  registry.registerPath(seller({ method: 'get', path: '/v1/seller/listings/{id}', summary: 'One of my listings', request: id, responses: { 200: { description: 'Listing', content: json(SellerListingSchema) }, ...found } }));
  registry.registerPath(seller({ method: 'put', path: '/v1/seller/listings/{id}', summary: 'Save changes (publish=true also makes a draft or paused listing live)', request: { ...id, ...body(ListingInputSchema), headers: idem }, responses: { 200: { description: 'Saved', content: json(SellerListingSchema) }, 400: { description: 'Field errors, by field name', content: problem }, ...found } }));
  registry.registerPath(seller({ method: 'post', path: '/v1/seller/listings/{id}/status', summary: 'Pause or resume a published listing', request: { ...id, ...body(ListingStatusChangeSchema), headers: idem }, responses: { 200: { description: 'Updated', content: json(SellerListingSchema) }, 409: { description: 'Still a draft', content: problem }, 422: { description: 'No stock to resume', content: problem }, ...found } }));
  registry.registerPath(seller({ method: 'delete', path: '/v1/seller/listings/{id}', summary: 'Delete a draft (published listings are paused instead)', request: id, responses: { 204: { description: 'Deleted' }, 409: { description: 'Not a draft', content: problem }, ...found } }));
  registry.registerPath({ method: 'get', path: '/v1/buyer/feed', tags: ['buyer'], summary: 'Live listings, newest first (public fields only)', security: bearer, request: { query: z.object({ cursor: z.string().optional(), limit: z.coerce.number().int().min(1).max(50).optional() }) }, responses: { 200: { description: 'A page of listings', content: json(BuyerFeedSchema) }, 400: fail[400], 401: fail[401] } });
  registry.registerPath({ method: 'get', path: '/v1/buyer/listings/{id}', tags: ['buyer'], summary: 'A live listing as a buyer sees it', security: bearer, request: id, responses: { 200: { description: 'Listing', content: json(BuyerListingSchema) }, 404: { description: 'Not available', content: problem }, 401: fail[401] } });
  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: '3.1.0',
    info: { title: 'Fayda API', version },
    servers: [{ url: '/' }],
  });
}
