import { describe, expect, it } from 'vitest';
import { upiPayeeFromQr, validateMediaIntent, validatePayment, validateUpiQr } from '../src/index.js';

const qr = (pa: string) => `upi://pay?pa=${pa}&pn=Test%20Shop&cu=INR`;

describe('UPI QR check', () => {
  it('reads the payee address, ignoring case and extra fields', () => {
    expect(upiPayeeFromQr(qr('Shop@OkICICI'))).toBe('shop@okicici');
    expect(upiPayeeFromQr('UPI://pay?pn=x&pa=a@b')).toBe('a@b');
  });

  it('rejects text that is not a UPI payment link', () => {
    expect(upiPayeeFromQr('https://example.com?pa=a@b')).toBeNull();
    expect(upiPayeeFromQr('upi://pay?pn=NoPayee')).toBeNull();
    expect(upiPayeeFromQr(null)).toBeNull();
    expect(validateUpiQr('shop@okicici', 'hello')).toMatch(/not a UPI payment QR/);
  });

  it('accepts a matching QR and refuses a different payee', () => {
    expect(validateUpiQr('Shop@okicici', qr('shop@okicici'))).toBeNull();
    expect(validateUpiQr('shop@okicici', qr('other@okaxis'))).toMatch(/belongs to other@okaxis/);
  });

  it('needs a UPI ID to check against', () => {
    expect(validateUpiQr('', qr('shop@okicici'))).toMatch(/Enter your UPI ID/);
  });

  it('is part of payment validation only when a QR is attached', () => {
    const ok = { upiId: 'shop@okicici', upiQrMediaId: 'm1', upiQrPayload: qr('shop@okicici') };
    expect(validatePayment(ok).errors).toEqual({});
    expect(validatePayment({ ...ok, upiQrPayload: qr('x@okaxis') }).errors.upiQr).toMatch(/belongs to/);
    expect(validatePayment({ ...ok, upiQrPayload: undefined }).errors.upiQr).toMatch(/not a UPI payment QR/);
    expect(validatePayment({ upiId: 'shop@okicici' }).errors).toEqual({});
  });

  it('can re-check a saved profile, whose QR text is no longer known', () => {
    const saved = { upiId: 'shop@okicici', upiQrMediaId: 'm1' };
    expect(validatePayment(saved).errors.upiQr).toBeDefined();
    expect(validatePayment(saved, { skipQrCheck: true }).errors).toEqual({});
    expect(validatePayment({ upiQrMediaId: 'm1' }, { skipQrCheck: true }).errors).toEqual({}); // a QR alone still counts as a way to pay
  });
});

describe('media upload intent', () => {
  const photo = { kind: 'image', purpose: 'LISTING', mime: 'image/jpeg', size: 2_000_000 };
  it('accepts a normal photo and a normal reel', () => {
    expect(validateMediaIntent(photo)).toEqual({});
    expect(validateMediaIntent({ kind: 'video', purpose: 'LISTING', mime: 'video/mp4', size: 40_000_000, durationSec: 45 })).toEqual({});
  });
  it('enforces the size caps from I-13', () => {
    expect(validateMediaIntent({ ...photo, size: 15_000_001 }).size).toMatch(/15 MB/);
    expect(validateMediaIntent({ kind: 'video', purpose: 'LISTING', mime: 'video/mp4', size: 80_000_001 }).size).toMatch(/80 MB/);
    expect(validateMediaIntent({ ...photo, size: 0 }).size).toMatch(/empty/);
  });
  it('rejects wrong types, long reels and video QR codes', () => {
    expect(validateMediaIntent({ ...photo, mime: 'application/pdf' }).mime).toMatch(/JPEG/);
    expect(validateMediaIntent({ kind: 'video', purpose: 'LISTING', mime: 'video/mp4', size: 1000, durationSec: 75 }).durationSec).toMatch(/60 seconds/);
    expect(validateMediaIntent({ kind: 'video', purpose: 'UPI_QR', mime: 'video/mp4', size: 1000 }).kind).toMatch(/photo/);
    expect(validateMediaIntent({ ...photo, purpose: 'AVATAR' }).purpose).toBeDefined();
  });
});
