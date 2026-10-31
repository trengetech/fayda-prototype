import { Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  BuyerOrderListSchema,
  BuyerOrderSchema,
  CancelOrderSchema,
  ConfirmOrderSchema,
  PlaceOrderSchema,
  SellerOrderListSchema,
  SellerOrderSchema,
  SellerRecordSchema,
  ShipmentSchema,
  type BuyerOrder,
  type BuyerOrderList,
  type CancelOrder,
  type ConfirmOrder,
  type PlaceOrder,
  type SellerOrder,
  type SellerOrderList,
  type SellerRecord,
  type ShipmentBody,
} from '@fayda/contracts';
import type { Clock } from '@fayda/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import { CLOCK } from '../common/clock.js';
import { IdempotencyService } from '../common/idempotency.service.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { IdempotentController } from '../negotiations/negotiations.controller.js';
import { OrdersService } from './orders.service.js';

const IdParam = new ParseUUIDPipe();

/** The buyer's orders. Responses are parsed through the buyer schema, so nothing outside it can leave the server. */
@Controller('buyer/orders')
@UseGuards(AuthGuard)
@Audience('buyer')
export class BuyerOrdersController extends IdempotentController {
  constructor(
    @Inject(OrdersService) private readonly svc: OrdersService,
    @Inject(IdempotencyService) idempotency: IdempotencyService,
    @Inject(CLOCK) clock: Clock,
  ) {
    super(idempotency, clock);
  }

  @Post()
  async place(
    @Auth() who: AccessClaims,
    @Body(new ZodPipe(PlaceOrderSchema)) body: PlaceOrder,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BuyerOrder> {
    return this.write(who, req, reply, key, body, 201, async () => BuyerOrderSchema.parse(await this.svc.place(who.userId, body)));
  }

  @Get()
  async list(@Auth() who: AccessClaims): Promise<BuyerOrderList> {
    return BuyerOrderListSchema.parse(await this.svc.listForBuyer(who.userId));
  }

  @Get(':id')
  async get(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<BuyerOrder> {
    return BuyerOrderSchema.parse(await this.svc.getForBuyer(who.userId, id));
  }

  /** The seller's UPI QR image. Private: only the buyer of this order, only while it is PLACED and paid by UPI. */
  @Get(':id/payment-qr')
  async paymentQr(@Auth() who: AccessClaims, @Param('id', IdParam) id: string, @Res() reply: FastifyReply): Promise<FastifyReply> {
    const f = await this.svc.paymentQr(who.userId, id);
    return reply.header('content-type', f.mime).header('content-length', f.size).header('cache-control', 'private, no-store').send(f.stream);
  }
}

/** The seller's orders. Only the seller moves an order forward (D6). */
@Controller('seller')
@UseGuards(AuthGuard)
@Audience('seller')
export class SellerOrdersController extends IdempotentController {
  constructor(
    @Inject(OrdersService) private readonly svc: OrdersService,
    @Inject(IdempotencyService) idempotency: IdempotencyService,
    @Inject(CLOCK) clock: Clock,
  ) {
    super(idempotency, clock);
  }

  @Get('orders')
  async list(@Auth() who: AccessClaims): Promise<SellerOrderList> {
    return SellerOrderListSchema.parse(await this.svc.listForSeller(who.userId));
  }

  @Get('orders/:id')
  async get(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<SellerOrder> {
    return SellerOrderSchema.parse(await this.svc.getForSeller(who.userId, id));
  }

  @Post('orders/:id/confirm')
  async confirm(
    @Auth() who: AccessClaims,
    @Param('id', IdParam) id: string,
    @Body(new ZodPipe(ConfirmOrderSchema)) body: ConfirmOrder,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SellerOrder> {
    return this.write(who, req, reply, key, body, 200, async () => SellerOrderSchema.parse(await this.svc.confirm(who.userId, id, body)));
  }

  @Post('orders/:id/ship')
  async ship(
    @Auth() who: AccessClaims,
    @Param('id', IdParam) id: string,
    @Body(new ZodPipe(ShipmentSchema)) body: ShipmentBody,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SellerOrder> {
    return this.write(who, req, reply, key, body, 200, async () => SellerOrderSchema.parse(await this.svc.ship(who.userId, id, body)));
  }

  @Post('orders/:id/deliver')
  async deliver(@Auth() who: AccessClaims, @Param('id', IdParam) id: string, @Headers('idempotency-key') key: string | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply): Promise<SellerOrder> {
    return this.write(who, req, reply, key, null, 200, async () => SellerOrderSchema.parse(await this.svc.deliver(who.userId, id)));
  }

  @Post('orders/:id/cancel')
  async cancel(
    @Auth() who: AccessClaims,
    @Param('id', IdParam) id: string,
    @Body(new ZodPipe(CancelOrderSchema)) body: CancelOrder,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<SellerOrder> {
    return this.write(who, req, reply, key, body, 200, async () => SellerOrderSchema.parse(await this.svc.cancel(who.userId, id, body)));
  }

  /** The seller's own public record (what buyers see on the shop). */
  @Get('record')
  async record(@Auth() who: AccessClaims): Promise<SellerRecord> {
    return SellerRecordSchema.parse(await this.svc.recordOfUser(who.userId));
  }
}

/** Public: a shop's record, no sign-in. It holds counts, a median time and a rating, nothing about any one order. */
@Controller('shops')
export class PublicShopsController {
  constructor(@Inject(OrdersService) private readonly svc: OrdersService) {}

  @Get(':id/record')
  async record(@Param('id', IdParam) id: string): Promise<SellerRecord> {
    return SellerRecordSchema.parse(await this.svc.recordOfSeller(id));
  }
}
