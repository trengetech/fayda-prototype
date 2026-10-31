/* Seed data for the Fayda prototype. Built through engine commands so seeded state obeys the same rules. */
(function (root) {
  'use strict';
  const E = root.FaydaEngine;

  function must(r, what) { if (!r.result.ok) throw new Error('Seed failed at ' + what + ': ' + r.result.code + ' ' + (r.result.message || '') + ' ' + JSON.stringify(r.result.fields || {})); return r; }

  function createSeedState(now) {
    let s = E.emptyState();
    const run = (cmd, at, what) => { const r = must(E.exec(s, cmd, at), what || cmd.type); s = r.state; return r.result; };
    const t0 = now - 6 * E.DAY;

    const login = (phone, app, at) => run({ type: 'auth.verifyOtp', phone, code: E.RULES.DEV_OTP, app }, at).userId;

    // Sellers
    const sellers = [
      { phone: '9000011111', owner: 'Ravi Kumar', type: 'BUSINESS', name: 'Indigo Threads', handle: 'indigothreads', area: 'Banjara Hills', gstin: '36AABCI1234F1Z5', bio: 'Hand-block printed cotton, made in small batches.', payment: { upiId: 'indigothreads@okhdfcbank', bankHolder: 'Indigo Threads LLP', bankAccount: '50200012345678', bankIfsc: 'HDFC0001234', bankName: 'HDFC Bank' }, categories: ['Ethnic wear', 'Western wear'], contact: { phone: '9000011111', whatsapp: '9000011111' }, mapsUrl: 'https://maps.app.goo.gl/indigoThreadsBH', googleProfileUrl: 'https://g.page/indigothreads-hyd', socialUrl: 'https://instagram.com/indigothreads.hyd', sla: { confirmHours: 4, shipDays: 2 } },
      { phone: '9000033333', owner: 'Farah Siddiqui', type: 'BUSINESS', name: 'Loom & Co.', handle: 'loomandco', area: 'Jubilee Hills', gstin: '', bio: 'Handloom linens and Pochampally ikat. We ship from our own store.', payment: { website: 'https://loomandco.example.com' }, categories: ['Ethnic wear', 'Western wear', 'Menswear'], contact: { phone: '9000033333' }, mapsUrl: 'https://www.google.com/maps/place/Jubilee+Hills,+Hyderabad', googleProfileUrl: null, socialUrl: 'https://facebook.com/loomandco.hyd', sla: { confirmHours: 12, shipDays: 3 } },
      { phone: '9000022222', owner: 'Meher Reddy', type: 'INDIVIDUAL', name: 'Meher’s Closet', handle: 'meherscloset', area: 'Kondapur', gstin: '', bio: 'Jewellery and accessories I source from Laad Bazaar.', payment: { upiId: 'meher.closet@okaxis', paymentLink: 'https://pay.example.com/meherscloset' }, categories: ['Accessories', 'Footwear'], contact: { whatsapp: '9000022222' }, mapsUrl: 'https://maps.app.goo.gl/mehersClosetKdp', googleProfileUrl: null, socialUrl: 'https://instagram.com/meherscloset', sla: { confirmHours: 2, shipDays: 3 } }
    ];
    const sellerUser = {};
    sellers.forEach((x, i) => {
      const uid = login(x.phone, 'seller', t0 + i * 1000);
      run({ type: 'user.updateName', userId: uid, name: x.owner }, t0);
      run({ type: 'seller.register', userId: uid, sellerType: x.type, name: x.name, handle: x.handle, area: x.area, city: 'Hyderabad', gstin: x.gstin, bio: x.bio, payment: x.payment, categories: x.categories, contact: x.contact, mapsUrl: x.mapsUrl, googleProfileUrl: x.googleProfileUrl, socialUrl: x.socialUrl, sla: x.sla, conductAccepted: true }, t0 + i * 1000);
      sellerUser[x.handle] = uid;
    });

    // Loom & Co. sells through its own (fictional) website with pre-set coupon codes.
    const WEB = {
      'Linen co-ord set': { productUrl: 'https://loomandco.example.com/products/linen-coord-set', dealCodes: { accept: { type: 'CODE', value: 'FAYDA2899' } } },
      'Mul cotton shirt': { productUrl: 'https://loomandco.example.com/products/mul-cotton-shirt', dealCodes: {} },
      'Pochampally ikat silk saree': { productUrl: 'https://loomandco.example.com/products/pochampally-ikat-saree', dealCodes: { accept: { type: 'CODE', value: 'IKAT5999' }, counter: { type: 'LINK', value: 'https://loomandco.example.com/products/pochampally-ikat-saree?deal=fy6199' } } }
    };
    // Listings: [handle, title, desc, cat, price, variants, mode, expiry, rules, scene, palette, seedLikes]
    const L = [
      ['indigothreads', 'Hand-block printed cotton kurta', 'Soft 60s cotton, hand-block printed with natural indigo. Straight cut, side slits, three-quarter sleeves.', 'Ethnic wear', 2499, [['S', 2], ['M', 3], ['L', 2], ['XL', 1]], 'BOTH', 24, { autoAcceptAt: 2199, autoCounterAt: 2299 }, 'kurta', 'indigo', 248],
      ['indigothreads', 'Dabu print mul dupatta', 'Mud-resist dabu print on featherlight mul cotton. 2.25 m.', 'Ethnic wear', 1299, [['One size', 5]], 'PRIVATE', 24, { autoAcceptAt: 1100 }, 'dupatta', 'clay', 96],
      ['indigothreads', 'Chanderi silk kurta set', 'Chanderi silk-cotton kurta with matching pants and organza dupatta.', 'Ethnic wear', 4899, [['S', 1], ['M', 2], ['L', 1]], 'PUBLIC', 48, { autoDeclineBelow: 3500 }, 'kurta', 'rose', 173],
      ['loomandco', 'Linen co-ord set', 'Pure linen shirt and wide-leg trousers. Pre-washed, gets softer with wear.', 'Western wear', 3299, [['S', 2], ['M', 2], ['L', 1]], 'BOTH', 24, { autoAcceptAt: 2899, autoDeclineBelow: 2000 }, 'coord', 'sage', 131],
      ['loomandco', 'Mul cotton shirt', 'Breathable mul cotton shirt with mother-of-pearl buttons.', 'Menswear', 1799, [['M', 3], ['L', 3], ['XL', 2]], 'FIXED', 24, {}, 'shirt', 'sand', 64],
      ['loomandco', 'Pochampally ikat silk saree', 'Double ikat silk from Pochampally weavers, with blouse piece.', 'Ethnic wear', 6499, [['One size', 2]], 'PUBLIC', 48, { autoAcceptAt: 5999, autoCounterAt: 6199 }, 'saree', 'teal', 312],
      ['meherscloset', 'Oxidised silver jhumkas', 'Lightweight oxidised jhumkas with ghungroo drops.', 'Accessories', 999, [['One size', 6]], 'PRIVATE', 24, { autoAcceptAt: 850, autoDeclineBelow: 500 }, 'jhumka', 'plum', 341],
      ['meherscloset', 'Hand-embroidered potli bag', 'Zardozi-embroidered velvet potli with drawstring.', 'Accessories', 1199, [['One size', 3]], 'BOTH', 24, {}, 'potli', 'maroon', 88],
      ['meherscloset', 'Leather Kolhapuri sandals', 'Hand-stitched vegetable-tanned leather Kolhapuris.', 'Footwear', 1899, [['6', 1], ['7', 2], ['8', 2], ['9', 1]], 'PRIVATE', 24, { autoAcceptAt: 1650 }, 'sandal', 'tan', 203]
    ];
    const ids = {};
    L.forEach((x, i) => {
      const at = t0 + E.HOUR * (i * 7 + 2);
      const r = run({
        type: 'listing.save', userId: sellerUser[x[0]], publish: true,
        draft: { title: x[1], description: x[2], category: x[3], price: x[4], variants: x[5].map(([label, stock]) => ({ label, stock })), bargaining: { mode: x[6], expiryHours: x[7] }, rules: x[8], media: [{ kind: 'seed', scene: x[9], palette: x[10] }], checkout: WEB[x[1]] ? { channel: 'WEBSITE', productUrl: WEB[x[1]].productUrl } : { channel: 'DIRECT' }, dealCodes: WEB[x[1]] ? WEB[x[1]].dealCodes : {} }
      }, at, 'listing ' + x[1]);
      ids[x[9] + i] = r.listingId;
      s.listings[r.listingId].seedLikes = x[11];
      s.listings[r.listingId].views = x[11] * 4 + 37;
    });
    const kurta = ids.kurta0, dupatta = ids.dupatta1, chanderi = ids.kurta2, saree = ids.saree5;

    // Buyers
    const buyers = [
      { phone: '9876543210', name: 'Aarav Sharma', addr: { label: 'Home', name: 'Aarav Sharma', line1: 'Flat 302, Lake View Residency', line2: 'Road No. 2, Banjara Hills', landmark: 'Near GVK One', pin: '500034', city: 'Hyderabad', state: 'Telangana' } },
      { phone: '9123456789', name: 'Priya Nair', addr: { label: 'Home', name: 'Priya Nair', line1: '12-4-56, Sai Enclave', line2: 'Madhapur', landmark: '', pin: '500081', city: 'Hyderabad', state: 'Telangana' } }
    ];
    const B = {};
    buyers.forEach((b, i) => {
      const uid = login(b.phone, 'buyer', t0 + 3 * E.DAY + i);
      run({ type: 'buyer.completeProfile', userId: uid, name: b.name, address: b.addr, contact: { phone: b.phone, whatsapp: b.phone }, agreementAccepted: true }, t0 + 3 * E.DAY + i);
      B[b.name.split(' ')[0]] = uid;
    });
    const addrOf = (uid) => s.buyerProfiles[uid].defaultAddressId;

    // History: Aarav bargained the dupatta (auto-accepted), bought it, and it was delivered.
    let at = now - 4 * E.DAY;
    const ng = run({ type: 'offer.make', userId: B.Aarav, listingId: dupatta, variantId: s.listings[dupatta].variants[0].id, amount: 1150 }, at).negotiationId;
    const o = run({ type: 'order.place', userId: B.Aarav, negotiationId: ng, addressId: addrOf(B.Aarav), paymentMethod: 'UPI' }, at + 600e3).orderId;
    run({ type: 'order.confirm', userId: sellerUser.indigothreads, orderId: o, shipment: { carrier: 'DTDC', trackingId: 'D1234567890', expectedDate: new Date(at + 3 * E.DAY).toISOString().slice(0, 10) } }, at + 3 * E.HOUR);
    run({ type: 'order.deliver', userId: sellerUser.indigothreads, orderId: o }, at + 2 * E.DAY);
    const th = s.orders[o].threadId;
    run({ type: 'chat.send', userId: B.Aarav, threadId: th, text: 'Paid ₹1,150 by UPI with note ' + s.orders[o].number + '.' }, at + 20 * 60e3);
    run({ type: 'chat.send', userId: sellerUser.indigothreads, threadId: th, text: 'Got it, thank you! Shipping today by DTDC.' }, at + 3 * E.HOUR);
    run({ type: 'review.save', userId: B.Aarav, orderId: o, rating: 5, text: 'Colours exactly like the video and the mul is very soft. Packed neatly.', media: [] }, at + 2 * E.DAY + E.HOUR);
    const jh = Object.values(s.listings).find((l) => l.title.startsWith('Oxidised'));
    const o2 = run({ type: 'order.place', userId: B.Priya, listingId: jh.id, variantId: jh.variants[0].id, addressId: addrOf(B.Priya), paymentMethod: 'UPI' }, at + E.DAY).orderId;
    run({ type: 'order.confirm', userId: sellerUser.meherscloset, orderId: o2 }, at + E.DAY + 90 * 60e3);
    run({ type: 'order.ship', userId: sellerUser.meherscloset, orderId: o2, shipment: { note: 'Sent with a local courier' } }, at + 2 * E.DAY);
    run({ type: 'order.deliver', userId: sellerUser.meherscloset, orderId: o2 }, at + 3 * E.DAY);
    run({ type: 'review.save', userId: B.Priya, orderId: o2, rating: 4, text: 'Lovely and light. Took a little longer to arrive than I expected.', media: [] }, at + 3 * E.DAY + E.HOUR);

    // Social graph
    run({ type: 'social.toggleFollow', userId: B.Aarav, sellerId: s.listings[kurta].sellerId }, now - 3 * E.DAY);
    run({ type: 'social.toggleFollow', userId: B.Priya, sellerId: s.listings[saree].sellerId }, now - 3 * E.DAY);
    run({ type: 'social.comment', userId: B.Priya, listingId: kurta, text: 'Is the cotton soft enough for Hyderabad summers?' }, now - 2 * E.DAY);
    run({ type: 'social.comment', userId: sellerUser.indigothreads, listingId: kurta, text: 'Yes — it’s 60s cotton and very breathable. Size up if you like a relaxed fit.' }, now - 2 * E.DAY + 3600e3);
    run({ type: 'social.comment', userId: B.Aarav, listingId: saree, text: 'Beautiful weave. Is the blouse piece included?' }, now - E.DAY);

    // Live negotiations for the demo
    // Priya: public offer on Chanderi set, waiting for the seller.
    run({ type: 'offer.make', userId: B.Priya, listingId: chanderi, variantId: s.listings[chanderi].variants[1].id, amount: 4200, visibility: 'PUBLIC' }, now - 2 * E.HOUR);
    // Priya: private offer on the kurta; the seller's rule auto-countered.
    run({ type: 'offer.make', userId: B.Priya, listingId: kurta, variantId: s.listings[kurta].variants[0].id, amount: 1900, visibility: 'PRIVATE' }, now - 50 * 60e3);
    run({ type: 'system.sweep' }, now - 50 * 60e3 + 6e3);
    // Aarav: public offer on the saree, waiting for the seller.
    run({ type: 'offer.make', userId: B.Aarav, listingId: saree, variantId: s.listings[saree].variants[0].id, amount: 5400, visibility: 'PUBLIC' }, now - 30 * 60e3);
    run({ type: 'system.sweep' }, now - 30 * 60e3 + 6e3);
    // Saree auto-countered at 6,199 for Aarav (rule). Leave it for the demo.

    const rq = run({ type: 'request.create', userId: B.Priya, category: 'Ethnic wear', title: 'Mustard Kota doria dupatta', description: 'Looking for a mustard or haldi-yellow Kota doria dupatta with a thin gold border, for a haldi function next week.', size: '', budget: 1500, media: [{ kind: 'seed', scene: 'dupatta', palette: 'clay' }] }, now - 5 * E.HOUR).requestId;
    run({ type: 'request.respond', userId: sellerUser.indigothreads, requestId: rq, text: 'We have this in haldi yellow with a zari border. Can list it today.', price: 1399, media: [{ kind: 'seed', scene: 'dupatta', palette: 'sand' }] }, now - 3 * E.HOUR);
    s.sessions = { buyer: null, seller: null };
    s.notifications.forEach((n) => { n.read = n.at < now - E.DAY; });
    s.seededAt = now;
    return s;
  }

  root.FaydaSeed = { createSeedState };
})(typeof window !== 'undefined' ? window : globalThis);
