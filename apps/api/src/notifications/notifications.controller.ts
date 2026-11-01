import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { NotificationCategorySchema, NotificationListSchema, NotificationQuerySchema, NotificationSettingInputSchema, NotificationSettingsSchema, PushTokenInputSchema, UnreadCountSchema, type NotificationCategory, type NotificationList, type NotificationQuery, type NotificationSettingInput, type NotificationSettings, type PushTokenInput, type UnreadCount } from '@fayda/contracts';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { NotificationsService } from './notifications.service.js';

const IdParam = new ParseUUIDPipe();

/** One controller body for both apps: the audience decides which app's notifications a person reads. */
abstract class NotificationsController {
  protected abstract readonly app: 'buyer' | 'seller';
  constructor(@Inject(NotificationsService) protected readonly svc: NotificationsService) {}

  @Get()
  async list(@Auth() who: AccessClaims, @Query(new ZodPipe(NotificationQuerySchema)) q: NotificationQuery): Promise<NotificationList> {
    return NotificationListSchema.parse(await this.svc.list(who.userId, this.app, q.cursor, q.limit));
  }

  @Get('unread-count')
  async unread(@Auth() who: AccessClaims): Promise<UnreadCount> {
    return UnreadCountSchema.parse(await this.svc.unread(who.userId, this.app));
  }

  @Post('read-all')
  @HttpCode(200)
  async readAll(@Auth() who: AccessClaims): Promise<UnreadCount> {
    return UnreadCountSchema.parse(await this.svc.markAllRead(who.userId, this.app));
  }

  @Get('settings')
  async settings(@Auth() who: AccessClaims): Promise<NotificationSettings> {
    return NotificationSettingsSchema.parse(await this.svc.settings(who.userId, this.app));
  }

  @Put('settings/:category')
  async setSetting(@Auth() who: AccessClaims, @Param('category', new ZodPipe(NotificationCategorySchema)) category: NotificationCategory, @Body(new ZodPipe(NotificationSettingInputSchema)) body: NotificationSettingInput): Promise<NotificationSettings> {
    return NotificationSettingsSchema.parse(await this.svc.setSetting(who.userId, this.app, category, body));
  }

  @Delete()
  async clear(@Auth() who: AccessClaims): Promise<UnreadCount> {
    return UnreadCountSchema.parse(await this.svc.removeAll(who.userId, this.app));
  }

  @Delete(':id')
  async delete(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<UnreadCount> {
    return UnreadCountSchema.parse(await this.svc.remove(who.userId, this.app, id));
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<UnreadCount> {
    return UnreadCountSchema.parse(await this.svc.markRead(who.userId, this.app, id));
  }
}

@Controller('buyer/notifications')
@UseGuards(AuthGuard)
@Audience('buyer')
export class BuyerNotificationsController extends NotificationsController {
  protected readonly app = 'buyer' as const;
}

@Controller('seller/notifications')
@UseGuards(AuthGuard)
@Audience('seller')
export class SellerNotificationsController extends NotificationsController {
  protected readonly app = 'seller' as const;
}

abstract class PushTokenController {
  protected abstract readonly app: 'buyer' | 'seller';
  constructor(@Inject(NotificationsService) protected readonly svc: NotificationsService) {}

  @Put()
  @HttpCode(204)
  async put(@Auth() who: AccessClaims, @Body(new ZodPipe(PushTokenInputSchema)) body: PushTokenInput): Promise<void> {
    await this.svc.registerToken(who.userId, this.app, body);
  }

  @Delete()
  @HttpCode(204)
  async remove(@Auth() who: AccessClaims, @Body(new ZodPipe(PushTokenInputSchema)) body: PushTokenInput): Promise<void> {
    await this.svc.removeToken(who.userId, this.app, body.token);
  }
}

@Controller('buyer/push-token')
@UseGuards(AuthGuard)
@Audience('buyer')
export class BuyerPushTokenController extends PushTokenController {
  protected readonly app = 'buyer' as const;
}

@Controller('seller/push-token')
@UseGuards(AuthGuard)
@Audience('seller')
export class SellerPushTokenController extends PushTokenController {
  protected readonly app = 'seller' as const;
}
