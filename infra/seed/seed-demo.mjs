#!/usr/bin/env node
// Demo seed for Fayda. Talks to the real API, so every rule applies (no direct database writes).
// Usage: node infra/seed/seed-demo.mjs <api-url> --yes
// Safe to re-run: a shop that already has listings is skipped. Phones are fake (90000 11xxx), OTP is the dev code.
import { deflateSync } from 'node:zlib';

const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!base || !process.argv.includes('--yes')) {
  console.error('Usage: node infra/seed/seed-demo.mjs <api-url> --yes');
  process.exit(2);
}

const call = async (method, path, opts = {}) => {
  for (let attempt = 0; ; attempt++) {
    const r = await callOnce(method, path, opts);
    if (r.status !== 429 || attempt >= 5) return r;
    console.log('rate limited, waiting 30 s');
    await new Promise((ok) => setTimeout(ok, 30_000));
  }
};
const callOnce = async (method, path, { token, body, headers } = {}) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  return { status: res.status, body: json };
};
const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const key = () => crypto.randomUUID();

// A simple vertical-gradient PNG (no libraries), so the demo has pictures without shipping files.
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};
function png(top, bottom, w = 480, h = 640) {
  const row = w * 3 + 1, raw = Buffer.alloc(row * h);
  for (let y = 0; y < h; y++) {
    raw[y * row] = 0;
    const f = y / (h - 1);
    for (let x = 0; x < w; x++) {
      // a soft circle in the middle so the pictures are not blank
      const d = Math.hypot(x - w / 2, y - h * 0.45) / (w * 0.32);
      const lift = d < 1 ? 38 * (1 - d) : 0;
      for (let c = 0; c < 3; c++) raw[y * row + 1 + x * 3 + c] = Math.min(255, Math.round(top[c] + (bottom[c] - top[c]) * f + lift));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PALETTE = {
  indigo: [[44, 62, 120], [120, 140, 200]], clay: [[150, 90, 70], [220, 170, 140]], rose: [[170, 70, 100], [235, 160, 175]],
  sage: [[90, 120, 95], [180, 205, 170]], sand: [[180, 150, 105], [235, 220, 185]], teal: [[20, 100, 105], [110, 190, 185]],
  plum: [[90, 40, 90], [190, 130, 185]], maroon: [[110, 25, 40], [200, 90, 105]], tan: [[140, 95, 55], [215, 175, 130]],
};

async function signIn(phone, app) {
  const r = must(await call('POST', '/v1/auth/otp/verify', { body: { phone, code: '123456', app } }), `sign in ${phone}`);
  return r.accessToken;
}
async function upload(token, color) {
  const [top, bottom] = PALETTE[color];
  const file = png(top, bottom);
  const intent = must(await call('POST', '/v1/seller/media/intents', { token, body: { kind: 'image', purpose: 'LISTING', mime: 'image/png', size: file.length } }), 'upload intent');
  const url = intent.upload.url.startsWith('/') ? intent.upload.url : intent.upload.url;
  const put = await fetch(url.startsWith('http') ? url : base + url, { method: 'PUT', headers: intent.upload.headers, body: file });
  if (put.status >= 300) throw new Error(`upload PUT failed: ${put.status}`);
  must(await call('POST', `/v1/seller/media/${intent.mediaId}/complete`, { token }), 'upload complete');
  return intent.mediaId;
}

const rupees = (n) => n * 100;
const SHOPS = [
  { phone: '9000011111', handle: 'indigothreads', name: 'Indigo Threads', type: 'BUSINESS', area: 'Banjara Hills', cats: ['Ethnic wear', 'Western wear'], upi: 'indigothreads@okhdfcbank', bio: 'Demo shop. Hand-block printed cotton, made in small batches.', sla: { confirmHours: 4, shipDays: 2 }, contact: { phone: '9000011111', whatsapp: '9000011111' } },
  { phone: '9000033333', handle: 'loomandco', name: 'Loom & Co.', type: 'BUSINESS', area: 'Jubilee Hills', cats: ['Ethnic wear', 'Western wear', 'Menswear'], upi: 'loomandco@okaxis', bio: 'Demo shop. Handloom linens and Pochampally ikat.', sla: { confirmHours: 12, shipDays: 3 }, contact: { phone: '9000033333' } },
  { phone: '9000022222', handle: 'meherscloset', name: 'Meher’s Closet', type: 'INDIVIDUAL', area: 'Kondapur', cats: ['Accessories', 'Footwear'], upi: 'meher.closet@okaxis', bio: 'Demo shop. Jewellery and accessories from Laad Bazaar.', sla: { confirmHours: 2, shipDays: 3 }, contact: { whatsapp: '9000022222' } },
];
// [shop, title, description, category, price ₹, variants, mode, rules (₹), colour, tags]
const LISTINGS = [
  ['indigothreads', 'Hand-block printed cotton kurta', 'Soft 60s cotton, hand-block printed with natural indigo. Straight cut, side slits.', 'Ethnic wear', 2499, [['S', 2], ['M', 3], ['L', 2], ['XL', 1]], 'BOTH', { autoAcceptAt: 2199, autoCounterAt: 2299 }, 'indigo', ['kurta', 'cotton', 'block print']],
  ['indigothreads', 'Dabu print mul dupatta', 'Mud-resist dabu print on featherlight mul cotton. 2.25 m.', 'Ethnic wear', 1299, [['One size', 5]], 'BOTH', { autoAcceptAt: 1100 }, 'clay', ['dupatta', 'dabu']],
  ['indigothreads', 'Chanderi silk kurta set', 'Chanderi silk-cotton kurta with matching pants and organza dupatta.', 'Ethnic wear', 4899, [['S', 1], ['M', 2], ['L', 1]], 'BOTH', { autoDeclineBelow: 3500 }, 'rose', ['kurta set', 'chanderi', 'silk']],
  ['loomandco', 'Linen co-ord set', 'Pure linen shirt and wide-leg trousers. Pre-washed, softer with wear.', 'Western wear', 3299, [['S', 2], ['M', 2], ['L', 1]], 'BOTH', { autoAcceptAt: 2899, autoDeclineBelow: 2000 }, 'sage', ['linen', 'co-ord']],
  ['loomandco', 'Mul cotton shirt', 'Breathable mul cotton shirt with mother-of-pearl buttons.', 'Menswear', 1799, [['M', 3], ['L', 3], ['XL', 2]], 'BUY_NOW', {}, 'sand', ['shirt', 'mul']],
  ['loomandco', 'Pochampally ikat silk saree', 'Double ikat silk from Pochampally weavers, with blouse piece.', 'Ethnic wear', 6499, [['One size', 2]], 'BOTH', { autoAcceptAt: 5999, autoCounterAt: 6199 }, 'teal', ['saree', 'ikat', 'silk']],
  ['meherscloset', 'Oxidised silver jhumkas', 'Lightweight oxidised jhumkas with ghungroo drops.', 'Accessories', 999, [['One size', 6]], 'BOTH', { autoAcceptAt: 850, autoDeclineBelow: 500 }, 'plum', ['jhumka', 'jewellery']],
  ['meherscloset', 'Hand-embroidered potli bag', 'Zardozi-embroidered velvet potli with drawstring.', 'Accessories', 1199, [['One size', 3]], 'BOTH', {}, 'maroon', ['potli', 'bag']],
  ['meherscloset', 'Leather Kolhapuri sandals', 'Hand-stitched vegetable-tanned leather Kolhapuris.', 'Footwear', 1899, [['6', 1], ['7', 2], ['8', 2], ['9', 1]], 'BOTH', { autoAcceptAt: 1650 }, 'tan', ['sandals', 'leather']],
];
const BUYERS = [
  { phone: '9876543210', name: 'Aarav Sharma', address: { name: 'Aarav Sharma', line1: 'Flat 302, Lake View Residency', line2: 'Road No. 2, Banjara Hills', landmark: 'Near GVK One', pin: '500034', city: 'Hyderabad', state: 'Telangana' } },
  { phone: '9123456789', name: 'Priya Nair', address: { name: 'Priya Nair', line1: '12-4-56, Sai Enclave', line2: 'Madhapur', pin: '500081', city: 'Hyderabad', state: 'Telangana' } },
];

const sellers = {};
const listingIds = {};
for (const s of SHOPS) {
  const token = await signIn(s.phone, 'seller');
  sellers[s.handle] = token;
  must(await call('PUT', '/v1/seller/profile', { token, body: { sellerType: s.type, name: s.name, handle: s.handle, area: s.area, bio: s.bio, categories: s.cats, mapsUrl: 'https://maps.app.goo.gl/demo', contact: s.contact, sla: s.sla } }), `shop ${s.handle}`);
  must(await call('PUT', '/v1/seller/payment', { token, body: { upiId: s.upi, conductAccepted: true } }), `payment ${s.handle}`);
  const existing = must(await call('GET', '/v1/seller/listings', { token }), 'list listings');
  if (existing.items.length > 0) { console.log(`skip ${s.handle}: already has ${existing.items.length} listings`); continue; }
  for (const l of LISTINGS.filter((x) => x[0] === s.handle)) {
    const [, title, description, category, price, variants, mode, rules, colour, tags] = l;
    const media = await upload(token, colour);
    const r = must(await call('POST', '/v1/seller/listings', {
      token,
      body: {
        title, description, category, price: rupees(price), tags,
        media: [{ mediaId: media }],
        variants: variants.map(([label, stock]) => ({ label, stock })),
        bargaining: { mode, expiryMinutes: 1440 },
        rules: Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, rupees(v)])),
        checkout: { channel: 'DIRECT' },
        publish: true,
      },
    }), `listing ${title}`);
    listingIds[title] = r;
    console.log(`listing: ${title}`);
  }
}

const buyers = {};
for (const b of BUYERS) {
  const token = await signIn(b.phone, 'buyer');
  buyers[b.name.split(' ')[0]] = token;
  must(await call('PUT', '/v1/buyer/profile', { token, body: { name: b.name, address: b.address, contact: { phone: b.phone }, agreementAccepted: true } }), `buyer ${b.name}`);
}

// A little history so screens are not empty: a bargained, delivered order, one order waiting for the seller, likes and a comment.
const dupatta = listingIds['Dabu print mul dupatta'];
const kurta = listingIds['Hand-block printed cotton kurta'];
if (dupatta && kurta) {
  const offer = must(await call('POST', `/v1/buyer/listings/${dupatta.id}/offers`, { token: buyers.Aarav, body: { variantId: dupatta.variants[0].id, amount: rupees(1150) }, headers: { 'idempotency-key': key() } }), 'offer');
  const order = must(await call('POST', '/v1/buyer/orders', { token: buyers.Aarav, body: { negotiationId: offer.id, paymentMethod: 'UPI' }, headers: { 'idempotency-key': key() } }), 'order from offer');
  must(await call('POST', `/v1/seller/orders/${order.id}/confirm`, { token: sellers.indigothreads, body: {}, headers: { 'idempotency-key': key() } }), 'confirm');
  must(await call('POST', `/v1/seller/orders/${order.id}/deliver`, { token: sellers.indigothreads, body: {}, headers: { 'idempotency-key': key() } }), 'deliver');
  must(await call('POST', '/v1/buyer/orders', { token: buyers.Priya, body: { listingId: kurta.id, variantId: kurta.variants[1].id, paymentMethod: 'UPI' }, headers: { 'idempotency-key': key() } }), 'order waiting');
  for (const who of ['Aarav', 'Priya']) {
    must(await call('PUT', `/v1/buyer/listings/${kurta.id}/like`, { token: buyers[who], body: {} }), 'like');
  }
  must(await call('POST', `/v1/buyer/listings/${kurta.id}/comments`, { token: buyers.Priya, body: { text: 'Is the indigo colour-fast?', clientKey: key() }, headers: { 'idempotency-key': key() } }), 'comment');
  console.log('history: 1 delivered order, 1 order waiting for the seller, likes, 1 comment');
}
console.log('NEXT STEP: node infra/seed/refresh-demo-media.mjs ' + base + ' --yes   (this seed makes gradient pictures only; the refresh adds the illustrated pictures and the 60-second reels)');
console.log('Seed done. Sign in with the dev code 123456. Sellers: 9000011111, 9000033333, 9000022222. Buyers: 9876543210, 9123456789.');
