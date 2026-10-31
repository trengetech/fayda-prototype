import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { JPEG, PNG, makeCaller, makeSeller, uploadFile, type Caller } from './api.js';
import { dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
let call: Caller;
let dir: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'fayda-qr-'));
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

const qr = (pa: string) => `upi://pay?pa=${pa}&pn=Sana%20Studio&cu=INR`;
const pay = (token: string, over: Record<string, unknown>) => call('PUT', '/v1/seller/payment', { token, body: { upiId: 'sana@okaxis', conductAccepted: true, ...over } });

describe('UPI QR on the payment profile', () => {
  it('saves a QR whose payee matches the UPI ID, and keeps it private', async () => {
    const t = await makeSeller(call, '9876500301');
    const m = await uploadFile(call, t, PNG(), { purpose: 'UPI_QR', mime: 'image/png' });
    const ok = await pay(t, { upiQrMediaId: m.id, upiQrPayload: qr('Sana@OkAxis') });
    expect(ok.status).toBe(200);
    expect(ok.body.payment.upiQrMediaId).toBe(m.id);
    // The saved QR must not make the profile look incomplete (its decoded text is not stored).
    expect(ok.body.missing).toEqual([]);
    const me = await call('GET', '/v1/me', { token: t });
    expect(me.body.profile).toEqual({ complete: true, missing: [] });
    expect((await call('GET', `/v1/media/${m.id}`)).status).toBe(404); // not public
    // Saving again without the QR removes it: the payment details are replaced as a whole.
    expect((await pay(t, {})).body.payment.upiQrMediaId).toBeNull();
  });

  it('refuses a QR for a different UPI ID, a non-UPI QR, and a missing decoded text', async () => {
    const t = await makeSeller(call, '9876500302');
    const m = await uploadFile(call, t, PNG(), { purpose: 'UPI_QR', mime: 'image/png' });
    expect((await pay(t, { upiQrMediaId: m.id, upiQrPayload: qr('someone@okicici') })).body.fields.upiQr).toMatch(/belongs to someone@okicici/);
    expect((await pay(t, { upiQrMediaId: m.id, upiQrPayload: 'https://example.com' })).body.fields.upiQr).toMatch(/not a UPI payment QR/);
    expect((await pay(t, { upiQrMediaId: m.id })).body.fields.upiQr).toBeDefined();
  });

  it('accepts only the seller’s own finished QR upload', async () => {
    const a = await makeSeller(call, '9876500303');
    const b = await makeSeller(call, '9876500304', 'otherstudio', 'other@okaxis');
    const theirs = await uploadFile(call, b, PNG(), { purpose: 'UPI_QR', mime: 'image/png' });
    const listingPhoto = await uploadFile(call, a, JPEG());
    const pending = (await call('POST', '/v1/seller/media/intents', { token: a, body: { kind: 'image', purpose: 'UPI_QR', mime: 'image/png', size: 100 } })).body.mediaId;
    expect((await pay(a, { upiQrMediaId: theirs.id, upiQrPayload: qr('sana@okaxis') })).status).toBe(400);
    expect((await pay(a, { upiQrMediaId: listingPhoto.id, upiQrPayload: qr('sana@okaxis') })).status).toBe(400);
    expect((await pay(a, { upiQrMediaId: pending, upiQrPayload: qr('sana@okaxis') })).body.code).toBe('MEDIA_NOT_READY');
  });
});
