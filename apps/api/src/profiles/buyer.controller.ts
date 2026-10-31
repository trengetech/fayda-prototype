import { Body, Controller, Get, Inject, Patch, Put, UseGuards } from '@nestjs/common';
import { BuyerContactUpdateSchema, BuyerProfileInputSchema, BuyerProfileSchema, type BuyerProfile, type BuyerProfileInput } from '@fayda/contracts';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { ProfileService } from './profile.service.js';

@Controller('buyer')
@UseGuards(AuthGuard)
@Audience('buyer')
export class BuyerController {
  constructor(@Inject(ProfileService) private readonly profiles: ProfileService) {}

  @Get('profile')
  async get(@Auth() who: AccessClaims): Promise<BuyerProfile> {
    return BuyerProfileSchema.parse(await this.profiles.getBuyer(who.userId));
  }

  @Put('profile')
  async save(@Auth() who: AccessClaims, @Body(new ZodPipe(BuyerProfileInputSchema)) body: BuyerProfileInput): Promise<BuyerProfile> {
    return BuyerProfileSchema.parse(await this.profiles.saveBuyer(who.userId, body));
  }

  @Patch('profile/contact')
  async contact(@Auth() who: AccessClaims, @Body(new ZodPipe(BuyerContactUpdateSchema)) body: { contact: { phone?: string | null; whatsapp?: string | null } }): Promise<BuyerProfile> {
    return BuyerProfileSchema.parse(await this.profiles.updateBuyerContact(who.userId, body.contact));
  }
}
