import { Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { RULES } from '@fayda/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError } from '../common/app-error.js';
import { toProblem } from '../common/problem.filter.js';
import { MediaService } from './media.service.js';

const log = new Logger('Media');

const fail = (reply: FastifyReply, err: unknown): FastifyReply => {
  const { status, body } = toProblem(err, log);
  return reply.code(status).header('content-type', 'application/problem+json').send(body);
};

/** `bytes=a-b`, `bytes=a-` or `bytes=-n` against a file of `size` bytes; null when it cannot be satisfied. */
export function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start: number;
  let end: number;
  if (m[1] === '') {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start <= end && start < size ? { start, end } : null;
}

/**
 * The two disk-adapter routes that stream raw bytes, so they bypass Nest's JSON handling:
 * PUT /v1/media/upload/:id (one-time token, no sign-in) and GET /v1/media/:id (public listing files, with Range
 * support so video players can seek). They live in their own plugin so the raw body parser stays local to them.
 */
export async function registerMediaRoutes(app: NestFastifyApplication): Promise<void> {
  const media = app.get(MediaService);
  await app.register(async (scope: FastifyInstance) => {
    scope.addContentTypeParser('*', (_req, payload, done) => done(null, payload));
    scope.setErrorHandler((err, _req, reply) => {
      // A body-size refusal from Fastify itself is a client error, not a server fault.
      const code = (err as { statusCode?: number }).statusCode;
      void fail(reply, code === 413 ? new AppError(400, 'UPLOAD_MISMATCH', 'The file is larger than allowed.') : err);
    });

    scope.put('/v1/media/upload/:id', { bodyLimit: RULES.MAX_VIDEO_BYTES + 1024 }, async (req: FastifyRequest<{ Params: { id: string }; Querystring: { token?: string } }>, reply) => {
      const length = req.headers['content-length'];
      await media.receiveUpload(req.params.id, req.query.token ?? '', req.headers['content-type'], length === undefined ? undefined : Number(length), req.body as import('node:stream').Readable);
      return reply.code(204).send();
    });

    scope.get('/v1/media/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const file = await media.publicFile(req.params.id);
      if (!file) throw new AppError(404, 'NOT_FOUND', 'File not found.');
      // The id is unguessable and the content never changes, so browsers and players may keep it.
      reply.header('content-type', file.mime).header('accept-ranges', 'bytes').header('cache-control', 'public, max-age=31536000, immutable');
      const wanted = req.headers.range;
      if (wanted) {
        const range = parseRange(wanted, file.size);
        if (!range) return reply.code(416).header('content-range', `bytes */${file.size}`).send();
        return reply
          .code(206)
          .header('content-range', `bytes ${range.start}-${range.end}/${file.size}`)
          .header('content-length', range.end - range.start + 1)
          .send(media.openFile(file.storageKey, range));
      }
      return reply.header('content-length', file.size).send(media.openFile(file.storageKey));
    });
  });
}
