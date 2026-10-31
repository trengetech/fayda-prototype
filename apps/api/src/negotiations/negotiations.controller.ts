import { Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  AcceptSchema,
  BuyerNegotiationListSchema,
  BuyerNegotiationSchema,
  CounterSchema,
  SellerNegotiationListSchema,
  SellerNegotiationSchema,
  StartOfferSchema,
  type Accept,
  type BuyerNegotiation,
  type BuyerNegotiationList,
  type Counter,
  type SellerNegotiation,
  type SellerNegotiationList,
  type StartOffer,
} from '@fayda/contracts';
import type { Clock } from '@fayda/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import { CLOCK } from '../common/clock.js';
import { IdempotencyService } from '../common/idempotency.service.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { NegotiationsService } from './negotiations.service.js';

/** Every write takes an Idempotency-Key, so a retry after a lost reply does not make a second offer or counter. */
abstract class IdempotentController {
  protected constructor(
    protected readonly idempotency: IdempotencyService,
    protected readonly clock: Clock,
  ) {}

  protected async write<T>(who: AccessClaims, req: FastifyRequest, reply: FastifyReply, key: string | undefined, body: unknown, status: number, fn: () => Promise<T>): Promise<T> {
    const out = await this.idempotency.run({ userId: who.userId, method: req.method, path: req.url.split('?')[0]! }, key, body, this.clock.now(), async () => ({ status, body: await fn() }));
    void reply.code(out.status);
    return out.body;
  }
}

const IdParam = new ParseUUIDPipe();

/** The buyer's offers. Responses are built from the buyer view only. */
@Controller('buyer')
@UseGuards(AuthGuard)
@Audience('buyer')
export class BuyerNegotiationsController extends IdempotentController {
  constructor(
    @Inject(NegotiationsService) private readonly svc: NegotiationsService,
    @Inject(IdempotencyService) idempotency: IdempotencyService,
    @Inject(CLOCK) clock: Clock,
  ) {
    super(idempotency, clock);
  }

  @Post('listings/:id/offers')
  async start(
    @Auth() who: AccessClaims,
    @Param('id', IdParam) listingId: string,
    @Body(new ZodPipe(StartOfferSchema)) body: StartOffer,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BuyerNegotiation> {
    return this.write(who, req, reply, key, body, 201, async () => BuyerNegotiationSchema.parse(await this.svc.startOffer(who.userId, listingId, body)));
  }

  @Get('negotiations')
  async list(@Auth() who: AccessClaims): Promise<BuyerNegotiationList> {
    return BuyerNegotiationListSchema.parse(await this.svc.listForBuyer(who.userId));
  }

  @Get('negotiations/:id')
  async get(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<BuyerNegotiation> {
    return BuyerNegotiationSchema.parse(await this.svc.getForBuyer(who.userId, id));
  }

  @Post('negotiations/:id/counter')
  async counter(
    @Auth() who: AccessClaims,
    @Param('id', IdParam) id: string,
    @Body(new ZodPipe(CounterSchema)) body: Counter,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BuyerNegotiation> {
    return this.write(who, req, reply, key, body, 200, async () => BuyerNegotiationSchema.parse(await this.svc.buyerCounter(who.userId, id, body.amount)));
  }

  @Post('negotiations/:id/accept')
  async accept(@Auth() who: AccessClaims, @Param('id', IdParam) id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<BuyerNegotiation> {
    return this.write(who, req, reply, key, null, 200, async () => BuyerNegotiationSchema.parse(await this.svc.buyerAccept(who.userId, id)));
  }

  @Post('negotiations/:id/decline')
  async decline(@Auth() who: AccessClaims, @Param('id', IdParam) id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<BuyerNegotiation> {
    return this.write(who, req, reply, key, null, 200, async () => BuyerNegotiationSchema.parse(await this.svc.buyerDecline(who.userId, id)));
  }

  @Post('negotiations/:id/withdraw')
  async withdraw(@Auth() who: AccessClaims, @Param('id', IdParam) id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<BuyerNegotiation> {
    return this.write(who, req, reply, key, null, 200, async () => BuyerNegotiationSchema.parse(await this.svc.buyerWithdraw(who.userId, id)));
  }
}

/** The seller's offer inbox. The seller sees who made each offer, including their own automatic replies. */
@Controller('seller/negotiations')
@UseGuards(AuthGuard)
@Audience('seller')
export class SellerNegotiationsController extends IdempotentController {
  constructor(
    @Inject(NegotiationsService) private readonly svc: NegotiationsService,
    @Inject(IdempotencyService) idempotency: IdempotencyService,
    @Inject(CLOCK) clock: Clock,
  ) {
    super(idempotency, clock);
  }

  @Get()
  async list(@Auth() who: AccessClaims): Promise<SellerNegotiationList> {
    return SellerNegotiationListSchema.parse(await this.svc.listForSeller(who.userId));
  }

  @Get(':id')
  async get(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<SellerNegotiation> {
    return SellerNegotiationSchema.parse(await this.svc.getForSeller(who.userId, id));
  }

  @Post(':id/accept')
  async accept(
    @Auth() who: AccessClaims,
    @Param('id', IdParam) id: string,
    @Body(new ZodPipe(AcceptSchema)) body: Accept,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SellerNegotiation> {
    return this.write(who, req, reply, key, body, 200, async () => SellerNegotiationSchema.parse(await this.svc.sellerAccept(who.userId, id, body.dealAccess)));
  }

  @Post(':id/counter')
  async counter(
    @Auth() who: AccessClaims,
    @Param('id', IdParam) id: string,
    @Body(new ZodPipe(CounterSchema)) body: Counter,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SellerNegotiation> {
    return this.write(who, req, reply, key, body, 200, async () => SellerNegotiationSchema.parse(await this.svc.sellerCounter(who.userId, id, body.amount, body.dealAccess)));
  }

  @Post(':id/decline')
  async decline(@Auth() who: AccessClaims, @Param('id', IdParam) id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<SellerNegotiation> {
    return this.write(who, req, reply, key, null, 200, async () => SellerNegotiationSchema.parse(await this.svc.sellerDecline(who.userId, id)));
  }
}
