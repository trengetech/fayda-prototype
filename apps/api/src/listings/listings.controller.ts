import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  BuyerFeedSchema,
  BuyerListingSchema,
  ListingInputSchema,
  ListingStatusChangeSchema,
  SellerListingListSchema,
  SellerListingSchema,
  z,
  type BuyerFeed,
  type BuyerListing,
  type ListingInput,
  type SellerListing,
} from '@fayda/contracts';
import type { Clock } from '@fayda/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import { CLOCK } from '../common/clock.js';
import { IdempotencyService } from '../common/idempotency.service.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { ListingsService, MAX_FEED_PAGE } from './listings.service.js';

/** The seller's listings. Every write accepts an Idempotency-Key header, so a retry after a lost reply does not repeat it. */
@Controller('seller/listings')
@UseGuards(AuthGuard)
@Audience('seller')
export class SellerListingsController {
  constructor(
    @Inject(ListingsService) private readonly listings: ListingsService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async write<T>(who: AccessClaims, req: FastifyRequest, key: string | undefined, body: unknown, fn: () => Promise<{ status: number; body: T }>, reply: FastifyReply): Promise<T> {
    const out = await this.idempotency.run({ userId: who.userId, method: req.method, path: req.url.split('?')[0]! }, key, body, this.clock.now(), fn);
    void reply.code(out.status);
    return out.body;
  }

  @Get()
  async list(@Auth() who: AccessClaims) {
    return SellerListingListSchema.parse({ items: await this.listings.listForSeller(who.userId) });
  }

  @Get(':id')
  async get(@Auth() who: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string): Promise<SellerListing> {
    return SellerListingSchema.parse(await this.listings.getForSeller(who.userId, id));
  }

  @Post()
  async create(
    @Auth() who: AccessClaims,
    @Body(new ZodPipe(ListingInputSchema)) body: ListingInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SellerListing> {
    return this.write(who, req, key, body, async () => ({ status: 201, body: SellerListingSchema.parse(await this.listings.save(who.userId, null, body)) }), reply);
  }

  @Put(':id')
  async update(
    @Auth() who: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ListingInputSchema)) body: ListingInput,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SellerListing> {
    return this.write(who, req, key, body, async () => ({ status: 200, body: SellerListingSchema.parse(await this.listings.save(who.userId, id, body)) }), reply);
  }

  @Post(':id/status')
  async status(
    @Auth() who: AccessClaims,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ListingStatusChangeSchema)) body: { status: 'ACTIVE' | 'PAUSED' },
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SellerListing> {
    return this.write(who, req, key, body, async () => ({ status: 200, body: SellerListingSchema.parse(await this.listings.setStatus(who.userId, id, body.status)) }), reply);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@Auth() who: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.listings.deleteDraft(who.userId, id);
  }
}

const FeedQuerySchema = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(MAX_FEED_PAGE).optional() });

/** What a buyer sees: live listings only, built from buyer schemas. */
@Controller('buyer')
@UseGuards(AuthGuard)
@Audience('buyer')
export class BuyerCatalogController {
  constructor(@Inject(ListingsService) private readonly listings: ListingsService) {}

  @Get('feed')
  async feed(@Query(new ZodPipe(FeedQuerySchema)) q: { cursor?: string; limit?: number }): Promise<BuyerFeed> {
    return BuyerFeedSchema.parse(await this.listings.feed(q.cursor, q.limit));
  }

  @Get('listings/:id')
  async get(@Param('id', new ParseUUIDPipe()) id: string): Promise<BuyerListing> {
    return BuyerListingSchema.parse(await this.listings.getForBuyer(id));
  }
}
