import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AddressInputSchema, BuyerContactUpdateSchema, NewAddressSchema, type AddressInput, type NewAddress, BuyerProfileInputSchema, BuyerProfileSchema, type BuyerProfile, type BuyerProfileInput } from '@fayda/contracts';
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

  // ---------- delivery addresses ----------
  @Post('addresses')
  @HttpCode(201)
  async addAddress(@Auth() who: AccessClaims, @Body(new ZodPipe(NewAddressSchema)) body: NewAddress): Promise<BuyerProfile> {
    return BuyerProfileSchema.parse(await this.profiles.addAddress(who.userId, body));
  }

  @Put('addresses/:id')
  async updateAddress(@Auth() who: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(AddressInputSchema)) body: AddressInput): Promise<BuyerProfile> {
    return BuyerProfileSchema.parse(await this.profiles.updateAddress(who.userId, id, body));
  }

  @Delete('addresses/:id')
  async deleteAddress(@Auth() who: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string): Promise<BuyerProfile> {
    return BuyerProfileSchema.parse(await this.profiles.deleteAddress(who.userId, id));
  }

  @Post('addresses/:id/default')
  @HttpCode(200)
  async defaultAddress(@Auth() who: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string): Promise<BuyerProfile> {
    return BuyerProfileSchema.parse(await this.profiles.setDefaultAddress(who.userId, id));
  }
}
