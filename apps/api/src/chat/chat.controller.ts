import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Res, UseGuards } from '@nestjs/common';
import { ChatThreadListSchema, ChatThreadSchema, SendMessageSchema, type ChatThread, type ChatThreadList, type SendMessage } from '@fayda/contracts';
import { Audience, Auth, AuthGuard } from '../auth/auth.guard.js';
import type { AccessClaims } from '../auth/token.service.js';
import type { FastifyReply } from 'fastify';
import { ZodPipe } from '../common/zod-pipe.js';
import { ChatService } from './chat.service.js';

const IdParam = new ParseUUIDPipe();

/** Chats, as the buyer sees them. A person only ever reaches threads they are part of. */
@Controller('buyer/threads')
@UseGuards(AuthGuard)
@Audience('buyer')
export class BuyerChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  @Get()
  async list(@Auth() who: AccessClaims): Promise<ChatThreadList> {
    return ChatThreadListSchema.parse(await this.chat.list(who.userId, 'BUYER'));
  }

  /** A photo sent in a chat: members of that chat only (I-19). Private, never cached by shared caches. */
  @Get('photos/:mediaId')
  async photo(@Auth() who: AccessClaims, @Param('mediaId', IdParam) mediaId: string, @Res() reply: FastifyReply): Promise<FastifyReply> {
    const f = await this.chat.photo(who.userId, 'BUYER', mediaId);
    return reply.header('content-type', f.mime).header('content-length', f.size).header('cache-control', 'private, max-age=3600').send(f.stream);
  }

  @Get(':id')
  async get(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<ChatThread> {
    return ChatThreadSchema.parse(await this.chat.get(who.userId, 'BUYER', id));
  }

  @Post(':id/messages')
  @HttpCode(201)
  async send(@Auth() who: AccessClaims, @Param('id', IdParam) id: string, @Body(new ZodPipe(SendMessageSchema)) body: SendMessage): Promise<ChatThread> {
    return ChatThreadSchema.parse(await this.chat.send(who.userId, 'BUYER', id, body));
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<ChatThread> {
    return ChatThreadSchema.parse(await this.chat.markRead(who.userId, 'BUYER', id));
  }
}

@Controller('seller/threads')
@UseGuards(AuthGuard)
@Audience('seller')
export class SellerChatController {
  constructor(@Inject(ChatService) private readonly chat: ChatService) {}

  @Get()
  async list(@Auth() who: AccessClaims): Promise<ChatThreadList> {
    return ChatThreadListSchema.parse(await this.chat.list(who.userId, 'SELLER'));
  }

  /** A photo sent in a chat: members of that chat only (I-19). Private, never cached by shared caches. */
  @Get('photos/:mediaId')
  async photo(@Auth() who: AccessClaims, @Param('mediaId', IdParam) mediaId: string, @Res() reply: FastifyReply): Promise<FastifyReply> {
    const f = await this.chat.photo(who.userId, 'SELLER', mediaId);
    return reply.header('content-type', f.mime).header('content-length', f.size).header('cache-control', 'private, max-age=3600').send(f.stream);
  }

  @Get(':id')
  async get(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<ChatThread> {
    return ChatThreadSchema.parse(await this.chat.get(who.userId, 'SELLER', id));
  }

  @Post(':id/messages')
  @HttpCode(201)
  async send(@Auth() who: AccessClaims, @Param('id', IdParam) id: string, @Body(new ZodPipe(SendMessageSchema)) body: SendMessage): Promise<ChatThread> {
    return ChatThreadSchema.parse(await this.chat.send(who.userId, 'SELLER', id, body));
  }

  @Post(':id/read')
  @HttpCode(200)
  async read(@Auth() who: AccessClaims, @Param('id', IdParam) id: string): Promise<ChatThread> {
    return ChatThreadSchema.parse(await this.chat.markRead(who.userId, 'SELLER', id));
  }
}
