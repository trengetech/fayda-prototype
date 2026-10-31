import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { PaymentInputSchema, SellerProfileSchema, SellerShopInputSchema, type PaymentInput, type SellerProfile, type SellerShopInput } from '@fayda/contracts';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { ProfileService } from './profile.service.js';

@Controller('seller')
@UseGuards(AuthGuard)
@Audience('seller')
export class SellerController {
  constructor(@Inject(ProfileService) private readonly profiles: ProfileService) {}

  @Get('profile')
  async get(@Auth() who: AccessClaims): Promise<SellerProfile> {
    return SellerProfileSchema.parse(await this.profiles.getSeller(who.userId));
  }

  @Put('profile')
  async saveShop(@Auth() who: AccessClaims, @Body(new ZodPipe(SellerShopInputSchema)) body: SellerShopInput): Promise<SellerProfile> {
    return SellerProfileSchema.parse(await this.profiles.saveShop(who.userId, body));
  }

  @Put('payment')
  async savePayment(@Auth() who: AccessClaims, @Body(new ZodPipe(PaymentInputSchema)) body: PaymentInput): Promise<SellerProfile> {
    return SellerProfileSchema.parse(await this.profiles.savePayment(who.userId, body));
  }
}
