#!/usr/bin/env node
// Replaces the gradient demo pictures with illustrated pictures, and gives some listings a 60-second reel.
// Changes only each demo listing's media. Orders, offers, likes and comments are left as they are.
// Usage: node infra/seed/refresh-demo-media.mjs <api-url> --yes [--force]
// Needs: rsvg-convert (brew install librsvg) and swiftc (Xcode command line tools, macOS) on this machine.
// The pictures are flat-colour illustrations, not photographs; a real seller uploads real photos and videos.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEMO_ART, renderPng } from './media/art.mjs';

const base = (process.argv[2] ?? '').replace(/\/$/, '');
if (!base || !process.argv.includes('--yes')) {
  console.error('Usage: node infra/seed/refresh-demo-media.mjs <api-url> --yes [--force]');
  process.exit(2);
}
const force = process.argv.includes('--force');
const here = dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'fayda-media-'));
const REEL_SECONDS = 60;

const call = async (method, path, { token, body, headers } = {}) => {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(base + path, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 5) { console.log('rate limited, waiting 30 s'); await new Promise((ok) => setTimeout(ok, 30_000)); continue; }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)}`);
    return json;
  }
};

async function upload(token, file, kind, mime, extra = {}) {
  const bytes = readFileSync(file);
  console.log(`  uploading ${kind} ${(bytes.length / 1e6).toFixed(2)} MB`);
  const intent = await call('POST', '/v1/seller/media/intents', { token, body: { kind, purpose: 'LISTING', mime, size: bytes.length, ...extra } });
  const url = intent.upload.url.startsWith('http') ? intent.upload.url : base + intent.upload.url;
  let put;
  try {
    put = await fetch(url, { method: 'PUT', headers: intent.upload.headers, body: bytes });
  } catch (e) {
    throw new Error(`upload PUT of ${(bytes.length / 1e6).toFixed(2)} MB ${kind} failed before the server answered (${e.cause?.code ?? e.message}). A proxy in front of the API may limit the request size.`);
  }
  if (put.status >= 300) throw new Error(`upload PUT failed: ${put.status} ${(await put.text()).slice(0, 200)}`);
  await call('POST', `/v1/seller/media/${intent.mediaId}/complete`, { token });
  return intent.mediaId;
}

// The reel maker: compiled once, from make-reel.swift.
const reelTool = join(work, 'make-reel');
let reelReady = false;
const makeReel = (out, scenes) => {
  if (!reelReady) { execFileSync('swiftc', ['-O', join(here, 'media/make-reel.swift'), '-o', reelTool], { stdio: 'inherit' }); reelReady = true; }
  execFileSync(reelTool, [out, String(REEL_SECONDS), '15', '540', '960', '1', ...scenes], { stdio: 'inherit' });
};

const SHOP_PHONES = ['9000011111', '9000033333', '9000022222'];
for (const phone of SHOP_PHONES) {
  const { accessToken: token } = await call('POST', '/v1/auth/otp/verify', { body: { phone, code: '123456', app: 'seller' } });
  const { items } = await call('GET', '/v1/seller/listings', { token });
  for (const l of items) {
    const art = DEMO_ART[l.title];
    if (!art) continue;
    const hasVideo = l.media.some((m) => m.kind === 'video');
    if (!force && l.media.length >= 3 && hasVideo === art.reel) { console.log(`skip ${l.title}: already has pictures${art.reel ? ' and a reel' : ''}`); continue; }
    const name = l.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const front = renderPng(work, `${name}-front`, art, 'front', 1080, 1350);
    const detail = renderPng(work, `${name}-detail`, art, 'detail', 1080, 1350);
    const flat = renderPng(work, `${name}-flat`, art, 'flat', 1080, 1350);
    const media = [];
    if (art.reel) {
      const scenes = ['front', 'detail', 'flat', 'front'].map((v, i) => renderPng(work, `${name}-r${i}`, art, v, 540, 960));
      const mp4 = join(work, `${name}.mp4`);
      makeReel(mp4, scenes);
      const poster = await upload(token, front, 'image', 'image/png');
      const video = await upload(token, mp4, 'video', 'video/mp4', { durationSec: REEL_SECONDS });
      media.push({ mediaId: video, posterMediaId: poster });
      console.log(`  reel for ${l.title}: ${(statSync(mp4).size / 1e6).toFixed(1)} MB, ${REEL_SECONDS} s`);
    }
    for (const f of [front, detail, flat]) media.push({ mediaId: await upload(token, f, 'image', 'image/png') });
    await call('PUT', `/v1/seller/listings/${l.id}`, {
      token,
      headers: { 'idempotency-key': crypto.randomUUID() },
      body: {
        title: l.title, description: l.description, category: l.category, price: l.price, tags: l.tags, media,
        variants: l.variants.map((v) => ({ id: v.id, label: v.label, stock: v.stock })),
        bargaining: l.bargaining, rules: l.rules, checkout: l.checkout, dealCodes: l.dealCodes,
        publish: l.status === 'ACTIVE',
      },
    });
    console.log(`updated: ${l.title} (${media.length} items${art.reel ? ', first is a reel' : ''})`);
  }
}
console.log('Done. Pull to refresh in the buyer app.');
