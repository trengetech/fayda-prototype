import { Module, type DynamicModule } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { systemClock, type Clock } from '@fayda/domain';
import { AUTH_VERIFIER, DevOtpVerifier } from './auth/auth-verifier.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { TokenService } from './auth/token.service.js';
import { BuyerController } from './profiles/buyer.controller.js';
import { ProfileService } from './profiles/profile.service.js';
import { SellerController } from './profiles/seller.controller.js';
import { CLOCK } from './common/clock.js';
import { BuyerCatalogController, SellerListingsController } from './listings/listings.controller.js';
import { ListingsService } from './listings/listings.service.js';
import { BuyerDiscoveryController } from './discovery/discovery.controller.js';
import { DiscoveryService } from './discovery/discovery.service.js';
import { FollowsService } from './discovery/follows.service.js';
import { BuyerSocialController, SellerSocialController } from './social/social.controller.js';
import { SocialService } from './social/social.service.js';
import { BuyerNegotiationsController, SellerNegotiationsController } from './negotiations/negotiations.controller.js';
import { BuyerOrdersController, PublicShopsController, SellerOrdersController } from './orders/orders.controller.js';
import { OrdersService } from './orders/orders.service.js';
import { NegotiationEvents } from './negotiations/negotiation-events.js';
import { NegotiationsGateway } from './negotiations/negotiations.gateway.js';
import { NegotiationsService } from './negotiations/negotiations.service.js';
import { BuyerMediaController, MediaController } from './media/media.controller.js';
import { DiskMediaStorage, MEDIA_STORAGE } from './media/media-storage.js';
import { MediaService } from './media/media.service.js';
import { ChatService } from './chat/chat.service.js';
import { BuyerChatController, SellerChatController } from './chat/chat.controller.js';
import { BuyerReviewsController, SellerReviewsController, ShopReviewsController } from './reviews/reviews.controller.js';
import { ReviewsService } from './reviews/reviews.service.js';
import { BuyerRequestsController, SellerRequestsController } from './requests/requests.controller.js';
import { RequestsService } from './requests/requests.service.js';
import { IdempotencyService } from './common/idempotency.service.js';
import { APP_CONFIG, type AppConfig } from './config.js';
import { DbService } from './db/db.service.js';
import { SweepRunner } from './scheduler/sweep-runner.js';
import { SystemController } from './system/system.controller.js';

@Module({})
export class AppModule {
  static register(config: AppConfig, clock: Clock = systemClock): DynamicModule {
    return {
      module: AppModule,
      imports: [ScheduleModule.forRoot()],
      controllers: [SystemController, AuthController, BuyerController, SellerController, MediaController, BuyerMediaController, SellerListingsController, BuyerCatalogController, BuyerDiscoveryController, BuyerSocialController, SellerSocialController, BuyerNegotiationsController, SellerNegotiationsController, BuyerOrdersController, SellerOrdersController, PublicShopsController, BuyerChatController, SellerChatController, BuyerReviewsController, SellerReviewsController, ShopReviewsController, BuyerRequestsController, SellerRequestsController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: CLOCK, useValue: clock },
        DbService,
        IdempotencyService,
        SweepRunner,
        TokenService,
        ProfileService,
        { provide: MEDIA_STORAGE, useFactory: () => new DiskMediaStorage(config.uploadsDir) },
        MediaService,
        ListingsService,
        DiscoveryService,
        FollowsService,
        SocialService,
        NegotiationEvents,
        NegotiationsService,
        ChatService,
        ReviewsService,
        RequestsService,
        OrdersService,
        NegotiationsGateway,
        AuthService,
        AuthGuard,
        { provide: AUTH_VERIFIER, useClass: DevOtpVerifier },
      ],
      exports: [DbService, IdempotencyService, SweepRunner, CLOCK, APP_CONFIG, MediaService, NegotiationsService, NegotiationEvents, ChatService, ReviewsService, RequestsService, OrdersService],
    };
  }
}
