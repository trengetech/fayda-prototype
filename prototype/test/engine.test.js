const test = require('node:test');
const assert = require('node:assert/strict');
require('../src/engine.js');
require('../src/seed.js');
const E = globalThis.FaydaEngine;
const HOUR = E.HOUR, DAY = E.DAY;

let NOW = Date.UTC(2026, 9, 30, 10, 0, 0);
function setup(rules, opts = {}) {
  let s = E.emptyState();
  const run = (cmd, at = NOW) => { const r = E.exec(s, cmd, at); if (r.result.ok) s = r.state; return r.result; };
  const login = (phone, app) => run({ type: 'auth.verifyOtp', phone, code: '123456', app }).userId;
  const seller = login('9000011111', 'seller');
  run({ type: 'seller.register', userId: seller, sellerType: 'BUSINESS', name: 'Shop', handle: 'shop', area: 'Banjara Hills', conductAccepted: true, payment: { upiId: 'shop@okicici', bankHolder: 'Shop', bankAccount: '123456789012', bankIfsc: 'ICIC0001234' } });
  const addr = { name: 'A B', line1: '1', line2: 'Street', pin: '500034', city: 'Hyderabad', state: 'Telangana' };
  const b1 = login('9876543210', 'buyer'); run({ type: 'buyer.completeProfile', userId: b1, name: 'Buyer One', address: addr });
  const b2 = login('9123456789', 'buyer'); run({ type: 'buyer.completeProfile', userId: b2, name: 'Buyer Two', address: addr });
  const r = run({ type: 'listing.save', userId: seller, publish: true, draft: { title: 'Kurta', description: '', category: 'Ethnic wear', price: 2500, media: [{ kind: 'seed', scene: 'kurta', palette: 'indigo' }], variants: [{ label: 'M', stock: opts.stock ?? 1 }], bargaining: { mode: opts.mode || 'BOTH', expiryHours: 24 }, rules: rules || {}, checkout: opts.checkout, dealCodes: opts.dealCodes } });
  assert.ok(r.ok, JSON.stringify(r));
  const L = () => s.listings[r.listingId];
  const addrOf = (u) => s.buyerProfiles[u].defaultAddressId;
  return { get s() { return s; }, run, seller, b1, b2, listingId: r.listingId, L, v: () => L().variants[0].id, addrOf };
}
const neg = (t, id) => t.s.negotiations[id];

test('R2: offers must be below list price and above the 10% platform floor', () => {
  const t = setup();
  assert.equal(t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 2500 }).code, 'AT_OR_ABOVE_LIST');
  assert.equal(t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 200 }).code, 'BELOW_PLATFORM_FLOOR');
  assert.equal(t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 12.5 }).code, 'INVALID_AMOUNT');
  assert.ok(t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 2000 }).ok);
});

test('Fixed-price listings refuse offers; sellers cannot offer on their own listing', () => {
  const t = setup({}, { mode: 'FIXED' });
  assert.equal(t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 2000 }).code, 'FIXED_PRICE');
});

test('R3: one open negotiation per buyer per variant', () => {
  const t = setup();
  assert.ok(t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 2000 }).ok);
  assert.equal(t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 2100 }).code, 'ALREADY_OPEN');
});

test('R4/R5: turn-taking and converging counters', () => {
  const t = setup();
  const id = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 1800 }).negotiationId;
  assert.equal(t.run({ type: 'offer.respond', userId: t.b1, negotiationId: id, action: 'COUNTER', amount: 1900 }).code, 'NOT_YOUR_TURN');
  assert.equal(t.run({ type: 'offer.respond', userId: t.seller, negotiationId: id, action: 'COUNTER', amount: 1700 }).code, 'ACCEPT_INSTEAD');
  assert.equal(t.run({ type: 'offer.respond', userId: t.seller, negotiationId: id, action: 'COUNTER', amount: 2500 }).code, 'AT_OR_ABOVE_LIST');
  assert.ok(t.run({ type: 'offer.respond', userId: t.seller, negotiationId: id, action: 'COUNTER', amount: 2300 }).ok);
  assert.equal(t.run({ type: 'offer.respond', userId: t.b1, negotiationId: id, action: 'COUNTER', amount: 1700 }).code, 'MUST_INCREASE');
  assert.equal(t.run({ type: 'offer.respond', userId: t.b1, negotiationId: id, action: 'COUNTER', amount: 2300 }).code, 'ACCEPT_INSTEAD');
  assert.ok(t.run({ type: 'offer.respond', userId: t.b1, negotiationId: id, action: 'COUNTER', amount: 2000 }).ok);
  assert.equal(t.run({ type: 'offer.respond', userId: t.seller, negotiationId: id, action: 'COUNTER', amount: 2350 }).code, 'MUST_DECREASE');
  assert.ok(t.run({ type: 'offer.respond', userId: t.seller, negotiationId: id, action: 'COUNTER', amount: 2200 }).ok);
  assert.equal(neg(t, id).offers.map((o) => o.status).join(','), 'COUNTERED,COUNTERED,COUNTERED,PENDING');
});

test('R6: turn limit blocks further counters after 6 offers', () => {
  const t = setup();
  const id = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 1500 }).negotiationId;
  const steps = [['seller', 2400], ['b1', 1600], ['seller', 2300], ['b1', 1700], ['seller', 2200]];
  steps.forEach(([who, a]) => assert.ok(t.run({ type: 'offer.respond', userId: t[who], negotiationId: id, action: 'COUNTER', amount: a }).ok));
  assert.equal(t.run({ type: 'offer.respond', userId: t.b1, negotiationId: id, action: 'COUNTER', amount: 1800 }).code, 'TURN_LIMIT');
  assert.ok(t.run({ type: 'offer.respond', userId: t.b1, negotiationId: id, action: 'ACCEPT' }).ok);
});

test('R6: at most 3 new negotiations per buyer per listing in 24 h', () => {
  const t = setup({}, { stock: 5 });
  for (let i = 0; i < 3; i++) {
    const id = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 1500 + i }).negotiationId;
    assert.ok(t.run({ type: 'offer.withdraw', userId: t.b1, negotiationId: id }).ok);
  }
  assert.equal(t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 1600 }).code, 'DAILY_LIMIT');
  assert.ok(t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 1600 }, NOW + DAY + 1).ok);
});

test('R7: pending offers expire after the listing expiry window', () => {
  const t = setup();
  const id = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 2000 }).negotiationId;
  t.run({ type: 'system.sweep' }, NOW + 23 * HOUR); assert.equal(neg(t, id).status, 'OPEN');
  t.run({ type: 'system.sweep' }, NOW + 24 * HOUR); assert.equal(neg(t, id).status, 'CLOSED'); assert.equal(neg(t, id).closeReason, 'EXPIRED');
});

test('R8: auto-accept at or above threshold reserves stock', () => {
  const t = setup({ autoAcceptAt: 2200 });
  const id = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 2200 }).negotiationId;
  const n = neg(t, id);
  assert.equal(n.status, 'AGREED'); assert.equal(n.agreement.acceptedBy, 'SYSTEM'); assert.equal(n.agreement.price, 220000);
  assert.equal(Object.values(t.s.reservations).filter((r) => r.status === 'ACTIVE').length, 1);
});

test('R8 + §3.6: auto-decline is delayed and generic; private rules never reach buyer DTOs', () => {
  const t = setup({ autoAcceptAt: 2300, autoDeclineBelow: 1500, autoCounterAt: 2400 });
  const id = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 1000 }).negotiationId;
  assert.equal(neg(t, id).status, 'OPEN', 'not declined instantly');
  const dto = E.buyer.negotiation(t.s, t.b1, id, NOW);
  const listingDto = E.buyer.listing(t.s, t.b1, t.listingId, NOW);
  const blob = JSON.stringify([dto, listingDto, E.buyer.feed(t.s, t.b1, NOW), E.buyer.search(t.s, t.b1, NOW, {})]);
  ['autoAcceptAt', 'autoDeclineBelow', 'autoCounterAt', 'autoDeclineAt', 'systemCountered', '230000', '150000', '240000', 'rules'].forEach((k) => assert.ok(!blob.includes(k), 'leaked ' + k));
  t.run({ type: 'system.sweep' }, NOW + E.RULES.AUTO_DECLINE_DELAY_MS);
  assert.equal(neg(t, id).closeReason, 'AUTO_DECLINED');
});

test('R8: auto-counter arrives after 5 s, repeats for every offer below the minimum, never goes up, and looks like the seller', () => {
  const t = setup({ autoAcceptAt: 2300, autoCounterAt: 2400 });
  const id = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 1800 }).negotiationId;
  assert.equal(neg(t, id).offers.length, 1, 'no instant counter');
  t.run({ type: 'system.sweep' }, NOW + 4000); assert.equal(neg(t, id).offers.length, 1, 'still waiting at 4 s');
  t.run({ type: 'system.sweep' }, NOW + 5000);
  let n = neg(t, id); assert.equal(n.offers.length, 2); assert.equal(n.offers[1].by, 'SYSTEM'); assert.equal(n.offers[1].amount, 240000);
  const dto = E.buyer.negotiation(t.s, t.b1, id, NOW + 5000);
  assert.ok(dto.offers.every((o) => !('automatic' in o)), 'buyer cannot tell the counter was automatic');
  assert.ok(!JSON.stringify(dto).includes('SYSTEM'));
  assert.ok(!t.s.notifications.find((x) => x.app === 'buyer' && /automatic/i.test(x.text) && /countered/i.test(x.text)), 'buyer notification does not say automatic');
  assert.ok(t.run({ type: 'offer.respond', userId: t.b1, negotiationId: id, action: 'COUNTER', amount: 2000 }, NOW + 6000).ok);
  t.run({ type: 'system.sweep' }, NOW + 11000);
  n = neg(t, id); assert.equal(n.offers.length, 4, 'countered again'); assert.equal(n.offers[3].amount, 240000, 'holds at the same counter');
  assert.ok(t.run({ type: 'offer.respond', userId: t.b1, negotiationId: id, action: 'COUNTER', amount: 2350 }, NOW + 12000).ok);
  n = neg(t, id); assert.equal(n.status, 'AGREED', 'offer at or above minimum is auto-accepted'); assert.equal(n.agreement.price, 235000);
});

test('R8: if the seller counters lower by hand, the automatic counter repeats that lower amount', () => {
  const t = setup({ autoAcceptAt: 2200, autoCounterAt: 2400 });
  const id = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 1800 }).negotiationId;
  assert.ok(t.run({ type: 'offer.respond', userId: t.seller, negotiationId: id, action: 'COUNTER', amount: 2300 }, NOW + 1000).ok, 'seller answers before the auto-counter fires');
  t.run({ type: 'system.sweep' }, NOW + 6000); assert.equal(neg(t, id).offers.length, 2, 'pending auto-counter was superseded');
  assert.ok(t.run({ type: 'offer.respond', userId: t.b1, negotiationId: id, action: 'COUNTER', amount: 2000 }, NOW + 7000).ok);
  t.run({ type: 'system.sweep' }, NOW + 12000);
  const n = neg(t, id); assert.equal(n.offers[3].by, 'SYSTEM'); assert.equal(n.offers[3].amount, 230000, 'never higher than the seller’s own counter');
});

test('R8: auto-counter stops at the turn limit; the last offer goes to the seller', () => {
  const t = setup({ autoAcceptAt: 2400, autoCounterAt: 2450 });
  let at = NOW;
  const id = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 1500 }, at).negotiationId;
  [1600, 1700].forEach((a) => { at += 6000; t.run({ type: 'system.sweep' }, at); assert.ok(t.run({ type: 'offer.respond', userId: t.b1, negotiationId: id, action: 'COUNTER', amount: a }, at).ok); });
  at += 6000; t.run({ type: 'system.sweep' }, at);
  const n = neg(t, id); assert.equal(n.offers.length, 6); assert.equal(n.offers[5].by, 'SYSTEM');
  assert.equal(t.run({ type: 'offer.respond', userId: t.b1, negotiationId: id, action: 'COUNTER', amount: 1800 }, at).code, 'TURN_LIMIT');
});

test('R9/R10: agreed price is server-side, buyer-only, and lapses after the checkout window', () => {
  const t = setup({ autoAcceptAt: 2000 });
  const id = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 2100 }).negotiationId;
  assert.equal(t.run({ type: 'order.place', userId: t.b2, negotiationId: id, addressId: t.addrOf(t.b2), paymentMethod: 'UPI' }).code, 'NOT_FOUND');
  assert.equal(t.run({ type: 'order.place', userId: t.b2, listingId: t.listingId, variantId: t.v(), addressId: t.addrOf(t.b2), paymentMethod: 'UPI' }).code, 'OUT_OF_STOCK', 'reserved unit not sold to others');
  t.run({ type: 'system.sweep' }, NOW + 12 * HOUR);
  assert.equal(neg(t, id).status, 'LAPSED');
  assert.equal(t.run({ type: 'order.place', userId: t.b1, negotiationId: id, addressId: t.addrOf(t.b1), paymentMethod: 'UPI' }, NOW + 12 * HOUR).code, 'NOT_AGREED');
  assert.ok(t.run({ type: 'order.place', userId: t.b2, listingId: t.listingId, variantId: t.v(), addressId: t.addrOf(t.b2), paymentMethod: 'UPI' }, NOW + 12 * HOUR).ok, 'unit released');
});

test('Checkout at agreed price creates an order, consumes stock, and invalidates other offers (R11)', () => {
  const t = setup({});
  const a = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 2000 }).negotiationId;
  const b = t.run({ type: 'offer.make', userId: t.b2, listingId: t.listingId, variantId: t.v(), amount: 1900 }).negotiationId;
  assert.ok(t.run({ type: 'offer.respond', userId: t.seller, negotiationId: a, action: 'ACCEPT' }).ok);
  assert.equal(neg(t, b).closeReason, 'SOLD_OUT', 'only unit reserved → other pending offer invalidated');
  assert.equal(t.run({ type: 'offer.respond', userId: t.seller, negotiationId: b, action: 'ACCEPT' }).code, 'NOT_OPEN');
  assert.equal(t.run({ type: 'order.place', userId: t.b1, negotiationId: a, addressId: t.addrOf(t.b1), paymentMethod: 'LINK' }).code, 'NO_METHOD', 'method must be one the seller offers');
  assert.equal(neg(t, a).status, 'AGREED', 'failed placement changes nothing');
  const r = t.run({ type: 'order.place', userId: t.b1, negotiationId: a, addressId: t.addrOf(t.b1), paymentMethod: 'UPI' });
  assert.ok(r.ok); const o = t.s.orders[r.orderId];
  assert.equal(o.price, 200000); assert.equal(o.priceSource, 'NEGOTIATED'); assert.equal(t.L().variants[0].stock, 0);
  assert.equal(neg(t, a).status, 'PURCHASED');
});

test('Accepting with no stock fails; two buyers cannot both win the last unit', () => {
  const t = setup({});
  const a = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 2000 }).negotiationId;
  assert.ok(t.run({ type: 'order.place', userId: t.b2, listingId: t.listingId, variantId: t.v(), addressId: t.addrOf(t.b2), paymentMethod: 'UPI' }).ok);
  assert.equal(neg(t, a).closeReason, 'SOLD_OUT');
  assert.equal(t.run({ type: 'order.place', userId: t.b1, listingId: t.listingId, variantId: t.v(), addressId: t.addrOf(t.b1), paymentMethod: 'UPI' }).code, 'OUT_OF_STOCK');
});

test('R12–R14: pause, price drop and switch to fixed price invalidate pending offers', () => {
  const t = setup({}, { stock: 3 });
  const draft = (over) => Object.assign({ title: 'Kurta', description: '', category: 'Ethnic wear', price: 2500, media: [{ kind: 'seed', scene: 'kurta', palette: 'indigo' }], variants: [{ id: t.v(), label: 'M', stock: 3 }], bargaining: { mode: 'BOTH', expiryHours: 24 }, rules: {} }, over);
  const a = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 2200 }).negotiationId;
  const b = t.run({ type: 'offer.make', userId: t.b2, listingId: t.listingId, variantId: t.v(), amount: 1800 }).negotiationId;
  assert.ok(t.run({ type: 'listing.save', userId: t.seller, listingId: t.listingId, draft: draft({ price: 2100 }) }).ok);
  assert.equal(neg(t, a).closeReason, 'PRICE_DROPPED'); assert.equal(neg(t, b).status, 'OPEN');
  assert.ok(t.run({ type: 'listing.save', userId: t.seller, listingId: t.listingId, draft: draft({ price: 2100, bargaining: { mode: 'FIXED', expiryHours: 24 } }) }).ok);
  assert.equal(neg(t, b).closeReason, 'FIXED_PRICE');
  assert.ok(t.run({ type: 'listing.save', userId: t.seller, listingId: t.listingId, draft: draft({ price: 2100 }) }).ok);
  const c = t.run({ type: 'offer.make', userId: t.b2, listingId: t.listingId, variantId: t.v(), amount: 1800 }).negotiationId;
  assert.ok(t.run({ type: 'listing.setStatus', userId: t.seller, listingId: t.listingId, status: 'PAUSED' }).ok);
  assert.equal(neg(t, c).closeReason, 'LISTING_PAUSED');
});

test('Listing rule validation: decline < accept ≤ counter < list price', () => {
  const base = { title: 'Kurta', category: 'Ethnic wear', price: 2500, media: [{ kind: 'seed' }], variants: [{ label: 'M', stock: 1 }], bargaining: { mode: 'BOTH', expiryHours: 24 } };
  assert.ok(E.validateListingDraft(Object.assign({}, base, { rules: { autoDeclineBelow: 2300, autoAcceptAt: 2200 } })).errors.autoDeclineBelow);
  assert.ok(E.validateListingDraft(Object.assign({}, base, { rules: { autoAcceptAt: 2200, autoCounterAt: 2100 } })).errors.autoCounterAt);
  assert.ok(E.validateListingDraft(Object.assign({}, base, { rules: { autoAcceptAt: 2500 } })).errors.autoAcceptAt);
  assert.deepEqual(E.validateListingDraft(Object.assign({}, base, { rules: { autoDeclineBelow: 1500, autoAcceptAt: 2200, autoCounterAt: 2300 } })).errors, {});
});

test('Identity: phone and OTP validated; one identity across buyer and seller apps', () => {
  let s = E.emptyState();
  assert.equal(E.exec(s, { type: 'auth.verifyOtp', phone: '12345', code: '123456', app: 'buyer' }, NOW).result.code, 'INVALID_PHONE');
  assert.equal(E.exec(s, { type: 'auth.verifyOtp', phone: '9876543210', code: '000000', app: 'buyer' }, NOW).result.code, 'INVALID_OTP');
  let r = E.exec(s, { type: 'auth.verifyOtp', phone: '+91 98765 43210', code: '123456', app: 'buyer' }, NOW); s = r.state;
  const r2 = E.exec(s, { type: 'auth.verifyOtp', phone: '9876543210', code: '123456', app: 'seller' }, NOW);
  assert.equal(r.result.userId, r2.result.userId);
});

test('Direct orders: only the seller confirms payment, ships (optional details) and delivers', () => {
  const t = setup({}, { stock: 2 });
  const id = t.run({ type: 'order.place', userId: t.b1, listingId: t.listingId, variantId: t.v(), addressId: t.addrOf(t.b1), paymentMethod: 'BANK' }).orderId;
  const o = () => t.s.orders[id];
  assert.equal(o().status, 'PLACED'); assert.equal(t.L().variants[0].stock, 1);
  const buyerView = E.buyer.order(t.s, t.b1, id);
  assert.equal(buyerView.payTo.bank.account, '123456789012', 'buyer with an active order sees bank details');
  ['order.confirm', 'order.ship', 'order.deliver', 'order.cancel'].forEach((type) => assert.equal(t.run({ type, userId: t.b1, orderId: id, reason: 'OTHER', shipment: { carrier: 'x' } }).code, 'NOT_FOUND', 'buyer cannot move ' + type));
  assert.equal(t.run({ type: 'order.confirm', userId: t.seller, orderId: id, shipment: { trackingUrl: 'http://bad' } }).code, 'VALIDATION');
  assert.ok(t.run({ type: 'order.confirm', userId: t.seller, orderId: id }).ok); assert.equal(o().status, 'CONFIRMED');
  assert.equal(E.buyer.order(t.s, t.b1, id).payTo, undefined, 'payment details hidden after confirmation');
  assert.equal(t.run({ type: 'order.ship', userId: t.seller, orderId: id, shipment: {} }).code, 'VALIDATION');
  assert.ok(t.run({ type: 'order.ship', userId: t.seller, orderId: id, shipment: { carrier: 'Delhivery', trackingId: 'AWB123', trackingUrl: 'https://track.example.com/AWB123', expectedDate: '2026-11-04' } }).ok);
  assert.equal(o().status, 'SHIPPED'); assert.equal(o().shipment.trackingId, 'AWB123');
  assert.ok(t.run({ type: 'order.deliver', userId: t.seller, orderId: id }).ok); assert.equal(o().status, 'DELIVERED');
  assert.equal(t.run({ type: 'order.cancel', userId: t.seller, orderId: id, reason: 'OTHER' }).code, 'INVALID_STATE');
});

test('Seller can confirm payment and add shipment in one step, or skip shipping (hand delivery)', () => {
  const t = setup({}, { stock: 2 });
  const a = t.run({ type: 'order.place', userId: t.b1, listingId: t.listingId, variantId: t.v(), addressId: t.addrOf(t.b1), paymentMethod: 'UPI' }).orderId;
  assert.ok(t.run({ type: 'order.confirm', userId: t.seller, orderId: a, shipment: { carrier: 'DTDC', trackingId: 'D1' } }).ok);
  assert.equal(t.s.orders[a].status, 'SHIPPED');
  const b = t.run({ type: 'order.place', userId: t.b2, listingId: t.listingId, variantId: t.v(), addressId: t.addrOf(t.b2), paymentMethod: 'UPI' }).orderId;
  assert.ok(t.run({ type: 'order.confirm', userId: t.seller, orderId: b }).ok);
  assert.ok(t.run({ type: 'order.deliver', userId: t.seller, orderId: b }).ok, 'confirmed → delivered without shipment details');
});

test('Unconfirmed orders expire and restock; seller cancellations restock except out-of-stock; stats are public', () => {
  const t = setup({}, { stock: 2 });
  const a = t.run({ type: 'order.place', userId: t.b1, listingId: t.listingId, variantId: t.v(), addressId: t.addrOf(t.b1), paymentMethod: 'UPI' }).orderId;
  const b = t.run({ type: 'order.place', userId: t.b2, listingId: t.listingId, variantId: t.v(), addressId: t.addrOf(t.b2), paymentMethod: 'UPI' }).orderId;
  assert.equal(t.L().variants[0].stock, 0);
  assert.equal(t.run({ type: 'order.cancel', userId: t.seller, orderId: b, reason: 'NOPE' }).code, 'VALIDATION');
  assert.ok(t.run({ type: 'order.cancel', userId: t.seller, orderId: b, reason: 'PAYMENT_NOT_RECEIVED' }).ok);
  assert.equal(t.L().variants[0].stock, 1);
  t.run({ type: 'system.sweep' }, NOW + 48 * HOUR);
  assert.equal(t.s.orders[a].status, 'EXPIRED'); assert.equal(t.L().variants[0].stock, 2);
  const st = E.buyer.listing(t.s, t.b1, t.listingId, NOW + 48 * HOUR).seller.stats;
  assert.equal(st.orders, 2); assert.equal(st.cancelled, 1); assert.equal(st.expired, 1);
});

test('Payment profile validation and privacy: details never in public listing, feed or shop views', () => {
  assert.ok(E.validatePayment({}).errors.payment);
  assert.ok(E.validatePayment({ upiId: 'not-an-id' }).errors.upiId);
  assert.ok(E.validatePayment({ bankAccount: '123', bankIfsc: 'XXXX', bankHolder: '' }).errors.bankIfsc);
  assert.ok(E.validatePayment({ paymentLink: 'http://pay' }).errors.paymentLink);
  assert.deepEqual(E.validatePayment({ upiId: 'meher.closet@okaxis' }).errors, {});
  assert.deepEqual(E.validatePayment({ website: 'https://shop.example.com' }).errors, {});
  const t = setup({});
  const blob = JSON.stringify([E.buyer.feed(t.s, t.b1, NOW), E.buyer.listing(t.s, t.b1, t.listingId, NOW), E.buyer.shop(t.s, t.b1, t.L().sellerId, NOW)]);
  ['123456789012', 'ICIC0001234', 'shop@okicici'].forEach((k) => assert.ok(!blob.includes(k), 'leaked ' + k));
});

test('Direct-pay listing requires a direct payment method on the seller profile', () => {
  let s = E.emptyState(); const run = (c) => { const r = E.exec(s, c, NOW); if (r.result.ok) s = r.state; return r.result; };
  const u = run({ type: 'auth.verifyOtp', phone: '9000099999', code: '123456', app: 'seller' }).userId;
  assert.ok(run({ type: 'seller.register', userId: u, sellerType: 'INDIVIDUAL', name: 'Web only', handle: 'webonly', area: 'Kukatpally', conductAccepted: true, payment: { website: 'https://web.example.com' } }).ok);
  const d = { title: 'Kurta', category: 'Ethnic wear', price: 2500, media: [{ kind: 'seed' }], variants: [{ label: 'M', stock: 1 }], bargaining: { mode: 'BOTH', expiryHours: 24 }, rules: {} };
  assert.ok(run({ type: 'listing.save', userId: u, publish: true, draft: Object.assign({}, d, { checkout: { channel: 'DIRECT' } }) }).fields.channel);
  assert.ok(run({ type: 'listing.save', userId: u, publish: true, draft: Object.assign({}, d, { checkout: { channel: 'WEBSITE', productUrl: 'web.example.com/x' } }) }).fields.productUrl);
  assert.ok(run({ type: 'listing.save', userId: u, publish: true, draft: Object.assign({}, d, { rules: { autoAcceptAt: 2200 }, checkout: { channel: 'WEBSITE', productUrl: 'https://web.example.com/x' } }) }).fields.acceptCode, 'auto-accept on website needs a pre-set code');
  assert.ok(run({ type: 'listing.save', userId: u, publish: true, draft: Object.assign({}, d, { rules: { autoAcceptAt: 2200 }, checkout: { channel: 'WEBSITE', productUrl: 'https://web.example.com/x' }, dealCodes: { accept: { type: 'CODE', value: 'SAVE300' } } }) }).ok);
});

function webSetup(rules, codes) {
  return setup(rules, { stock: 2, checkout: { channel: 'WEBSITE', productUrl: 'https://shop.example.com/kurta' }, dealCodes: codes });
}
test('Website listing: auto-accept agrees at the pre-set code price and reveals the code only on agreement', () => {
  const t = webSetup({ autoAcceptAt: 2200, autoCounterAt: 2350 }, { accept: { type: 'CODE', value: 'FY2200' }, counter: { type: 'LINK', value: 'https://shop.example.com/kurta?d=2350' } });
  const low = t.run({ type: 'offer.make', userId: t.b2, listingId: t.listingId, variantId: t.v(), amount: 1800 }).negotiationId;
  t.run({ type: 'system.sweep' }, NOW + 5000);
  const lowDto = E.buyer.negotiation(t.s, t.b2, low, NOW);
  assert.equal(lowDto.offers[1].amount, 235000); assert.ok(!JSON.stringify(lowDto).includes('d=2350'), 'counter link hidden until accepted');
  assert.ok(t.run({ type: 'offer.respond', userId: t.b2, negotiationId: low, action: 'ACCEPT' }, NOW + 5000).ok);
  assert.equal(E.buyer.negotiation(t.s, t.b2, low, NOW).agreement.dealAccess.value, 'https://shop.example.com/kurta?d=2350');
  const id = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 2300 }).negotiationId;
  const dto = E.buyer.negotiation(t.s, t.b1, id, NOW);
  assert.equal(dto.status, 'AGREED'); assert.equal(dto.agreement.price, 220000, 'agreed at the code price'); assert.equal(dto.agreement.dealAccess.value, 'FY2200');
  assert.equal(t.run({ type: 'order.place', userId: t.b1, listingId: t.listingId, variantId: t.v(), addressId: t.addrOf(t.b1), paymentMethod: 'UPI' }).code, 'USE_WEBSITE');
  const r = t.run({ type: 'order.place', userId: t.b1, negotiationId: id });
  assert.ok(r.ok); assert.equal(r.url, 'https://shop.example.com/kurta');
  const o = t.s.orders[r.orderId]; assert.equal(o.channel, 'WEBSITE'); assert.equal(o.address, null); assert.equal(o.dealAccess.value, 'FY2200');
  assert.ok(t.run({ type: 'order.confirm', userId: t.seller, orderId: r.orderId }).ok);
});

test('Website listing: seller must supply a code or link to accept or counter manually', () => {
  const t = webSetup({}, {});
  const id = t.run({ type: 'offer.make', userId: t.b1, listingId: t.listingId, variantId: t.v(), amount: 2000 }).negotiationId;
  assert.equal(t.run({ type: 'offer.respond', userId: t.seller, negotiationId: id, action: 'ACCEPT' }).code, 'DEAL_ACCESS_REQUIRED');
  assert.equal(t.run({ type: 'offer.respond', userId: t.seller, negotiationId: id, action: 'COUNTER', amount: 2300 }).code, 'DEAL_ACCESS_REQUIRED');
  assert.equal(t.run({ type: 'offer.respond', userId: t.seller, negotiationId: id, action: 'COUNTER', amount: 2300, dealAccess: { type: 'CODE', value: 'a b' } }).code, 'DEAL_ACCESS_REQUIRED');
  assert.ok(t.run({ type: 'offer.respond', userId: t.seller, negotiationId: id, action: 'COUNTER', amount: 2300, dealAccess: { type: 'CODE', value: 'AARAV2300' } }).ok);
  assert.ok(!JSON.stringify(E.buyer.negotiation(t.s, t.b1, id, NOW)).includes('AARAV2300'));
  assert.ok(t.run({ type: 'offer.respond', userId: t.b1, negotiationId: id, action: 'COUNTER', amount: 2100 }).ok);
  assert.ok(t.run({ type: 'offer.respond', userId: t.seller, negotiationId: id, action: 'ACCEPT', dealAccess: { type: 'LINK', value: 'https://shop.example.com/kurta?p=2100' } }).ok);
  assert.equal(E.buyer.negotiation(t.s, t.b1, id, NOW).agreement.dealAccess.type, 'LINK');
});

test('Seed state builds through the engine and contains the demo negotiations', () => {
  const s = globalThis.FaydaSeed.createSeedState(NOW);
  assert.equal(Object.keys(s.listings).length, 9);
  const negs = Object.values(s.negotiations);
  assert.ok(negs.some((n) => n.status === 'PURCHASED'));
  assert.ok(negs.filter((n) => n.status === 'OPEN').length >= 3);
  assert.ok(negs.some((n) => n.offers.some((o) => o.by === 'SYSTEM')));
});
