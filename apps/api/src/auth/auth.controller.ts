import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from '@nestjs/common';
import {
  AuthResultSchema,
  MeSchema,
  OtpRequestSchema,
  OtpRequestedSchema,
  OtpVerifySchema,
  RefreshSchema,
  type AuthResult,
  type Me,
  type OtpRequest,
  type OtpRequested,
  type OtpVerify,
  type Refresh,
} from '@fayda/contracts';
import { ZodPipe } from '../common/zod-pipe.js';
import { Auth, AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import type { AccessClaims } from './token.service.js';

@Controller()
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post('auth/otp/request')
  @HttpCode(200)
  async request(@Body(new ZodPipe(OtpRequestSchema)) body: OtpRequest): Promise<OtpRequested> {
    return OtpRequestedSchema.parse(await this.auth.requestOtp(body.phone));
  }

  @Post('auth/otp/verify')
  @HttpCode(200)
  async verify(@Body(new ZodPipe(OtpVerifySchema)) body: OtpVerify): Promise<AuthResult> {
    return AuthResultSchema.parse(await this.auth.verifyOtp(body.phone, body.code, body.app));
  }

  @Post('auth/refresh')
  @HttpCode(200)
  async refresh(@Body(new ZodPipe(RefreshSchema)) body: Refresh): Promise<AuthResult> {
    return AuthResultSchema.parse(await this.auth.refresh(body.refreshToken));
  }

  @Post('auth/logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(@Auth() who: AccessClaims): Promise<void> {
    await this.auth.logout(who.sessionId);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Auth() who: AccessClaims): Promise<Me> {
    return MeSchema.parse(await this.auth.me(who.userId, who.app));
  }
}
