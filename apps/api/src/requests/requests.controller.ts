import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import {
  BuyerRequestListSchema,
  BuyerRequestSchema,
  CreateRequestSchema,
  RespondSchema,
  SellerRequestListSchema,
  SellerRequestSchema,
  type BuyerRequest,
  type BuyerRequestList,
  type CreateRequest,
  type Respond,
  type SellerRequest,
  type SellerRequestList,
} from '@fayda/contracts';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import { AppError } from '../common/app-error.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { RequestsService } from './requests.service.js';

const IdParam = new ParseUUIDPipe();

@Controller('buyer')
@UseGuards(AuthGuard)
@Audience('buyer')
export class BuyerRequestsController {
  constructor(@Inject(RequestsService) private readonly svc: RequestsService) {}

  @Post('requests')
  @HttpCode(201)
  async create(@Auth() who: AccessClaims, @Body(new ZodPipe(CreateRequestSchema)) body: CreateRequest): Promise<BuyerRequest> {
    return BuyerRequestSchema.parse(await this.svc.create(who.userId, body));
  }

  @Get('requests')
  async list(@Auth() who: AccessClaims): Promise<BuyerRequestList> {
    return BuyerRequestListSchema.parse(await this.svc.listForBuyer(who.userId));
  }

  // Declared before `requests/:id` so "reach" is not read as an id.
  @Get('requests/reach')
  reach(@Auth() who: AccessClaims, @Query('category') category: string | undefined): Promise<{ count: number }> {
    if (!category) throw new AppError(400, 'VALIDATION', 'Choose a category.', { category: 'Choose a category.' });
    return this.svc.reach(who.userId, category);
  }

  @Get('requests/:id')
  async get(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<BuyerRequest> {
    return BuyerRequestSchema.parse(await this.svc.getForBuyer(who.userId, id));
  }

  @Post('requests/:id/close')
  @HttpCode(200)
  async close(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<BuyerRequest> {
    return BuyerRequestSchema.parse(await this.svc.close(who.userId, id));
  }

  @Post('responses/:id/want')
  @HttpCode(200)
  async want(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<BuyerRequest> {
    return BuyerRequestSchema.parse(await this.svc.answer(who.userId, id, 'WANTED'));
  }

  @Post('responses/:id/decline')
  @HttpCode(200)
  async decline(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<BuyerRequest> {
    return BuyerRequestSchema.parse(await this.svc.answer(who.userId, id, 'DECLINED'));
  }
}

@Controller('seller/requests')
@UseGuards(AuthGuard)
@Audience('seller')
export class SellerRequestsController {
  constructor(@Inject(RequestsService) private readonly svc: RequestsService) {}

  @Get()
  async list(@Auth() who: AccessClaims): Promise<SellerRequestList> {
    return SellerRequestListSchema.parse(await this.svc.listForSeller(who.userId));
  }

  @Post(':id/responses')
  @HttpCode(201)
  async respond(@Auth() who: AccessClaims, @Param('id', IdParam) id: string, @Body(new ZodPipe(RespondSchema)) body: Respond): Promise<SellerRequest> {
    return SellerRequestSchema.parse(await this.svc.respond(who.userId, id, body));
  }
}
