import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { BlockInputSchema, BlockedListSchema, BlockedPersonSchema, ReportInputSchema, ReportReceiptSchema, type BlockInput, type BlockedList, type BlockedPerson, type ReportInput, type ReportReceipt } from '@fayda/contracts';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { SafetyService } from './safety.service.js';

const IdParam = new ParseUUIDPipe();

abstract class SafetyController {
  protected abstract readonly side: 'BUYER' | 'SELLER';
  constructor(@Inject(SafetyService) protected readonly safety: SafetyService) {}

  @Post('comments/:id/report')
  @HttpCode(201)
  async reportComment(@Auth() who: AccessClaims, @Param('id', IdParam) id: string, @Body(new ZodPipe(ReportInputSchema)) body: ReportInput): Promise<ReportReceipt> {
    return ReportReceiptSchema.parse(await this.safety.reportComment(who.userId, id, body));
  }

  @Post('threads/:id/messages/:messageId/report')
  @HttpCode(201)
  async reportMessage(@Auth() who: AccessClaims, @Param('id', IdParam) id: string, @Param('messageId', IdParam) messageId: string, @Body(new ZodPipe(ReportInputSchema)) body: ReportInput): Promise<ReportReceipt> {
    return ReportReceiptSchema.parse(await this.safety.reportMessage(who.userId, this.side, id, messageId, body));
  }

  @Get('blocks')
  async blocks(@Auth() who: AccessClaims): Promise<BlockedList> {
    return BlockedListSchema.parse(await this.safety.list(who.userId));
  }

  @Put('blocks')
  @HttpCode(200)
  async block(@Auth() who: AccessClaims, @Body(new ZodPipe(BlockInputSchema)) body: BlockInput): Promise<BlockedPerson> {
    return BlockedPersonSchema.parse(await this.safety.block(who.userId, this.side, body));
  }

  @Delete('blocks/:id')
  @HttpCode(204)
  async unblock(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<void> {
    await this.safety.unblock(who.userId, id);
  }
}

@Controller('buyer')
@UseGuards(AuthGuard)
@Audience('buyer')
export class BuyerSafetyController extends SafetyController {
  protected readonly side = 'BUYER' as const;
}

@Controller('seller')
@UseGuards(AuthGuard)
@Audience('seller')
export class SellerSafetyController extends SafetyController {
  protected readonly side = 'SELLER' as const;
}
