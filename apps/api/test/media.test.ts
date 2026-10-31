import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq, sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { media } from '../src/db/schema.js';
import { MAX_PENDING_PER_USER, MediaService } from '../src/media/media.service.js';
import { JPEG, MP4, PNG, makeCaller, makeSeller, signIn, uploadFile, type Caller } from './api.js';
import { dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
let call: Caller;
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-media-'));
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '1000', UPLOADS_DIR: dir });
  call = makeCaller(app);
});
afterEach(async () => {
  await dbOf(app).db.execute(sql`truncate table users cascade`);
});
afterAll(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const intentBody = (over: Record<string, unknown> = {}) => ({ kind: 'image', purpose: 'LISTING', mime: 'image/jpeg', size: 104, ...over });

describe('upload intents', () => {
  it('are for sellers with a shop only', async () => {
    const buyer = await signIn(call, '9876500101', 'buyer');
    expect((await call('POST', '/v1/seller/media/intents', { token: buyer, body: intentBody() })).body.code).toBe('WRONG_APP');
    const noShop = await signIn(call, '9876500102', 'seller');
    expect((await call('POST', '/v1/seller/media/intents', { token: noShop, body: intentBody() })).body.code).toBe('NO_SELLER');
    expect((await call('POST', '/v1/seller/media/intents', { body: intentBody() })).status).toBe(401);
  });

  it('refuse bad types, sizes and video QR codes before anything is stored', async () => {
    const t = await makeSeller(call, '9876500103');
    const bad = async (over: Record<string, unknown>) => (await call('POST', '/v1/seller/media/intents', { token: t, body: intentBody(over) })).body;
    expect((await bad({ mime: 'application/pdf' })).fields.mime).toBeDefined();
    expect((await bad({ size: 15_000_001 })).fields.size).toMatch(/15 MB/);
    expect((await bad({ kind: 'video', mime: 'video/mp4', size: 80_000_001 })).fields.size).toMatch(/80 MB/);
    expect((await bad({ kind: 'video', mime: 'video/mp4', size: 1000, durationSec: 90 })).fields.durationSec).toMatch(/60 seconds/);
    expect((await bad({ kind: 'video', purpose: 'UPI_QR', mime: 'video/mp4', size: 1000 })).fields.kind).toMatch(/photo/);
    expect(await dbOf(app).db.select().from(media)).toHaveLength(0);
  });

  it('cap how many unfinished uploads one seller can hold', async () => {
    const t = await makeSeller(call, '9876500104');
    for (let i = 0; i < MAX_PENDING_PER_USER; i++) expect((await call('POST', '/v1/seller/media/intents', { token: t, body: intentBody() })).status).toBe(201);
    const over = await call('POST', '/v1/seller/media/intents', { token: t, body: intentBody() });
    expect(over.status).toBe(429);
  });
});

describe('uploading and downloading', () => {
  it('stores a photo, marks it ready and serves it publicly with caching headers', async () => {
    const t = await makeSeller(call, '9876500105');
    const file = JPEG(500);
    const m = await uploadFile(call, t, file);
    expect(m).toMatchObject({ kind: 'image', purpose: 'LISTING', status: 'READY', size: file.length });
    expect(m.url).toBe(`/v1/media/${m.id}`);
    const got = await call('GET', m.url); // no sign-in needed
    expect(got.status).toBe(200);
    expect(got.headers['content-type']).toBe('image/jpeg');
    expect(got.headers['cache-control']).toContain('immutable');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(got.raw, file)).toBe(0);
  });

  it('supports byte ranges, so video can seek, and refuses impossible ones', async () => {
    const t = await makeSeller(call, '9876500106');
    const file = MP4(1000);
    const m = await uploadFile(call, t, file, { kind: 'video' });
    const part = await call('GET', m.url, { headers: { range: 'bytes=10-19' } });
    expect(part.status).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 10-19/${file.length}`);
    expect(Buffer.compare(part.raw, file.subarray(10, 20))).toBe(0);
    const tail = await call('GET', m.url, { headers: { range: 'bytes=-8' } });
    expect(Buffer.compare(tail.raw, file.subarray(file.length - 8))).toBe(0);
    expect((await call('GET', m.url, { headers: { range: `bytes=${file.length + 5}-` } })).status).toBe(416);
  });

  it('keeps a UPI QR private', async () => {
    const t = await makeSeller(call, '9876500107');
    const qr = await uploadFile(call, t, PNG(), { purpose: 'UPI_QR', mime: 'image/png' });
    expect(qr.status).toBe('READY');
    expect(qr.url).toBeNull();
    expect((await call('GET', `/v1/media/${qr.id}`)).status).toBe(404);
  });

  it('rejects a wrong or reused upload address, a wrong type and a wrong size', async () => {
    const t = await makeSeller(call, '9876500108');
    const file = JPEG();
    const intent = await call('POST', '/v1/seller/media/intents', { token: t, body: intentBody({ size: file.length }) });
    const { url, headers } = intent.body.upload;
    expect((await call('PUT', url.replace(/token=.*/, 'token=wrong'), { headers, body: file })).status).toBe(401);
    expect((await call('PUT', url, { headers: { 'content-type': 'image/png' }, body: file })).body.code).toBe('VALIDATION');
    expect((await call('PUT', url, { headers, body: Buffer.concat([file, Buffer.from('x')]) })).body.code).toBe('UPLOAD_MISMATCH');
    expect((await call('PUT', url, { headers, body: file })).status).toBe(204);
    expect((await call('PUT', url, { headers, body: file })).status).toBe(401); // the address works once
  });

  it('refuses an expired address', async () => {
    const t = await makeSeller(call, '9876500109');
    const intent = await call('POST', '/v1/seller/media/intents', { token: t, body: intentBody() });
    await dbOf(app).db.update(media).set({ uploadExpiresAt: new Date(Date.now() - 1000) }).where(eq(media.id, intent.body.mediaId));
    const r = await call('PUT', intent.body.upload.url, { headers: intent.body.upload.headers, body: JPEG() });
    expect(r.status).toBe(410);
    expect(r.body.code).toBe('UPLOAD_EXPIRED');
  });
});

describe('completing an upload', () => {
  it('needs the file to have arrived, and belongs to its owner', async () => {
    const a = await makeSeller(call, '9876500110');
    const b = await makeSeller(call, '9876500111', 'other', 'other@okaxis');
    const intent = await call('POST', '/v1/seller/media/intents', { token: a, body: intentBody() });
    expect((await call('POST', `/v1/seller/media/${intent.body.mediaId}/complete`, { token: a })).body.code).toBe('MEDIA_NOT_READY');
    expect((await call('POST', `/v1/seller/media/${intent.body.mediaId}/complete`, { token: b })).status).toBe(404);
    expect((await call('POST', '/v1/seller/media/not-a-uuid/complete', { token: a })).status).toBe(400);
  });

  it('throws away a file whose content is not the declared type', async () => {
    const t = await makeSeller(call, '9876500112');
    const fake = Buffer.from('<script>alert(1)</script>'.padEnd(120, ' '));
    const intent = await call('POST', '/v1/seller/media/intents', { token: t, body: intentBody({ size: fake.length }) });
    expect((await call('PUT', intent.body.upload.url, { headers: intent.body.upload.headers, body: fake })).status).toBe(204);
    const done = await call('POST', `/v1/seller/media/${intent.body.mediaId}/complete`, { token: t });
    expect(done.status).toBe(400);
    expect(done.body.fields.file).toMatch(/not a valid photo/);
    expect(await dbOf(app).db.select().from(media)).toHaveLength(0);
  });

  it('is safe to call twice', async () => {
    const t = await makeSeller(call, '9876500113');
    const m = await uploadFile(call, t, JPEG());
    expect((await call('POST', `/v1/seller/media/${m.id}/complete`, { token: t })).body.status).toBe('READY');
  });
});

describe('housekeeping', () => {
  it('removes stale unfinished uploads and unused finished files, but keeps recent ones', async () => {
    const t = await makeSeller(call, '9876500114');
    const keep = await uploadFile(call, t, JPEG());
    const pending = await call('POST', '/v1/seller/media/intents', { token: t, body: intentBody() });
    const service = app.get(MediaService);
    expect(await service.run(Date.now())).toBe(0); // nothing is old yet
    const later = Date.now() + 25 * 3_600_000;
    // Run it again 25 hours on: the unfinished upload and the never-attached photo are both gone.
    (service as unknown as { lastPurge: number }).lastPurge = 0;
    expect(await service.run(later)).toBe(2);
    const left = await dbOf(app).db.select().from(media);
    expect(left).toHaveLength(0);
    expect((await call('GET', keep.url)).status).toBe(404);
    expect(pending.status).toBe(201);
  });
});
