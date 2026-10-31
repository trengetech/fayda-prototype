import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { MediaIntentInputSchema, type Media, type MediaIntent, type MediaIntentInput } from '@fayda/contracts';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { MediaService } from './media.service.js';

/** The seller's side of an upload: ask for an address, upload to it, then say it is done. */
@Controller('seller/media')
@UseGuards(AuthGuard)
@Audience('seller')
export class MediaController {
  constructor(@Inject(MediaService) private readonly media: MediaService) {}

  @Post('intents')
  @HttpCode(201)
  intent(@Auth() who: AccessClaims, @Body(new ZodPipe(MediaIntentInputSchema)) body: MediaIntentInput): Promise<MediaIntent> {
    return this.media.createIntent(who.userId, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@Auth() who: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string): Promise<Media> {
    return this.media.complete(who.userId, id);
  }
}
