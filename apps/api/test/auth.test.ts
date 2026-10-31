import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SignJWT } from 'jose';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dbOf, startApp } from './helpers.js';

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '1000' });
});
afterEach(async () => {
  await dbOf(app).db.execute(sql`truncate table users cascade`);
});
afterAll(async () => {
  await app.close();
});

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = async (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, opts: { token?: string; body?: unknown } = {}) => {
  const res = await app.inject({ method, url, headers: opts.token ? { authorization: `Bearer ${opts.token}` } : {}, ...(opts.body !== undefined ? { payload: opts.body as object } : {}) });
  return { status: res.statusCode, body: (res.body ? JSON.parse(res.body) : null) as Json, type: String(res.headers['content-type']) };
};
const signIn = async (phone: string, appName: 'buyer' | 'seller', code = '123456') => call('POST', '/v1/auth/otp/verify', { body: { phone, code, app: appName } });

const address = { name: 'K R', line1: '7', line2: 'Miyapur', pin: '500049', city: 'Hyderabad', state: 'Telangana' };
const buyerInput = { name: 'Kiran', address, contact: { phone: '9700012345' }, agreementAccepted: true };
const shopInput = {
  sellerType: 'INDIVIDUAL',
  name: 'Sana Studio',
  handle: 'sanastudio',
  area: 'Tolichowki',
  categories: ['Ethnic wear'],
  mapsUrl: 'https://maps.app.goo.gl/abc',
  contact: { whatsapp: '9000099998' },
  sla: { confirmHours: 6, shipDays: 2 },
};

describe('sign-in', () => {
  it('rejects bad phone numbers and says the code is simulated', async () => {
    expect((await call('POST', '/v1/auth/otp/request', { body: { phone: '12345', app: 'buyer' } })).body.code).toBe('VALIDATION');
    expect((await call('POST', '/v1/auth/otp/request', { body: { phone: '1234567890', app: 'buyer' } })).body.code).toBe('INVALID_PHONE');
    const ok = await call('POST', '/v1/auth/otp/request', { body: { phone: '+91 98765 43210', app: 'buyer' } });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ sent: true, simulated: true });
  });

  it('rejects a wrong code, and locks the number after 5 wrong tries', async () => {
    const bad = await signIn('9876500001', 'buyer', '000000');
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_OTP');
    expect(bad.type).toContain('application/problem+json');
    for (let i = 0; i < 4; i++) await signIn('9876500001', 'buyer', '000000');
    const locked = await signIn('9876500001', 'buyer', '123456');
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('RATE_LIMITED');
  });

  it('signs in with the dev code; a new buyer must still complete the profile', async () => {
    const r = await signIn('9876500002', 'buyer');
    expect(r.status).toBe(200);
    expect(r.body.user.phone).toBe('9876500002');
    expect(r.body.expiresInSeconds).toBe(900);
    expect(r.body.profile.complete).toBe(false);
    expect([...r.body.profile.missing].sort()).toEqual(['address', 'agreement', 'contact', 'name']);
  });

  it('gives one user in both apps, with a separate session each', async () => {
    const b = await signIn('9876500003', 'buyer');
    const s = await signIn('9876500003', 'seller');
    expect(s.body.user.id).toBe(b.body.user.id);
    expect(s.body.accessToken).not.toBe(b.body.accessToken);
    expect(s.body.profile.missing).toEqual(['shop', 'payment', 'conduct']);
    const [{ n }] = (await dbOf(app).db.execute(sql`select count(*)::int as n from users where phone = '9876500003'`)) as unknown as [{ n: number }];
    expect(n).toBe(1);
  });
});

describe('tokens and audiences', () => {
  it('needs a valid bearer token', async () => {
    expect((await call('GET', '/v1/me')).status).toBe(401);
    expect((await call('GET', '/v1/me', { token: 'garbage' })).status).toBe(401);
    const { body } = await signIn('9876500004', 'buyer');
    expect((await call('GET', '/v1/me', { token: body.accessToken.slice(0, -3) + 'abc' })).status).toBe(401);
    const me = await call('GET', '/v1/me', { token: body.accessToken });
    expect(me.status).toBe(200);
    expect(me.body.app).toBe('buyer');
  });

  it('rejects an expired token', async () => {
    const { body } = await signIn('9876500005', 'buyer');
    const key = new TextEncoder().encode(process.env.JWT_SECRET);
    const past = Math.floor(Date.now() / 1000) - 3600;
    const claims = JSON.parse(Buffer.from(body.accessToken.split('.')[1], 'base64url').toString());
    const old = await new SignJWT({ app: 'buyer', sid: claims.sid }).setProtectedHeader({ alg: 'HS256' }).setSubject(claims.sub).setIssuer('fayda-api').setAudience('fayda-buyer').setIssuedAt(past - 900).setExpirationTime(past).sign(key);
    expect((await call('GET', '/v1/me', { token: old })).status).toBe(401);
  });

  it('keeps each app out of the other’s routes', async () => {
    const b = await signIn('9876500006', 'buyer');
    const s = await signIn('9876500006', 'seller');
    const wrong = await call('GET', '/v1/seller/profile', { token: b.body.accessToken });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe('WRONG_APP');
    expect((await call('GET', '/v1/buyer/profile', { token: s.body.accessToken })).body.code).toBe('WRONG_APP');
  });

  it('rotates the refresh token, and revokes the session if an old one is replayed', async () => {
    const first = await signIn('9876500007', 'buyer');
    const second = await call('POST', '/v1/auth/refresh', { body: { refreshToken: first.body.refreshToken } });
    expect(second.status).toBe(200);
    expect(second.body.refreshToken).not.toBe(first.body.refreshToken);
    expect((await call('GET', '/v1/me', { token: second.body.accessToken })).status).toBe(200);
    // Replaying the first token means it was copied: the whole session ends.
    expect((await call('POST', '/v1/auth/refresh', { body: { refreshToken: first.body.refreshToken } })).status).toBe(401);
    expect((await call('POST', '/v1/auth/refresh', { body: { refreshToken: second.body.refreshToken } })).status).toBe(401);
    expect((await call('GET', '/v1/me', { token: second.body.accessToken })).status).toBe(401);
  });

  it('logout ends the session at once; the other app stays signed in', async () => {
    const b = await signIn('9876500008', 'buyer');
    const s = await signIn('9876500008', 'seller');
    expect((await call('POST', '/v1/auth/logout', { token: b.body.accessToken })).status).toBe(204);
    expect((await call('GET', '/v1/me', { token: b.body.accessToken })).status).toBe(401);
    expect((await call('POST', '/v1/auth/refresh', { body: { refreshToken: b.body.refreshToken } })).status).toBe(401);
    expect((await call('GET', '/v1/me', { token: s.body.accessToken })).status).toBe(200);
  });
});

describe('buyer profile', () => {
  it('refuses a profile without the agreement or a contact number', async () => {
    const { body } = await signIn('9876500009', 'buyer');
    const r = await call('PUT', '/v1/buyer/profile', { token: body.accessToken, body: { name: 'Kiran', address, contact: {}, agreementAccepted: false } });
    expect(r.status).toBe(400);
    expect(r.body.fields.agreement).toBeTruthy();
    expect(r.body.fields.contact).toBeTruthy();
    const bad = await call('PUT', '/v1/buyer/profile', { token: body.accessToken, body: { ...buyerInput, address: { ...address, pin: '1' }, name: 'K' } });
    expect(bad.body.fields['address.pin'] && bad.body.fields.name).toBeTruthy();
  });

  it('saves the profile, records the agreement, and completes sign-up', async () => {
    const { body } = await signIn('9876500010', 'buyer');
    const r = await call('PUT', '/v1/buyer/profile', { token: body.accessToken, body: buyerInput });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Kiran', missing: [], agreementVersion: 'draft-2026-10', contact: { phone: '9700012345', whatsapp: null } });
    expect(r.body.addresses).toHaveLength(1);
    expect((await call('GET', '/v1/me', { token: body.accessToken })).body.profile).toEqual({ complete: true, missing: [] });
    // Saving again updates the same address, and keeps the first agreement time.
    const again = await call('PUT', '/v1/buyer/profile', { token: body.accessToken, body: { ...buyerInput, address: { ...address, line1: '9' } } });
    expect(again.body.addresses).toHaveLength(1);
    expect(again.body.addresses[0].line1).toBe('9');
    expect(again.body.agreementAcceptedAt).toBe(r.body.agreementAcceptedAt);
  });

  it('changes the contact number after sign-up, and needs a profile first', async () => {
    const { body } = await signIn('9876500011', 'buyer');
    expect((await call('PATCH', '/v1/buyer/profile/contact', { token: body.accessToken, body: { contact: { whatsapp: '9700012345' } } })).body.code).toBe('NO_PROFILE');
    await call('PUT', '/v1/buyer/profile', { token: body.accessToken, body: buyerInput });
    const r = await call('PATCH', '/v1/buyer/profile/contact', { token: body.accessToken, body: { contact: { whatsapp: '9700099999' } } });
    expect(r.body.contact).toEqual({ phone: null, whatsapp: '9700099999' });
    expect((await call('PATCH', '/v1/buyer/profile/contact', { token: body.accessToken, body: { contact: {} } })).status).toBe(400);
  });

  it('asks an older account for the new fields instead of locking it out', async () => {
    const { body } = await signIn('9876500012', 'buyer');
    await dbOf(app).db.execute(sql`insert into buyer_profiles (user_id) values (${body.user.id}::uuid)`);
    const me = await call('GET', '/v1/me', { token: body.accessToken });
    expect(me.status).toBe(200);
    expect(me.body.profile.missing).toEqual(expect.arrayContaining(['contact', 'agreement']));
    expect((await call('PUT', '/v1/buyer/profile', { token: body.accessToken, body: buyerInput })).body.missing).toEqual([]);
  });
});

describe('seller onboarding', () => {
  it('rejects a shop with no category, bad links, no contact or no declared times', async () => {
    const { body } = await signIn('9876500020', 'seller');
    const r = await call('PUT', '/v1/seller/profile', { token: body.accessToken, body: { sellerType: 'INDIVIDUAL', name: 'Shop', handle: 'shop', area: 'Tolichowki', categories: [], mapsUrl: 'https://example.com', socialUrl: 'https://twitter.com/x', contact: {}, sla: { confirmHours: 3, shipDays: 4 } } });
    expect(r.status).toBe(400);
    for (const k of ['categories', 'mapsUrl', 'socialUrl', 'contact', 'confirmHours', 'shipDays']) expect(r.body.fields[k], k).toBeTruthy();
  });

  it('is complete only after shop, payment and the Code of Conduct', async () => {
    const { body } = await signIn('9876500021', 'seller');
    const t = body.accessToken;
    expect((await call('GET', '/v1/seller/profile', { token: t })).status).toBe(404);
    expect((await call('PUT', '/v1/seller/payment', { token: t, body: { upiId: 'sana@okaxis', conductAccepted: true } })).body.code).toBe('NO_SELLER');

    const shop = await call('PUT', '/v1/seller/profile', { token: t, body: shopInput });
    expect(shop.status).toBe(200);
    expect(shop.body.missing).toEqual(['payment', 'conduct']);
    expect((await call('GET', '/v1/me', { token: t })).body.profile.complete).toBe(false);

    const noConduct = await call('PUT', '/v1/seller/payment', { token: t, body: { upiId: 'sana@okaxis', conductAccepted: false } });
    expect(noConduct.body.fields.conduct).toBeTruthy();
    const noPay = await call('PUT', '/v1/seller/payment', { token: t, body: { conductAccepted: true } });
    expect(noPay.body.fields.payment).toBeTruthy();
    const badUpi = await call('PUT', '/v1/seller/payment', { token: t, body: { upiId: 'nope', conductAccepted: true } });
    expect(badUpi.body.fields.upiId).toBeTruthy();

    const done = await call('PUT', '/v1/seller/payment', { token: t, body: { upiId: 'sana@okaxis', conductAccepted: true } });
    expect(done.status).toBe(200);
    expect(done.body.missing).toEqual([]);
    expect(done.body.payment.upiId).toBe('sana@okaxis');
    expect((await call('GET', '/v1/me', { token: t })).body.profile).toEqual({ complete: true, missing: [] });
  });

  it('keeps handles unique, and lets a seller keep their own handle when editing', async () => {
    const a = await signIn('9876500022', 'seller');
    const b = await signIn('9876500023', 'seller');
    expect((await call('PUT', '/v1/seller/profile', { token: a.body.accessToken, body: shopInput })).status).toBe(200);
    const clash = await call('PUT', '/v1/seller/profile', { token: b.body.accessToken, body: { ...shopInput, handle: 'SanaStudio' } });
    expect(clash.status).toBe(400);
    expect(clash.body.fields.handle).toBe('That handle is taken.');
    const edit = await call('PUT', '/v1/seller/profile', { token: a.body.accessToken, body: { ...shopInput, bio: 'New bio' } });
    expect(edit.status).toBe(200);
    expect(edit.body.bio).toBe('New bio');
  });

  it('does not let two sign-ups claim one handle at the same moment', async () => {
    const a = await signIn('9876500024', 'seller');
    const b = await signIn('9876500025', 'seller');
    const [x, y] = await Promise.all([
      call('PUT', '/v1/seller/profile', { token: a.body.accessToken, body: { ...shopInput, handle: 'racehandle' } }),
      call('PUT', '/v1/seller/profile', { token: b.body.accessToken, body: { ...shopInput, handle: 'racehandle' } }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 400]);
  });
});

describe('rate limiting', () => {
  it('limits sign-in attempts per client address with a problem+json 429', async () => {
    const limited = await startApp({ AUTH_RATE_LIMIT_PER_MIN: '3' });
    try {
      const hit = () => limited.inject({ method: 'POST', url: '/v1/auth/otp/request', payload: { phone: '9876500030', app: 'buyer' } });
      for (let i = 0; i < 3; i++) expect((await hit()).statusCode).toBe(200);
      const res = await hit();
      expect(res.statusCode).toBe(429);
      expect(String(res.headers['content-type'])).toContain('application/problem+json');
      expect(JSON.parse(res.body).code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
