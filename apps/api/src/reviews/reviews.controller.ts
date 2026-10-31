import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { PutReviewSchema, ReviewViewSchema, ShopReviewListSchema, type PutReview, type ReviewView, type ShopReviewList } from '@fayda/contracts';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import { ZodPipe } from '../common/zod-pipe.js';
import { ReviewsService } from './reviews.service.js';

@Controller('buyer/orders')
@UseGuards(AuthGuard)
@Audience('buyer')
export class BuyerReviewsController {
  constructor(@Inject(ReviewsService) private readonly reviews: ReviewsService) {}

  /** One review per order; saving again edits it. */
  @Put(':id/review')
  @HttpCode(200)
  async put(@Auth() who: AccessClaims, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodPipe(PutReviewSchema)) body: PutReview): Promise<ReviewView> {
    return ReviewViewSchema.parse(await this.reviews.put(who.userId, id, body));
  }
}

@Controller('seller/reviews')
@UseGuards(AuthGuard)
@Audience('seller')
export class SellerReviewsController {
  constructor(@Inject(ReviewsService) private readonly reviews: ReviewsService) {}

  @Get()
  async list(@Auth() who: AccessClaims): Promise<ShopReviewList> {
    return ShopReviewListSchema.parse(await this.reviews.forSeller(who.userId));
  }
}

/** Public: anyone can read a shop's reviews. */
@Controller('shops')
export class ShopReviewsController {
  constructor(@Inject(ReviewsService) private readonly reviews: ReviewsService) {}

  @Get(':id/reviews')
  async list(@Param('id', new ParseUUIDPipe()) id: string): Promise<ShopReviewList> {
    return ShopReviewListSchema.parse(await this.reviews.forShop(id));
  }
}
