import { Inject, Injectable, SetMetadata, createParamDecorator, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AppAudience } from '@fayda/contracts';
import type { Clock } from '@fayda/domain';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { DbService } from '../db/db.service.js';
import { sessions } from '../db/schema.js';
import { TokenService, type AccessClaims } from './token.service.js';

const AUDIENCE_KEY = 'audience';
/** Restricts a controller or route to one app's sessions. A buyer token can never reach /v1/seller/*, and the reverse. */
export const Audience = (app: AppAudience) => SetMetadata(AUDIENCE_KEY, app);

type AuthedRequest = FastifyRequest & { auth?: AccessClaims };

/** The signed-in caller, set by AuthGuard. */
export const Auth = createParamDecorator((_data: unknown, ctx: ExecutionContext): AccessClaims => {
  const auth = ctx.switchToHttp().getRequest<AuthedRequest>().auth;
  if (!auth) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in first.');
  return auth;
});

/** Checks the bearer token, then that its session is still live (so logout and revoked sessions take effect at once). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const claims = token ? await this.tokens.verifyAccess(token) : null;
    if (!claims) throw new AppError(401, 'UNAUTHENTICATED', 'Sign in first.');

    const now = new Date(this.clock.now());
    const live = await this.database.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, claims.sessionId), eq(sessions.userId, claims.userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
      .limit(1);
    if (!live.length) throw new AppError(401, 'UNAUTHENTICATED', 'Your session has ended. Sign in again.');

    const wanted = this.reflector.getAllAndOverride<AppAudience | undefined>(AUDIENCE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (wanted && wanted !== claims.app) throw new AppError(403, 'WRONG_APP', `This is a ${wanted} route. Sign in to the ${wanted} app.`);
    req.auth = claims;
    return true;
  }
}
