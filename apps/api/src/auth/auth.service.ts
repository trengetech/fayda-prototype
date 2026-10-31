import { Inject, Injectable } from '@nestjs/common';
import type { AppAudience, AuthResult, Me, OtpRequested, User } from '@fayda/contracts';
import { isValidIndianMobile, normalizePhone, type Clock } from '@fayda/domain';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { AppError } from '../common/app-error.js';
import { CLOCK } from '../common/clock.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DbService } from '../db/db.service.js';
import { sessions, users } from '../db/schema.js';
import { ProfileService } from '../profiles/profile.service.js';
import { AUTH_VERIFIER, type AuthVerifier } from './auth-verifier.js';
import { TokenService } from './token.service.js';

const MAX_WRONG_CODES = 5;
const LOCK_MS = 5 * 60_000;

@Injectable()
export class AuthService {
  /** Wrong-code counts per phone number. In memory, which is enough for one API process; move to the database before running two. */
  private readonly wrong = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    @Inject(DbService) private readonly database: DbService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(ProfileService) private readonly profiles: ProfileService,
    @Inject(AUTH_VERIFIER) private readonly verifier: AuthVerifier,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db() {
    return this.database.db;
  }

  private phone(raw: string): string {
    const p = normalizePhone(raw);
    if (!isValidIndianMobile(p)) throw new AppError(400, 'INVALID_PHONE', 'Enter a valid 10-digit mobile number.', { phone: 'Enter a valid 10-digit mobile number.' });
    return p;
  }

  async requestOtp(rawPhone: string): Promise<OtpRequested> {
    const phone = this.phone(rawPhone);
    await this.verifier.start(phone);
    return { sent: true, simulated: this.verifier.simulated };
  }

  async verifyOtp(rawPhone: string, code: string, app: AppAudience): Promise<AuthResult> {
    const phone = this.phone(rawPhone);
    const now = this.clock.now();
    const state = this.wrong.get(phone);
    if (state && state.lockedUntil > now) throw new AppError(429, 'RATE_LIMITED', 'Too many wrong codes. Try again in a few minutes.');
    if (!(await this.verifier.verify(phone, code.trim()))) {
      const count = (state && state.lockedUntil <= now && state.count < MAX_WRONG_CODES ? state.count : 0) + 1;
      this.wrong.set(phone, { count, lockedUntil: count >= MAX_WRONG_CODES ? now + LOCK_MS : 0 });
      throw new AppError(400, 'INVALID_OTP', 'That code isn’t right.', { code: 'That code isn’t right.' });
    }
    this.wrong.delete(phone);

    // Same number, same user, in both apps. The unique index settles two first sign-ins at once.
    await this.db.insert(users).values({ phone }).onConflictDoNothing({ target: users.phone });
    const [user] = await this.db.select().from(users).where(eq(users.phone, phone)).limit(1);
    if (!user) throw new Error('user missing after upsert');
    return this.startSession(user, app);
  }

  private async startSession(user: typeof users.$inferSelect, app: AppAudience): Promise<AuthResult> {
    const refresh = this.tokens.newRefreshToken();
    const expiresAt = new Date(this.clock.now() + this.config.refreshTtlDays * 86_400_000);
    const [session] = await this.db.insert(sessions).values({ userId: user.id, app, refreshHash: refresh.hash, expiresAt, createdAt: new Date(this.clock.now()), lastUsedAt: new Date(this.clock.now()) }).returning({ id: sessions.id });
    if (!session) throw new Error('session not created');
    return this.result(user, app, session.id, refresh.token);
  }

  private async result(user: typeof users.$inferSelect, app: AppAudience, sessionId: string, refreshToken: string): Promise<AuthResult> {
    return {
      accessToken: await this.tokens.signAccess({ userId: user.id, app, sessionId }),
      refreshToken,
      expiresInSeconds: this.config.accessTtlSeconds,
      user: this.userView(user),
      app,
      profile: await this.profiles.status(user.id, app),
    };
  }

  private userView(u: typeof users.$inferSelect): User {
    return { id: u.id, phone: u.phone, name: u.name };
  }

  /** Swaps a refresh token for a new pair. The old token stops working; presenting it again revokes the whole session. */
  async refresh(refreshToken: string): Promise<AuthResult> {
    const hash = this.tokens.hashRefresh(refreshToken);
    const now = new Date(this.clock.now());
    const next = this.tokens.newRefreshToken();
    const [rotated] = await this.db
      .update(sessions)
      .set({ refreshHash: next.hash, previousRefreshHash: hash, lastUsedAt: now })
      .where(and(eq(sessions.refreshHash, hash), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
      .returning();
    if (!rotated) {
      await this.db.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.previousRefreshHash, hash), isNull(sessions.revokedAt)));
      throw new AppError(401, 'UNAUTHENTICATED', 'Your session has ended. Sign in again.');
    }
    const [user] = await this.db.select().from(users).where(eq(users.id, rotated.userId)).limit(1);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Your session has ended. Sign in again.');
    return this.result(user, rotated.app, rotated.id, next.token);
  }

  async logout(sessionId: string): Promise<void> {
    await this.db.update(sessions).set({ revokedAt: new Date(this.clock.now()) }).where(and(eq(sessions.id, sessionId), or(isNull(sessions.revokedAt))));
  }

  async me(userId: string, app: AppAudience): Promise<Me> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Your session has ended. Sign in again.');
    return { user: this.userView(user), app, profile: await this.profiles.status(userId, app) };
  }
}
