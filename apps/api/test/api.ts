import type { NestFastifyApplication } from '@nestjs/platform-fastify';

export type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Calls the API in-process and parses a JSON response. */
export const makeCaller = (app: NestFastifyApplication) =>
  async (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, opts: { token?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const res = await app.inject({
      method,
      url,
      headers: { ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
      ...(opts.body !== undefined ? { payload: opts.body as object } : {}),
    });
    return { status: res.statusCode, body: (res.body && res.headers['content-type']?.toString().includes('json') ? JSON.parse(res.body) : null) as Json, headers: res.headers, raw: res.rawPayload };
  };
export type Caller = ReturnType<typeof makeCaller>;

export const shopInput = {
  sellerType: 'INDIVIDUAL',
  name: 'Sana Studio',
  handle: 'sanastudio',
  area: 'Tolichowki',
  categories: ['Ethnic wear'],
  mapsUrl: 'https://maps.app.goo.gl/abc',
  contact: { whatsapp: '9000099998' },
  sla: { confirmHours: 6, shipDays: 2 },
};

/** Signs a phone number in to one app and returns its access token. */
export async function signIn(call: Caller, phone: string, app: 'buyer' | 'seller'): Promise<string> {
  const r = await call('POST', '/v1/auth/otp/verify', { body: { phone, code: '123456', app } });
  return r.body.accessToken as string;
}

/** A seller with a finished shop and a UPI payment profile. */
export async function makeSeller(call: Caller, phone: string, handle = 'sanastudio', upiId = 'sana@okaxis'): Promise<string> {
  const token = await signIn(call, phone, 'seller');
  await call('PUT', '/v1/seller/profile', { token, body: { ...shopInput, handle } });
  const pay = await call('PUT', '/v1/seller/payment', { token, body: { upiId, conductAccepted: true } });
  if (pay.status !== 200) throw new Error(`seller setup failed: ${JSON.stringify(pay.body)}`);
  return token;
}

export const JPEG = (extra = 100): Buffer => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(extra, 7)]);
export const PNG = (extra = 100): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(extra, 9)]);
export const MP4 = (extra = 200): Buffer => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(extra, 5)]);

/** Runs a whole upload (intent, PUT, complete) and returns the finished media row. */
export async function uploadFile(call: Caller, token: string, file: Buffer, opts: { kind?: 'image' | 'video'; purpose?: 'LISTING' | 'UPI_QR'; mime?: string } = {}): Promise<Json> {
  const kind = opts.kind ?? 'image';
  const mime = opts.mime ?? (kind === 'image' ? 'image/jpeg' : 'video/mp4');
  const intent = await call('POST', '/v1/seller/media/intents', { token, body: { kind, purpose: opts.purpose ?? 'LISTING', mime, size: file.length } });
  if (intent.status !== 201) throw new Error(`intent failed: ${JSON.stringify(intent.body)}`);
  const put = await call('PUT', intent.body.upload.url, { headers: intent.body.upload.headers, body: file });
  if (put.status !== 204) throw new Error(`upload failed: ${put.status} ${JSON.stringify(put.body)}`);
  const done = await call('POST', `/v1/seller/media/${intent.body.mediaId}/complete`, { token });
  if (done.status !== 200) throw new Error(`complete failed: ${JSON.stringify(done.body)}`);
  return done.body;
}
