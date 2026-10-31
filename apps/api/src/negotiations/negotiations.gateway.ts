import { Inject, Logger, type OnModuleDestroy } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, type OnGatewayConnection, type OnGatewayInit } from '@nestjs/websockets';
import type { NegotiationEventPayload } from '@fayda/contracts';
import type { Clock } from '@fayda/domain';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Server, Socket } from 'socket.io';
import { TokenService, type AccessClaims } from '../auth/token.service.js';
import { CLOCK } from '../common/clock.js';
import { DbService } from '../db/db.service.js';
import { sessions } from '../db/schema.js';
import { NegotiationEvents, type NegotiationTouch } from './negotiation-events.js';

export const NEGOTIATION_EVENT = 'negotiation.updated';
/** One room per person per app, so a phone signed in to both apps only hears what is meant for each. */
export const roomFor = (app: 'buyer' | 'seller', userId: string): string => `${app}:${userId}`;

type AuthedSocket = Socket & { data: { claims?: AccessClaims } };

/**
 * Real-time updates (decision: events carry ids, clients refetch). A client connects with its access token, is put in its
 * own room, and hears `negotiation.updated` with `{ negotiationId, listingId }` whenever a negotiation it is part of
 * changes. Nothing else travels over the socket: no amounts, no names, no rules.
 */
@WebSocketGateway({ cors: false })
export class NegotiationsGateway implements OnGatewayInit, OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private readonly log = new Logger('Realtime');
  private unsubscribe: (() => void) | null = null;
  private unsubscribeEvents: (() => void) | null = null;

  constructor(
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(DbService) private readonly database: DbService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NegotiationEvents) private readonly events: NegotiationEvents,
  ) {}

  afterInit(server: Server): void {
    // Same checks as the HTTP guard: a valid token, and a session that has not been ended.
    server.use((socket, next) => {
      void this.authenticate(socket as AuthedSocket).then(
        (ok) => (ok ? next() : next(new Error('UNAUTHENTICATED'))),
        () => next(new Error('UNAUTHENTICATED')),
      );
    });
    this.unsubscribe = this.events.subscribe((touches) => this.fanOut(touches));
    this.unsubscribeEvents = this.events.subscribeEvents((events) => {
      if (!this.server) return;
      for (const e of events) {
        if (e.buyerUserId) this.server.to(roomFor('buyer', e.buyerUserId)).emit(e.name, e.payload);
        if (e.sellerUserId) this.server.to(roomFor('seller', e.sellerUserId)).emit(e.name, e.payload);
      }
    });
  }

  handleConnection(socket: AuthedSocket): void {
    const c = socket.data.claims;
    if (c) void socket.join(roomFor(c.app, c.userId));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribeEvents?.();
  }

  private async authenticate(socket: AuthedSocket): Promise<boolean> {
    const raw = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const token = typeof raw === 'string' ? raw : '';
    const claims = token ? await this.tokens.verifyAccess(token) : null;
    if (!claims) return false;
    const [live] = await this.database.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.id, claims.sessionId), eq(sessions.userId, claims.userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date(this.clock.now()))))
      .limit(1);
    if (!live) return false;
    socket.data.claims = claims;
    return true;
  }

  private fanOut(touches: NegotiationTouch[]): void {
    if (!this.server) return;
    for (const t of touches) {
      const payload: NegotiationEventPayload = { negotiationId: t.negotiationId, listingId: t.listingId };
      this.server.to(roomFor('buyer', t.buyerUserId)).emit(NEGOTIATION_EVENT, payload);
      this.server.to(roomFor('seller', t.sellerUserId)).emit(NEGOTIATION_EVENT, payload);
    }
    this.log.debug(`told ${touches.length} negotiation change(s)`);
  }
}
