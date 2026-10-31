import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { eq } from 'drizzle-orm';
import type { Clock } from '@fayda/domain';
import { CLOCK } from '../src/common/clock.js';
import { ChatService } from '../src/chat/chat.service.js';
import { listings, orders, sellers, users } from '../src/db/schema.js';
import { JPEG, MP4, shopInput, signIn, type Caller, type Json } from './api.js';
import { dbOf } from './helpers.js';

export const rupees = (n: number) => n * 100;
export const address = { name: 'K R', line1: '7', line2: 'Miyapur', pin: '500049', city: 'Hyderabad', state: 'Telangana' };

/** A buyer with a finished profile. */
export async function makeBuyer(call: Caller, phone: string, name = 'Asha Rao', contact: { phone?: string; whatsapp?: string } = { phone: '9700012345' }): Promise<string> {
  const token = await signIn(call, phone, 'buyer');
  const r = await call('PUT', '/v1/buyer/profile', { token, body: { name, address, contact, agreementAccepted: true } });
  if (r.status !== 200) throw new Error(`buyer setup failed: ${JSON.stringify(r.body)}`);
  return token;
}

/** A seller with a finished shop (given categories) and a UPI profile. */
export async function makeShop(call: Caller, phone: string, handle: string, categories: string[] = ['Ethnic wear'], contact: Json = { whatsapp: '9000099998' }): Promise<string> {
  const token = await signIn(call, phone, 'seller');
  const a = await call('PUT', '/v1/seller/profile', { token, body: { ...shopInput, handle, name: `Shop ${handle}`, categories, contact } });
  if (a.status !== 200) throw new Error(`shop failed: ${JSON.stringify(a.body)}`);
  const pay = await call('PUT', '/v1/seller/payment', { token, body: { upiId: `${handle}@okaxis`, conductAccepted: true } });
  if (pay.status !== 200) throw new Error(`payment failed: ${JSON.stringify(pay.body)}`);
  return token;
}

export type Purpose = 'LISTING' | 'UPI_QR' | 'REVIEW' | 'REQUEST' | 'CHAT';
/** A whole upload (intent, PUT, complete) in either app. Returns the media row. */
export async function upload(call: Caller, token: string, app: 'buyer' | 'seller', purpose: Purpose, opts: { kind?: 'image' | 'video'; file?: Buffer } = {}): Promise<Json> {
  const kind = opts.kind ?? 'image';
  const file = opts.file ?? (kind === 'image' ? JPEG() : MP4());
  const mime = kind === 'image' ? 'image/jpeg' : 'video/mp4';
  const intent = await call('POST', `/v1/${app}/media/intents`, { token, body: { kind, purpose, mime, size: file.length } });
  if (intent.status !== 201) throw new Error(`intent failed: ${JSON.stringify(intent.body)}`);
  const put = await call('PUT', intent.body.upload.url, { headers: intent.body.upload.headers, body: file });
  if (put.status !== 204) throw new Error(`upload failed: ${put.status}`);
  const done = await call('POST', `/v1/${app}/media/${intent.body.mediaId}/complete`, { token });
  if (done.status !== 200) throw new Error(`complete failed: ${JSON.stringify(done.body)}`);
  return done.body;
}

/** A live ₹1,500 listing (size M) for a seller. */
export async function makeListing(call: Caller, seller: string, over: Json = {}): Promise<{ id: string; variantId: string }> {
  const m = await upload(call, seller, 'seller', 'LISTING');
  const l = await call('POST', '/v1/seller/listings', {
    token: seller,
    body: { title: 'Cotton kurta', category: 'Ethnic wear', price: rupees(1500), media: [{ mediaId: m.id }], variants: [{ label: 'M', stock: 3 }], bargaining: { mode: 'BOTH', expiryMinutes: 1440 }, checkout: { channel: 'DIRECT' }, publish: true, ...over },
  });
  if (l.status !== 201) throw new Error(`listing failed: ${JSON.stringify(l.body)}`);
  return { id: l.body.id, variantId: l.body.variants[0].id };
}

export async function userId(app: NestFastifyApplication, phone: string): Promise<string> {
  const [u] = await dbOf(app).db.select({ id: users.id }).from(users).where(eq(users.phone, phone)).limit(1);
  return u!.id;
}
export async function sellerIdOf(app: NestFastifyApplication, phone: string): Promise<string> {
  const [s] = await dbOf(app)
    .db.select({ id: sellers.id })
    .from(sellers)
    .innerJoin(users, eq(users.id, sellers.userId))
    .where(eq(users.phone, phone))
    .limit(1);
  return s!.id;
}

/**
 * Inserts an order straight into the database (orders are built by another part of the API) and, like a real order, gives it a chat
 * thread. `status` defaults to CONFIRMED, the state a review needs.
 */
export async function insertOrder(
  app: NestFastifyApplication,
  o: { buyerPhone: string; sellerPhone: string; listingId: string; variantId: string; status?: 'PLACED' | 'CONFIRMED' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED'; confirmed?: boolean },
): Promise<{ id: string; threadId: string }> {
  const db = dbOf(app).db;
  const buyerUserId = await userId(app, o.buyerPhone);
  const sellerId = await sellerIdOf(app, o.sellerPhone);
  const sellerUserId = await userId(app, o.sellerPhone);
  const [l] = await db.select({ title: listings.title }).from(listings).where(eq(listings.id, o.listingId)).limit(1);
  const status = o.status ?? 'CONFIRMED';
  // The app's own clock, so messages written later in a test sort after the order's first message.
  const now = new Date(app.get<Clock>(CLOCK).now());
  const confirmed = o.confirmed ?? status !== 'PLACED';
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(orders)
      .values({
        buyerUserId,
        sellerId,
        listingId: o.listingId,
        variantId: o.variantId,
        variantLabel: 'M',
        listingTitle: l!.title,
        pricePaise: rupees(1500),
        listPricePaise: rupees(1500),
        priceSource: 'LIST',
        channel: 'DIRECT',
        paymentMethod: 'UPI',
        status,
        confirmBy: new Date(now.getTime() + 48 * 3600_000),
        confirmedAt: confirmed ? now : null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: orders.id });
    const threadId = await app.get(ChatService).createOrderThread(tx, { orderId: row!.id, buyerUserId, sellerId, sellerUserId, systemText: 'Order placed.', now: now.getTime() });
    return { id: row!.id, threadId };
  });
}
