import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Clock } from '@fayda/domain';
import type { AppAudience } from '@fayda/contracts';
import { SignJWT, jwtVerify } from 'jose';
import { CLOCK } from '../common/clock.js';
import { APP_CONFIG, type AppConfig } from '../config.js';

const ISSUER = 'fayda-api';

export interface AccessClaims {
  userId: string;
  app: AppAudience;
  sessionId: string;
}

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.key = new TextEncoder().encode(config.jwtSecret);
  }

  async signAccess(c: AccessClaims): Promise<string> {
    const iat = Math.floor(this.clock.now() / 1000);
    return new SignJWT({ app: c.app, sid: c.sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(c.userId)
      .setIssuer(ISSUER)
      .setAudience(`fayda-${c.app}`)
      .setIssuedAt(iat)
      .setExpirationTime(iat + this.config.accessTtlSeconds)
      .sign(this.key);
  }

  /** Returns the claims, or null for anything wrong: bad signature, expired, wrong issuer, malformed. */
  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'], issuer: ISSUER, currentDate: new Date(this.clock.now()) });
      const app = payload.app;
      if ((app !== 'buyer' && app !== 'seller') || payload.aud !== `fayda-${app}` || typeof payload.sid !== 'string' || typeof payload.sub !== 'string') return null;
      return { userId: payload.sub, app, sessionId: payload.sid };
    } catch {
      return null;
    }
  }

  newRefreshToken(): { token: string; hash: string } {
    const token = randomBytes(32).toString('base64url');
    return { token, hash: this.hashRefresh(token) };
  }

  hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
