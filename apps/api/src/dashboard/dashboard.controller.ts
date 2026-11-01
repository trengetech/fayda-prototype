import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { SellerDashboardSchema, type SellerDashboard } from '@fayda/contracts';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import { DashboardService } from './dashboard.service.js';

@Controller('seller/dashboard')
@UseGuards(AuthGuard)
@Audience('seller')
export class SellerDashboardController {
  constructor(@Inject(DashboardService) private readonly svc: DashboardService) {}

  @Get()
  async get(@Auth() who: AccessClaims): Promise<SellerDashboard> {
    return SellerDashboardSchema.parse(await this.svc.forSeller(who.userId));
  }
}
