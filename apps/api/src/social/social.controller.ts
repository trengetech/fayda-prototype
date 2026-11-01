import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  CommentListSchema,
  CommentQuerySchema,
  CommentSchema,
  LikeStateSchema,
  PostCommentSchema,
  SaveStateSchema,
  BuyerFeedSchema,
  z,
  type BuyerFeed,
  type Comment,
  type CommentList,
  type CommentQuery,
  type LikeState,
  type PostComment,
  type SaveState,
} from '@fayda/contracts';
import type { Clock } from '@fayda/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import { CLOCK } from '../common/clock.js';
import { IdempotencyService } from '../common/idempotency.service.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { IdempotentController } from '../negotiations/negotiations.controller.js';
import { SocialService } from './social.service.js';

const IdParam = new ParseUUIDPipe();
const SavedQuery = z.object({ cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(50).optional() });

/**
 * Likes, saves and comments in the buyer app. Like and save are repeat-safe (PUT and DELETE); a comment post takes an
 * Idempotency-Key header and a `clientKey`, so a retry after a lost reply cannot post twice.
 */
@Controller('buyer')
@UseGuards(AuthGuard)
@Audience('buyer')
export class BuyerSocialController extends IdempotentController {
  constructor(
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(IdempotencyService) idempotency: IdempotencyService,
    @Inject(CLOCK) clock: Clock,
  ) {
    super(idempotency, clock);
  }

  /** The product page was opened. Never fails the page: unknown, paused and own listings are quietly not counted. */
  @Post('listings/:id/view')
  @HttpCode(204)
  async view(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<void> {
    await this.social.recordView(who.userId, id);
  }

  @Put('listings/:id/like')
  async like(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<LikeState> {
    return LikeStateSchema.parse(await this.social.like(who.userId, id));
  }

  @Delete('listings/:id/like')
  async unlike(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<LikeState> {
    return LikeStateSchema.parse(await this.social.unlike(who.userId, id));
  }

  @Put('listings/:id/save')
  async save(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<SaveState> {
    return SaveStateSchema.parse(await this.social.save(who.userId, id));
  }

  @Delete('listings/:id/save')
  async unsave(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<SaveState> {
    return SaveStateSchema.parse(await this.social.unsave(who.userId, id));
  }

  /** The listings this buyer saved, newest save first. Private: only the buyer reads it. */
  @Get('saved')
  async saved(@Auth() who: AccessClaims, @Query(new ZodPipe(SavedQuery)) q: { cursor?: string; limit?: number }): Promise<BuyerFeed> {
    return BuyerFeedSchema.parse(await this.social.listSaved(who.userId, q.cursor, q.limit));
  }

  @Get('listings/:id/comments')
  async comments(@Auth() who: AccessClaims, @Param('id', IdParam) id: string, @Query(new ZodPipe(CommentQuerySchema)) q: CommentQuery): Promise<CommentList> {
    return CommentListSchema.parse(await this.social.comments(who.userId, id, false, q.cursor, q.limit));
  }

  @Post('listings/:id/comments')
  async post(
    @Auth() who: AccessClaims,
    @Param('id', IdParam) id: string,
    @Body(new ZodPipe(PostCommentSchema)) body: PostComment,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Comment> {
    return this.write(who, req, reply, key, body, 201, async () => CommentSchema.parse(await this.social.post(who.userId, id, body, false)));
  }

  /** Take back a comment of mine. A comment on someone else's listing that is not mine is "not found". */
  @Delete('comments/:id')
  @HttpCode(204)
  async remove(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<void> {
    await this.social.remove(who.userId, id);
  }
}

/** The seller's side: read the comments on their own listing, reply as the shop, and remove any comment on it. */
@Controller('seller')
@UseGuards(AuthGuard)
@Audience('seller')
export class SellerSocialController extends IdempotentController {
  constructor(
    @Inject(SocialService) private readonly social: SocialService,
    @Inject(IdempotencyService) idempotency: IdempotencyService,
    @Inject(CLOCK) clock: Clock,
  ) {
    super(idempotency, clock);
  }

  @Get('listings/:id/comments')
  async comments(@Auth() who: AccessClaims, @Param('id', IdParam) id: string, @Query(new ZodPipe(CommentQuerySchema)) q: CommentQuery): Promise<CommentList> {
    return CommentListSchema.parse(await this.social.comments(who.userId, id, true, q.cursor, q.limit));
  }

  @Post('listings/:id/comments')
  async reply(
    @Auth() who: AccessClaims,
    @Param('id', IdParam) id: string,
    @Body(new ZodPipe(PostCommentSchema)) body: PostComment,
    @Headers('idempotency-key') key: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<Comment> {
    return this.write(who, req, reply, key, body, 201, async () => CommentSchema.parse(await this.social.post(who.userId, id, body, true)));
  }

  @Delete('comments/:id')
  @HttpCode(204)
  async remove(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<void> {
    await this.social.remove(who.userId, id);
  }
}
