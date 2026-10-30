/* Fayda prototype engine — pure business rules, no DOM.
 * Mirrors FAYDA_PROJECT_FOUNDATION.md §3 (R1–R17). Values marked PROVISIONAL are not approved policy.
 * All money is integer paise. All times are epoch ms supplied by the caller (simulated clock).
 * Designed to move into apps/api (NestJS) as the negotiation/ordering domain modules. */
(function (root) {
  'use strict';

  const HOUR = 3600e3, DAY = 24 * HOUR;
  const RULES = Object.freeze({
    OFFER_MIN_RATIO: 0.10,                 // PROVISIONAL platform sanity floor (R2)
    MAX_OFFERS_PER_NEGOTIATION: 6,         // PROVISIONAL (R6)
    MAX_NEW_NEGOTIATIONS_PER_LISTING_24H: 3, // PROVISIONAL (R6)
    DEFAULT_EXPIRY_HOURS: 24, MIN_EXPIRY_HOURS: 6, MAX_EXPIRY_HOURS: 72, // PROVISIONAL (R7)
    AUTO_DECLINE_DELAY_MS: 2 * 60e3,       // PROVISIONAL (R8, §3.6)
    AUTO_COUNTER_DELAY_MS: 5e3,            // founder decision: automatic counters arrive after 5 s and look like the seller's own
    CHECKOUT_WINDOW_HOURS: 12,             // PROVISIONAL (R9)
    ORDER_CONFIRM_WINDOW_HOURS: 48,        // PROVISIONAL: seller must confirm a placed order or it expires
    MIN_PRICE_PAISE: 50 * 100, MAX_PRICE_PAISE: 1000000 * 100,
    DEV_OTP: '123456'                      // SIMULATED sign-in code
  });
  const CATEGORIES = ['Ethnic wear', 'Western wear', 'Menswear', 'Accessories', 'Footwear'];
  const MODES = ['FIXED', 'PRIVATE', 'PUBLIC', 'BOTH'];
  const ORDER_FLOW = ['PLACED', 'CONFIRMED', 'SHIPPED', 'DELIVERED'];
  const CANCEL_REASONS = { PAYMENT_NOT_RECEIVED: 'Payment not received', WEBSITE_ORDER_NOT_FOUND: 'No matching order on the website', OUT_OF_STOCK: 'Out of stock', BUYER_REQUEST: 'Buyer asked to cancel', OTHER: 'Other' };
  const PAY_METHODS = { UPI: 'UPI', BANK: 'Bank transfer', LINK: 'Payment link' };
  const CLOSE_TEXT = {
    DECLINED: 'Offer declined', AUTO_DECLINED: 'Offer declined', EXPIRED: 'Offer expired',
    WITHDRAWN: 'Offer withdrawn', SOLD_OUT: 'This size sold out', LISTING_PAUSED: 'Listing paused by the seller',
    PRICE_DROPPED: 'Price dropped below the offer — buy at the new price', FIXED_PRICE: 'Seller switched to fixed price',
    LAPSED: 'Checkout window passed', PURCHASED: 'Purchased'
  };

  const err = (code, message) => ({ ok: false, code, message });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const rupeesToPaise = (r) => Math.round(Number(r) * 100);
  const isInt = (n) => Number.isInteger(n);
  const values = (o) => Object.values(o || {});

  function newId(s, prefix) {
    s.seq = (s.seq || 0) + 1;
    return prefix + '_' + s.seq.toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function emptyState() {
    return {
      v: 2, seq: 0, clockOffsetMs: 0, orderSeq: 10000,
      users: {}, buyerProfiles: {}, sellers: {}, listings: {}, privateRules: {},
      negotiations: {}, reservations: {}, orders: {}, paymentProfiles: {}, dealCodes: {},
      likes: {}, saves: {}, follows: {}, comments: [], notifications: [],
      sessions: { buyer: null, seller: null }
    };
  }

  // ---------- lookups ----------
  const sellerOfUser = (s, userId) => values(s.sellers).find((x) => x.userId === userId) || null;
  const variantOf = (l, variantId) => (l.variants || []).find((v) => v.id === variantId) || null;
  const latest = (n) => n.offers[n.offers.length - 1];
  const sideOf = (by) => (by === 'BUYER' ? 'BUYER' : 'SELLER');
  const lastBySide = (n, side) => { for (let i = n.offers.length - 1; i >= 0; i--) if (sideOf(n.offers[i].by) === side) return n.offers[i]; return null; };

  function activeReservations(s, variantId, now) {
    return values(s.reservations).filter((r) => r.variantId === variantId && r.status === 'ACTIVE' && r.expiresAt > now).length;
  }
  function available(s, l, v, now) { return Math.max(0, v.stock - activeReservations(s, v.id, now)); }

  function notify(s, userId, app, text, ref, now) {
    s.notifications.unshift({ id: newId(s, 'nt'), userId, app, text, ref: ref || null, at: now, read: false });
    if (s.notifications.length > 300) s.notifications.length = 300;
  }
  function event(n, type, actor, now, data) { n.events.push(Object.assign({ type, actor, at: now }, data || {})); }

  function closeNeg(s, n, offerStatus, reason, now, actor) {
    const last = latest(n);
    if (last && last.status === 'PENDING') { last.status = offerStatus; last.resolvedAt = now; }
    n.status = 'CLOSED'; n.closeReason = reason; n.closedAt = now; n.updatedAt = now;
    event(n, 'CLOSED', actor || 'SYSTEM', now, { reason });
  }

  function invalidateOpen(s, pred, reason, now) {
    values(s.negotiations).forEach((n) => {
      if (n.status !== 'OPEN' || !pred(n)) return;
      const l = s.listings[n.listingId];
      closeNeg(s, n, 'INVALIDATED', reason, now);
      notify(s, n.buyerId, 'buyer', `${CLOSE_TEXT[reason]}: ${l.title}`, { type: 'negotiation', id: n.id }, now);
      notify(s, l.ownerUserId, 'seller', `Offer closed (${CLOSE_TEXT[reason].toLowerCase()}): ${l.title}`, { type: 'negotiation', id: n.id }, now);
    });
  }
  function invalidateIfSoldOut(s, l, v, now, exceptId) {
    if (available(s, l, v, now) > 0) return;
    invalidateOpen(s, (n) => n.variantId === v.id && n.id !== exceptId, 'SOLD_OUT', now);
  }

  // ---------- negotiation core ----------
  function addOffer(s, n, by, amount, now, l) {
    const prev = latest(n);
    if (prev && prev.status === 'PENDING') { prev.status = 'COUNTERED'; prev.resolvedAt = now; }
    const offer = { id: newId(s, 'of'), by, amount, status: 'PENDING', at: now, expiresAt: now + l.bargaining.expiryHours * HOUR };
    n.offers.push(offer); n.updatedAt = now;
    event(n, prev ? 'COUNTERED' : 'OFFERED', by, now, { amount });
    return offer;
  }

  function acceptLatest(s, n, actor, now, opts) {
    opts = opts || {};
    const l = s.listings[n.listingId]; const v = variantOf(l, n.variantId); const last = latest(n);
    if (!last || last.status !== 'PENDING') return err('NOTHING_TO_ACCEPT', 'There is no open offer to accept.');
    const website = channelOf(l) === 'WEBSITE';
    let dealAccess = null;
    if (website) {
      dealAccess = opts.dealAccess || (sideOf(last.by) === 'SELLER' ? last.dealAccess : null);
      if (!dealAccess) return err('DEAL_ACCESS_REQUIRED', 'Add the coupon code or discount link that gives this price on your website.');
    }
    if (available(s, l, v, now) < 1) return err('OUT_OF_STOCK', 'This size is out of stock, so the offer can’t be accepted.');
    const res = { id: newId(s, 'rs'), listingId: l.id, variantId: v.id, negotiationId: n.id, reason: 'AGREEMENT', status: 'ACTIVE', createdAt: now, expiresAt: now + RULES.CHECKOUT_WINDOW_HOURS * HOUR };
    s.reservations[res.id] = res;
    last.status = 'ACCEPTED'; last.resolvedAt = now;
    const price = opts.price || last.amount;
    n.status = 'AGREED'; n.updatedAt = now;
    n.agreement = { price, deadline: res.expiresAt, reservationId: res.id, acceptedBy: actor, at: now, dealAccess };
    event(n, 'ACCEPTED', actor, now, { amount: price });
    const auto = actor === 'SYSTEM' ? ' (automatic response set by the seller)' : '';
    if (sideOf(actor) === 'SELLER') notify(s, n.buyerId, 'buyer', `Offer accepted${auto}: ${l.title} at ${fmt(price)}. Buy before the checkout window closes.`, { type: 'negotiation', id: n.id }, now);
    else notify(s, n.buyerId, 'buyer', `You accepted ${fmt(last.amount)} for ${l.title}. Checkout is open for ${RULES.CHECKOUT_WINDOW_HOURS} h.`, { type: 'negotiation', id: n.id }, now);
    notify(s, l.ownerUserId, 'seller', actor === 'SYSTEM' ? `Auto-accepted ${fmt(price)} for ${l.title} (${v.label}). 1 unit reserved.` : sideOf(actor) === 'BUYER' ? `Buyer accepted your ${fmt(last.amount)} counter for ${l.title}. 1 unit reserved.` : `You accepted ${fmt(last.amount)} for ${l.title}. 1 unit reserved.`, { type: 'negotiation', id: n.id }, now);
    invalidateIfSoldOut(s, l, v, now, n.id);
    return { ok: true };
  }

  function validateCounter(n, side, amount, l, opts) {
    const last = latest(n);
    if (n.status !== 'OPEN' || !last || last.status !== 'PENDING') return err('NOT_OPEN', 'This negotiation is no longer open.');
    if (sideOf(last.by) === side) return err('NOT_YOUR_TURN', 'Wait for the other side to respond.');
    if (n.offers.length >= RULES.MAX_OFFERS_PER_NEGOTIATION) return err('TURN_LIMIT', 'This negotiation has reached its limit. Accept or decline the last offer.');
    if (!isInt(amount) || amount <= 0) return err('INVALID_AMOUNT', 'Enter an amount in whole rupees.');
    if (amount >= l.price) return err('AT_OR_ABOVE_LIST', 'Counters must be below the listed price.');
    const mine = lastBySide(n, side);
    if (side === 'BUYER') {
      if (mine && amount <= mine.amount) return err('MUST_INCREASE', `Your counter must be higher than your last offer (${fmt(mine.amount)}).`);
      if (amount >= last.amount) return err('ACCEPT_INSTEAD', `That’s at or above the seller’s ${fmt(last.amount)} — accept it instead.`);
    } else {
      if (mine && (opts && opts.allowHold ? amount > mine.amount : amount >= mine.amount)) return err('MUST_DECREASE', `Your counter must be lower than your last counter (${fmt(mine.amount)}).`);
      if (amount <= last.amount) return err('ACCEPT_INSTEAD', `That’s at or below the buyer’s ${fmt(last.amount)} — accept it instead.`);
    }
    return { ok: true };
  }

  // Seller-controlled private rules, evaluated only on the server side (R8). Never serialised to buyers.
  function applyAutomation(s, n, now) {
    const l = s.listings[n.listingId]; const last = latest(n);
    if (n.status !== 'OPEN' || last.by !== 'BUYER' || last.status !== 'PENDING') return;
    const r = s.privateRules[l.id] || {};
    const website = channelOf(l) === 'WEBSITE'; const codes = s.dealCodes[l.id] || {};
    if (r.autoAcceptAt != null && last.amount >= r.autoAcceptAt) {
      // Website listings: the agreed price is the price the seller's pre-set code gives (the auto-accept amount).
      const opts = website ? { price: r.autoAcceptAt, dealAccess: codes.accept } : {};
      if ((!website || codes.accept) && acceptLatest(s, n, 'SYSTEM', now, opts).ok) return;
    }
    if (r.autoDeclineBelow != null && last.amount < r.autoDeclineBelow) { last.autoDeclineAt = now + RULES.AUTO_DECLINE_DELAY_MS; return; }
    // Auto-counter: applies to every buyer offer below the seller's minimum, after a short delay.
    // The seller holds at their counter (never goes up); if they countered lower by hand, that lower amount is repeated.
    if (r.autoCounterAt != null && (!website || codes.counter)) {
      const prev = lastBySide(n, 'SELLER');
      const amt = prev ? Math.min(r.autoCounterAt, prev.amount) : r.autoCounterAt;
      if (amt > last.amount && validateCounter(n, 'SELLER', amt, l, { allowHold: true }).ok) {
        last.systemCounterDueAt = now + RULES.AUTO_COUNTER_DELAY_MS; last.systemCounterAmount = amt;
        return;
      }
    }
    notify(s, l.ownerUserId, 'seller', `New offer ${fmt(last.amount)} for ${l.title} (${variantOf(l, n.variantId).label}). Reply before it expires.`, { type: 'negotiation', id: n.id }, now);
  }

  // ---------- sweep: expiry, delayed auto-decline, lapsed agreements (R7, R8, R9) ----------
  function sweep(s, now) {
    let changed = false;
    values(s.negotiations).forEach((n) => {
      const l = s.listings[n.listingId];
      if (n.status === 'OPEN') {
        const last = latest(n);
        if (last.status !== 'PENDING') return;
        if (last.systemCounterDueAt && now >= last.systemCounterDueAt) {
          const amt = last.systemCounterAmount, due = last.systemCounterDueAt;
          delete last.systemCounterDueAt; delete last.systemCounterAmount;
          const r = s.privateRules[l.id] || {}; const codes = s.dealCodes[l.id] || {}; const prev = lastBySide(n, 'SELLER');
          if (validateCounter(n, 'SELLER', amt, l, { allowHold: true }).ok) {
            const o = addOffer(s, n, 'SYSTEM', amt, due, l);
            if (channelOf(l) === 'WEBSITE') o.dealAccess = amt === r.autoCounterAt ? codes.counter : (prev && prev.dealAccess) || codes.counter;
            notify(s, n.buyerId, 'buyer', `Seller countered ${fmt(amt)} for ${l.title}.`, { type: 'negotiation', id: n.id }, due);
            notify(s, l.ownerUserId, 'seller', `Auto-countered ${fmt(amt)} on a ${fmt(last.amount)} offer for ${l.title}.`, { type: 'negotiation', id: n.id }, due);
          } else notify(s, l.ownerUserId, 'seller', `New offer ${fmt(last.amount)} for ${l.title}. Reply before it expires.`, { type: 'negotiation', id: n.id }, due);
          changed = true; return;
        }
        if (last.autoDeclineAt && now >= last.autoDeclineAt) {
          closeNeg(s, n, 'DECLINED', 'AUTO_DECLINED', now, 'SYSTEM');
          notify(s, n.buyerId, 'buyer', `The seller declined your ${fmt(last.amount)} offer for ${l.title} (automatic response set by the seller).`, { type: 'negotiation', id: n.id }, now);
          notify(s, l.ownerUserId, 'seller', `Auto-declined a ${fmt(last.amount)} offer for ${l.title}.`, { type: 'negotiation', id: n.id }, now);
          changed = true;
        } else if (now >= last.expiresAt) {
          closeNeg(s, n, 'EXPIRED', 'EXPIRED', now);
          notify(s, n.buyerId, 'buyer', `Offer expired: ${l.title} (${fmt(last.amount)}).`, { type: 'negotiation', id: n.id }, now);
          notify(s, l.ownerUserId, 'seller', `Offer expired without a reply: ${l.title} (${fmt(last.amount)}).`, { type: 'negotiation', id: n.id }, now);
          changed = true;
        }
      } else if (n.status === 'AGREED' && now >= n.agreement.deadline) {
        const r = s.reservations[n.agreement.reservationId]; if (r && r.status === 'ACTIVE') r.status = 'RELEASED';
        n.status = 'LAPSED'; n.closeReason = 'LAPSED'; n.updatedAt = now; event(n, 'LAPSED', 'SYSTEM', now);
        notify(s, n.buyerId, 'buyer', `Your agreed price for ${l.title} lapsed — the checkout window closed.`, { type: 'negotiation', id: n.id }, now);
        notify(s, l.ownerUserId, 'seller', `Buyer didn’t check out in time: ${l.title}. Reserved unit released.`, { type: 'negotiation', id: n.id }, now);
        changed = true;
      }
    });
    values(s.reservations).forEach((r) => { if (r.status === 'ACTIVE' && r.expiresAt <= now) { r.status = 'RELEASED'; changed = true; } });
    values(s.orders).forEach((o) => {
      if (o.status === 'PLACED' && o.confirmBy && now >= o.confirmBy) {
        o.status = 'EXPIRED'; o.events.push({ status: 'EXPIRED', at: now }); restock(s, o);
        notify(s, o.buyerId, 'buyer', `Order ${o.number} expired: the seller didn’t confirm it within ${RULES.ORDER_CONFIRM_WINDOW_HOURS} h. Contact the seller if you already paid.`, { type: 'order', id: o.id }, now);
        notify(s, o.sellerUserId, 'seller', `Order ${o.number} expired because it wasn’t confirmed in time. This shows on your shop record.`, { type: 'order', id: o.id }, now);
        changed = true;
      }
    });
    return changed;
  }

  // ---------- validation helpers ----------
  const normPhone = (p) => String(p || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  const PHONE_RE = /^[6-9]\d{9}$/;
  const PIN_RE = /^[1-9]\d{5}$/;
  const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  const HANDLE_RE = /^[a-z0-9_.]{3,24}$/;
  const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
  const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  const ACCT_RE = /^\d{9,18}$/;
  const CODE_RE = /^[A-Za-z0-9_-]{3,40}$/;
  const isHttps = (u) => { try { const x = new URL(String(u)); return x.protocol === 'https:' && !!x.hostname && x.hostname.includes('.'); } catch (e) { return false; } };
  const channelOf = (l) => (l.checkout && l.checkout.channel) || 'DIRECT';

  function cleanPayment(p) {
    p = p || {};
    const t = (x) => String(x == null ? '' : x).trim();
    return { upiId: t(p.upiId) || null, upiQrMediaId: p.upiQrMediaId || null, bankHolder: t(p.bankHolder) || null, bankAccount: t(p.bankAccount).replace(/\s/g, '') || null, bankIfsc: t(p.bankIfsc).toUpperCase() || null, bankName: t(p.bankName) || null, paymentLink: t(p.paymentLink) || null, website: t(p.website) || null };
  }
  function validatePayment(p) {
    const e = {}; const c = cleanPayment(p);
    if (c.upiId && !UPI_RE.test(c.upiId)) e.upiId = 'Enter a UPI ID like name@okbank.';
    const anyBank = c.bankHolder || c.bankAccount || c.bankIfsc || c.bankName;
    if (anyBank) {
      if (!c.bankHolder || c.bankHolder.length < 2) e.bankHolder = 'Enter the account holder’s name.';
      if (!ACCT_RE.test(c.bankAccount || '')) e.bankAccount = 'Enter a 9–18 digit account number.';
      if (!IFSC_RE.test(c.bankIfsc || '')) e.bankIfsc = 'Enter an 11-character IFSC, like HDFC0001234.';
    }
    if (c.paymentLink && !isHttps(c.paymentLink)) e.paymentLink = 'Enter a full https:// payment link.';
    if (c.website && !isHttps(c.website)) e.website = 'Enter a full https:// website address.';
    if (!c.upiId && !c.upiQrMediaId && !anyBank && !c.paymentLink && !c.website) e.payment = 'Add at least one way for buyers to pay you, or your website.';
    return { errors: e, clean: c };
  }
  const directMethods = (p) => { const m = []; if (!p) return m; if (p.upiId || p.upiQrMediaId) m.push('UPI'); if (p.bankAccount) m.push('BANK'); if (p.paymentLink) m.push('LINK'); return m; };
  function validateDealAccess(d, label) {
    if (!d || !d.value || !String(d.value).trim()) return label + ': enter a coupon code or a discount link.';
    if (d.type === 'LINK') return isHttps(d.value) ? null : label + ': enter a full https:// link.';
    if (d.type === 'CODE') return CODE_RE.test(String(d.value).trim()) ? null : label + ': codes use 3–40 letters, numbers, - or _.';
    return label + ': choose code or link.';
  }
  const cleanDeal = (d) => (d ? { type: d.type, value: String(d.value).trim() } : null);
  const hasShipment = (x) => !!(x && ['carrier', 'trackingId', 'trackingUrl', 'expectedDate', 'note'].some((k) => String(x[k] || '').trim()));
  function validateShipment(x) {
    const t = (k) => String(x[k] || '').trim(); const f = {};
    const clean = { carrier: t('carrier').slice(0, 60) || null, trackingId: t('trackingId').slice(0, 60) || null, trackingUrl: t('trackingUrl') || null, expectedDate: t('expectedDate') || null, note: t('note').slice(0, 200) || null };
    if (!hasShipment(x)) f.shipment = 'Add a courier, tracking number, link or a note such as “hand delivery”.';
    if (clean.trackingUrl && !isHttps(clean.trackingUrl)) f.trackingUrl = 'Enter a full https:// tracking link.';
    if (clean.expectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(clean.expectedDate)) f.expectedDate = 'Use a date like 2026-11-04.';
    return Object.keys(f).length ? { fields: f } : { clean };
  }
  function restock(s, o) { const l = s.listings[o.listingId]; const v = l && variantOf(l, o.variantId); if (v && !o.restocked) { v.stock += 1; o.restocked = true; } }

  function validateAddress(a) {
    const e = {};
    if (!a || !String(a.name || '').trim() || String(a.name).trim().length < 2) e.name = 'Enter the recipient’s name.';
    if (!String(a?.line1 || '').trim()) e.line1 = 'Enter flat, house or building.';
    if (!String(a?.line2 || '').trim()) e.line2 = 'Enter area or street.';
    if (!PIN_RE.test(String(a?.pin || ''))) e.pin = 'Enter a 6-digit PIN code.';
    if (!String(a?.city || '').trim()) e.city = 'Enter the city.';
    if (!String(a?.state || '').trim()) e.state = 'Enter the state.';
    return e;
  }
  function cleanAddress(a, id) {
    return { id, label: ['Home', 'Work', 'Other'].includes(a.label) ? a.label : 'Home', name: a.name.trim(), line1: a.line1.trim(), line2: a.line2.trim(), landmark: String(a.landmark || '').trim(), pin: String(a.pin), city: a.city.trim(), state: a.state.trim() };
  }

  function validateListingDraft(d) {
    const e = {};
    const title = String(d.title || '').trim();
    if (title.length < 3 || title.length > 80) e.title = 'Use 3–80 characters.';
    if (String(d.description || '').length > 600) e.description = 'Keep it under 600 characters.';
    if (!CATEGORIES.includes(d.category)) e.category = 'Choose a category.';
    if (!d.media || !d.media.length) e.media = 'Add at least one video or photo.';
    if (d.media && d.media.length > 6) e.media = 'Up to 6 media items.';
    const price = Number(d.price);
    if (!isInt(price) || price * 100 < RULES.MIN_PRICE_PAISE || price * 100 > RULES.MAX_PRICE_PAISE) e.price = 'Enter a whole-rupee price between ₹50 and ₹10,00,000.';
    const vs = d.variants || [];
    if (!vs.length) e.variants = 'Add at least one size or option.';
    const labels = new Set();
    vs.forEach((v) => {
      const lab = String(v.label || '').trim();
      if (!lab) e.variants = 'Every size needs a name.';
      if (labels.has(lab.toLowerCase())) e.variants = 'Size names must be unique.';
      labels.add(lab.toLowerCase());
      if (!isInt(Number(v.stock)) || Number(v.stock) < 0 || Number(v.stock) > 9999) e.variants = 'Stock must be a whole number from 0 to 9,999.';
    });
    const b = d.bargaining || {};
    if (!MODES.includes(b.mode)) e.mode = 'Choose how buyers can bargain.';
    const exp = Number(b.expiryHours);
    if (!isInt(exp) || exp < RULES.MIN_EXPIRY_HOURS || exp > RULES.MAX_EXPIRY_HOURS) e.expiryHours = `Choose ${RULES.MIN_EXPIRY_HOURS}–${RULES.MAX_EXPIRY_HOURS} hours.`;
    const r = d.rules || {};
    const num = (x) => (x === '' || x == null ? null : Number(x));
    const A = num(r.autoAcceptAt), D = num(r.autoDeclineBelow), C = num(r.autoCounterAt);
    if (b.mode !== 'FIXED' && isInt(price)) {
      [['autoAcceptAt', A], ['autoDeclineBelow', D], ['autoCounterAt', C]].forEach(([k, x]) => {
        if (x != null && (!isInt(x) || x <= 0 || x >= price)) e[k] = 'Must be a whole-rupee amount below the listed price.';
      });
      if (A != null && D != null && !e.autoAcceptAt && !e.autoDeclineBelow && D >= A) e.autoDeclineBelow = 'Must be lower than your lowest price.';
      if (A != null && C != null && !e.autoAcceptAt && !e.autoCounterAt && C < A) e.autoCounterAt = 'Must be at or above your lowest price.';
      if (D != null && C != null && !e.autoCounterAt && !e.autoDeclineBelow && C <= D) e.autoCounterAt = 'Must be above the auto-decline amount.';
    }
    return { errors: e, rules: b.mode === 'FIXED' ? { autoAcceptAt: null, autoDeclineBelow: null, autoCounterAt: null } : { autoAcceptAt: A == null ? null : A * 100, autoDeclineBelow: D == null ? null : D * 100, autoCounterAt: C == null ? null : C * 100 } };
  }

  function fmt(paise) { return '₹' + Math.round(paise / 100).toLocaleString('en-IN'); }

  // ---------- commands ----------
  const handlers = {
    'auth.verifyOtp'(s, c, now) {
      const phone = normPhone(c.phone);
      if (!PHONE_RE.test(phone)) return err('INVALID_PHONE', 'Enter a valid 10-digit Indian mobile number.');
      if (String(c.code || '').trim() !== RULES.DEV_OTP) return err('INVALID_OTP', 'That code is incorrect. In this prototype the code is 123456.');
      let u = values(s.users).find((x) => x.phone === phone);
      if (!u) { u = { id: newId(s, 'u'), phone, name: '', createdAt: now }; s.users[u.id] = u; }
      if (c.app !== 'buyer' && c.app !== 'seller') return err('INVALID_APP', 'Unknown app.');
      s.sessions[c.app] = u.id;
      return { ok: true, userId: u.id };
    },
    'auth.signOut'(s, c) { s.sessions[c.app] = null; return { ok: true }; },

    'buyer.completeProfile'(s, c, now) {
      const u = s.users[c.userId]; if (!u) return err('NO_USER', 'Sign in again.');
      const name = String(c.name || '').trim();
      const e = validateAddress(c.address);
      if (name.length < 2) e.fullName = 'Enter your name.';
      if (Object.keys(e).length) return Object.assign(err('VALIDATION', 'Check the highlighted fields.'), { fields: e });
      if (!u.name) u.name = name;
      const addr = cleanAddress(c.address, newId(s, 'ad'));
      s.buyerProfiles[u.id] = { userId: u.id, addresses: [addr], defaultAddressId: addr.id, createdAt: now };
      return { ok: true };
    },
    'buyer.saveAddress'(s, c) {
      const p = s.buyerProfiles[c.userId]; if (!p) return err('NO_PROFILE', 'Complete your profile first.');
      const e = validateAddress(c.address);
      if (Object.keys(e).length) return Object.assign(err('VALIDATION', 'Check the highlighted fields.'), { fields: e });
      if (c.address.id) {
        const i = p.addresses.findIndex((a) => a.id === c.address.id); if (i < 0) return err('NOT_FOUND', 'Address not found.');
        p.addresses[i] = cleanAddress(c.address, c.address.id);
      } else { const a = cleanAddress(c.address, newId(s, 'ad')); p.addresses.push(a); if (!p.defaultAddressId) p.defaultAddressId = a.id; return { ok: true, addressId: a.id }; }
      return { ok: true, addressId: c.address.id };
    },
    'buyer.deleteAddress'(s, c) {
      const p = s.buyerProfiles[c.userId]; if (!p) return err('NO_PROFILE', 'Complete your profile first.');
      if (p.addresses.length <= 1) return err('LAST_ADDRESS', 'Keep at least one address.');
      p.addresses = p.addresses.filter((a) => a.id !== c.addressId);
      if (p.defaultAddressId === c.addressId) p.defaultAddressId = p.addresses[0].id;
      return { ok: true };
    },
    'user.updateName'(s, c) {
      const u = s.users[c.userId]; const name = String(c.name || '').trim();
      if (!u) return err('NO_USER', 'Sign in again.'); if (name.length < 2 || name.length > 60) return Object.assign(err('VALIDATION', 'Enter 2–60 characters.'), { fields: { name: 'Enter 2–60 characters.' } });
      u.name = name; return { ok: true };
    },

    'seller.register'(s, c, now) {
      const u = s.users[c.userId]; if (!u) return err('NO_USER', 'Sign in again.');
      if (sellerOfUser(s, u.id)) return err('ALREADY_SELLER', 'This account already has a shop.');
      const f = validateSeller(s, c, null);
      const pay = validatePayment(c.payment); Object.assign(f, pay.errors);
      if (!c.conductAccepted) f.conduct = 'You need to agree to the Seller Code of Conduct to register.';
      if (Object.keys(f).length) return Object.assign(err('VALIDATION', 'Check the highlighted fields.'), { fields: f });
      const sel = Object.assign({ id: newId(s, 'sl'), userId: u.id, verification: 'UNVERIFIED', conductAcceptedAt: now, conductVersion: 'draft-2026-10', createdAt: now }, sellerFields(c));
      s.sellers[sel.id] = sel;
      s.paymentProfiles[sel.id] = Object.assign(pay.clean, { updatedAt: now });
      if (!u.name) u.name = String(c.ownerName || sel.name).trim();
      return { ok: true, sellerId: sel.id };
    },
    'seller.updateProfile'(s, c) {
      const sel = sellerOfUser(s, c.userId); if (!sel) return err('NO_SELLER', 'Register your shop first.');
      const merged = Object.assign({}, sel, { sellerType: sel.type }, c);
      const f = validateSeller(s, merged, sel.id);
      if (Object.keys(f).length) return Object.assign(err('VALIDATION', 'Check the highlighted fields.'), { fields: f });
      Object.assign(sel, sellerFields(merged));
      return { ok: true };
    },

    'seller.updatePayment'(s, c, now) {
      const sel = sellerOfUser(s, c.userId); if (!sel) return err('NO_SELLER', 'Register your shop first.');
      const pay = validatePayment(c.payment);
      if (Object.keys(pay.errors).length) return Object.assign(err('VALIDATION', 'Check the highlighted fields.'), { fields: pay.errors });
      s.paymentProfiles[sel.id] = Object.assign(pay.clean, { updatedAt: now });
      return { ok: true };
    },

    'listing.save'(s, c, now) {
      const sel = sellerOfUser(s, c.userId); if (!sel) return err('NO_SELLER', 'Register your shop first.');
      const d = c.draft || {};
      const { errors, rules } = validateListingDraft(d);
      if (c.publish) {
        const total = (d.variants || []).reduce((t, v) => t + (Number(v.stock) || 0), 0);
        if (!errors.variants && total < 1) errors.variants = 'Add stock to at least one size before publishing.';
      }
      const co = d.checkout || { channel: 'DIRECT' };
      const pay = s.paymentProfiles[sel.id];
      if (!['DIRECT', 'WEBSITE'].includes(co.channel)) errors.channel = 'Choose where buyers complete the purchase.';
      else if (co.channel === 'DIRECT' && !directMethods(pay).length) errors.channel = 'Add a UPI ID, QR code, bank account or payment link in your shop settings first.';
      else if (co.channel === 'WEBSITE') {
        if (!isHttps(co.productUrl)) errors.productUrl = 'Enter the full https:// link to this product on your website.';
        if (d.bargaining && d.bargaining.mode !== 'FIXED') {
          const dc = d.dealCodes || {};
          if (rules.autoAcceptAt != null) { const m = validateDealAccess(dc.accept, 'Code for your automatic price'); if (m) errors.acceptCode = m; }
          if (rules.autoCounterAt != null) { const m = validateDealAccess(dc.counter, 'Code for your automatic counter'); if (m) errors.counterCode = m; }
        }
      }
      if (Object.keys(errors).length) return Object.assign(err('VALIDATION', 'Check the highlighted fields.'), { fields: errors });
      const price = rupeesToPaise(d.price);
      let l = c.listingId ? s.listings[c.listingId] : null;
      if (c.listingId && (!l || l.sellerId !== sel.id)) return err('NOT_FOUND', 'Listing not found.');
      const variants = d.variants.map((v) => ({ id: v.id && l && variantOf(l, v.id) ? v.id : newId(s, 'vr'), label: String(v.label).trim(), stock: Number(v.stock) }));
      if (!l) {
        l = { id: newId(s, 'ls'), sellerId: sel.id, ownerUserId: sel.userId, status: 'DRAFT', createdAt: now, views: 0, seedLikes: 0 };
        s.listings[l.id] = l;
      }
      const oldPrice = l.price, oldMode = l.bargaining && l.bargaining.mode, oldVariants = l.variants || [];
      Object.assign(l, { title: d.title.trim(), description: String(d.description || '').trim(), category: d.category, price, media: d.media.slice(0, 6), variants, bargaining: { mode: d.bargaining.mode, expiryHours: Number(d.bargaining.expiryHours) }, updatedAt: now });
      s.privateRules[l.id] = rules;
      l.checkout = co.channel === 'WEBSITE' ? { channel: 'WEBSITE', productUrl: String(co.productUrl).trim() } : { channel: 'DIRECT' };
      const dc = d.dealCodes || {};
      s.dealCodes[l.id] = co.channel === 'WEBSITE' && d.bargaining.mode !== 'FIXED' ? { accept: rules.autoAcceptAt != null ? cleanDeal(dc.accept) : null, counter: rules.autoCounterAt != null ? cleanDeal(dc.counter) : null } : {};
      if (c.publish && l.status !== 'ACTIVE') { l.status = 'ACTIVE'; l.publishedAt = l.publishedAt || now; }
      // Invalidation rules on change (R11–R14)
      oldVariants.forEach((ov) => { if (!variantOf(l, ov.id)) invalidateOpen(s, (n) => n.variantId === ov.id, 'SOLD_OUT', now); });
      if (oldMode && oldMode !== 'FIXED' && l.bargaining.mode === 'FIXED') invalidateOpen(s, (n) => n.listingId === l.id, 'FIXED_PRICE', now);
      if (oldPrice && price < oldPrice) invalidateOpen(s, (n) => n.listingId === l.id && latest(n).amount >= price, 'PRICE_DROPPED', now);
      l.variants.forEach((v) => invalidateIfSoldOut(s, l, v, now));
      return { ok: true, listingId: l.id };
    },
    'listing.setStatus'(s, c, now) {
      const sel = sellerOfUser(s, c.userId); const l = s.listings[c.listingId];
      if (!sel || !l || l.sellerId !== sel.id) return err('NOT_FOUND', 'Listing not found.');
      if (!['ACTIVE', 'PAUSED'].includes(c.status)) return err('INVALID_STATUS', 'Unsupported status.');
      if (c.status === 'ACTIVE' && l.variants.reduce((t, v) => t + v.stock, 0) < 1) return err('NO_STOCK', 'Add stock before resuming this listing.');
      l.status = c.status; l.updatedAt = now; if (c.status === 'ACTIVE') l.publishedAt = l.publishedAt || now;
      if (c.status === 'PAUSED') invalidateOpen(s, (n) => n.listingId === l.id, 'LISTING_PAUSED', now);
      return { ok: true };
    },
    'listing.delete'(s, c) {
      const sel = sellerOfUser(s, c.userId); const l = s.listings[c.listingId];
      if (!sel || !l || l.sellerId !== sel.id) return err('NOT_FOUND', 'Listing not found.');
      if (l.status !== 'DRAFT') return err('NOT_DRAFT', 'Only drafts can be deleted. Pause a published listing instead.');
      delete s.listings[l.id]; delete s.privateRules[l.id]; delete s.dealCodes[l.id]; return { ok: true };
    },
    'listing.websiteClick'(s, c) {
      const l = s.listings[c.listingId]; if (!l || l.status !== 'ACTIVE' || channelOf(l) !== 'WEBSITE') return err('NOT_AVAILABLE', 'This listing doesn’t sell through a website.');
      l.websiteClicks = (l.websiteClicks || 0) + 1; return { ok: true, url: l.checkout.productUrl };
    },
    'listing.view'(s, c) {
      const l = s.listings[c.listingId]; if (!l || l.status !== 'ACTIVE') return { ok: true };
      if (c.userId && c.userId === l.ownerUserId) return { ok: true };
      l.views = (l.views || 0) + 1; return { ok: true };
    },

    'social.toggleLike'(s, c) { return toggle(s, 'likes', c.userId, c.listingId, s.listings[c.listingId]); },
    'social.toggleSave'(s, c) { return toggle(s, 'saves', c.userId, c.listingId, s.listings[c.listingId]); },
    'social.toggleFollow'(s, c) {
      const sel = s.sellers[c.sellerId]; if (!sel) return err('NOT_FOUND', 'Shop not found.');
      if (sel.userId === c.userId) return err('OWN_SHOP', 'You can’t follow your own shop.');
      return toggle(s, 'follows', c.userId, c.sellerId, sel);
    },
    'social.comment'(s, c, now) {
      const l = s.listings[c.listingId]; if (!l || l.status === 'DRAFT') return err('NOT_FOUND', 'Listing not found.');
      const text = String(c.text || '').trim();
      if (!text) return err('EMPTY', 'Write a comment first.'); if (text.length > 300) return err('TOO_LONG', 'Keep comments under 300 characters.');
      s.comments.push({ id: newId(s, 'cm'), listingId: l.id, userId: c.userId, text, at: now });
      if (c.userId !== l.ownerUserId) notify(s, l.ownerUserId, 'seller', `New comment on ${l.title}: “${text.slice(0, 60)}”`, { type: 'listing', id: l.id }, now);
      return { ok: true };
    },

    'offer.make'(s, c, now) {
      const l = s.listings[c.listingId]; const u = s.users[c.userId];
      if (!u || !s.buyerProfiles[u.id]) return err('NO_PROFILE', 'Complete your buyer profile first.');
      if (!l || l.status !== 'ACTIVE') return err('NOT_AVAILABLE', 'This listing isn’t available.');
      if (l.ownerUserId === u.id) return err('OWN_LISTING', 'You can’t make an offer on your own listing.');
      if (l.bargaining.mode === 'FIXED') return err('FIXED_PRICE', 'This listing is fixed price.');
      const v = variantOf(l, c.variantId); if (!v) return err('NO_VARIANT', 'Choose a size.');
      if (available(s, l, v, now) < 1) return err('OUT_OF_STOCK', 'This size is out of stock.');
      const amount = rupeesToPaise(c.amount);
      if (!isInt(Number(c.amount)) || amount <= 0) return err('INVALID_AMOUNT', 'Enter an amount in whole rupees.');
      if (amount >= l.price) return err('AT_OR_ABOVE_LIST', 'That’s at or above the listed price — use Buy now instead.');
      const floor = Math.ceil(l.price * RULES.OFFER_MIN_RATIO / 100) * 100;
      if (amount < floor) return err('BELOW_PLATFORM_FLOOR', `Offers must be at least ${fmt(floor)} (10% of the listed price).`);
      let vis = l.bargaining.mode === 'BOTH' ? (c.visibility === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE') : l.bargaining.mode;
      const mine = values(s.negotiations).filter((n) => n.buyerId === u.id && n.listingId === l.id);
      if (mine.some((n) => n.variantId === v.id && (n.status === 'OPEN' || n.status === 'AGREED'))) return err('ALREADY_OPEN', 'You already have an open offer for this size.');
      if (mine.filter((n) => n.createdAt > now - DAY).length >= RULES.MAX_NEW_NEGOTIATIONS_PER_LISTING_24H) return err('DAILY_LIMIT', 'You’ve reached today’s offer limit for this listing. Try again tomorrow.');
      const n = { id: newId(s, 'ng'), listingId: l.id, variantId: v.id, buyerId: u.id, sellerId: l.sellerId, visibility: vis, status: 'OPEN', offers: [], events: [], createdAt: now, updatedAt: now };
      s.negotiations[n.id] = n;
      addOffer(s, n, 'BUYER', amount, now, l);
      applyAutomation(s, n, now);
      return { ok: true, negotiationId: n.id };
    },
    'offer.respond'(s, c, now) {
      const n = s.negotiations[c.negotiationId]; if (!n) return err('NOT_FOUND', 'Negotiation not found.');
      const l = s.listings[n.listingId];
      const side = c.userId === n.buyerId ? 'BUYER' : c.userId === l.ownerUserId ? 'SELLER' : null;
      if (!side) return err('FORBIDDEN', 'You’re not part of this negotiation.');
      const last = latest(n);
      if (n.status !== 'OPEN' || last.status !== 'PENDING') return err('NOT_OPEN', 'This negotiation is no longer open.');
      if (sideOf(last.by) === side) return err('NOT_YOUR_TURN', 'Wait for the other side to respond.');
      const website = channelOf(l) === 'WEBSITE';
      if (c.action === 'ACCEPT') {
        if (website && side === 'SELLER') { const m = validateDealAccess(c.dealAccess, 'Code or link'); if (m) return Object.assign(err('DEAL_ACCESS_REQUIRED', m), { fields: { dealAccess: m } }); return acceptLatest(s, n, side, now, { dealAccess: cleanDeal(c.dealAccess) }); }
        return acceptLatest(s, n, side, now);
      }
      if (c.action === 'DECLINE') {
        closeNeg(s, n, 'DECLINED', 'DECLINED', now, side);
        if (side === 'SELLER') notify(s, n.buyerId, 'buyer', `The seller declined your ${fmt(last.amount)} offer for ${l.title}.`, { type: 'negotiation', id: n.id }, now);
        else notify(s, l.ownerUserId, 'seller', `Buyer declined your ${fmt(last.amount)} counter for ${l.title}.`, { type: 'negotiation', id: n.id }, now);
        return { ok: true };
      }
      if (c.action === 'COUNTER') {
        const amount = rupeesToPaise(c.amount);
        if (!isInt(Number(c.amount))) return err('INVALID_AMOUNT', 'Enter an amount in whole rupees.');
        const v = validateCounter(n, side, amount, l); if (!v.ok) return v;
        if (website && side === 'SELLER') { const m = validateDealAccess(c.dealAccess, 'Code or link for your counter'); if (m) return Object.assign(err('DEAL_ACCESS_REQUIRED', m), { fields: { dealAccess: m } }); }
        const o = addOffer(s, n, side, amount, now, l);
        if (website && side === 'SELLER') o.dealAccess = cleanDeal(c.dealAccess);
        if (side === 'SELLER') notify(s, n.buyerId, 'buyer', `Seller countered ${fmt(amount)} for ${l.title}.`, { type: 'negotiation', id: n.id }, now);
        else applyAutomation(s, n, now);
        return { ok: true };
      }
      return err('INVALID_ACTION', 'Unknown action.');
    },
    'offer.withdraw'(s, c, now) {
      const n = s.negotiations[c.negotiationId]; if (!n || n.buyerId !== c.userId) return err('NOT_FOUND', 'Negotiation not found.');
      const last = latest(n);
      if (n.status !== 'OPEN' || last.status !== 'PENDING' || last.by !== 'BUYER') return err('CANT_WITHDRAW', 'You can withdraw only your own pending offer.');
      closeNeg(s, n, 'WITHDRAWN', 'WITHDRAWN', now, 'BUYER');
      notify(s, s.listings[n.listingId].ownerUserId, 'seller', `Buyer withdrew a ${fmt(last.amount)} offer for ${s.listings[n.listingId].title}.`, { type: 'negotiation', id: n.id }, now);
      return { ok: true };
    },

    'order.place'(s, c, now) {
      const u = s.users[c.userId]; const p = s.buyerProfiles[c.userId];
      if (!u || !p) return err('NO_PROFILE', 'Complete your buyer profile first.');
      let l, v, price, source, n = null;
      if (c.negotiationId) {
        n = s.negotiations[c.negotiationId];
        if (!n || n.buyerId !== u.id) return err('NOT_FOUND', 'Agreement not found.');
        if (n.status !== 'AGREED') return err('NOT_AGREED', n.status === 'LAPSED' ? 'The checkout window for this price has closed.' : 'This offer hasn’t been agreed.');
        l = s.listings[n.listingId]; v = variantOf(l, n.variantId); price = n.agreement.price; source = 'NEGOTIATED';
      } else {
        l = s.listings[c.listingId]; if (!l || l.status !== 'ACTIVE') return err('NOT_AVAILABLE', 'This listing isn’t available.');
        if (l.ownerUserId === u.id) return err('OWN_LISTING', 'You can’t buy your own listing.');
        if (channelOf(l) === 'WEBSITE') return err('USE_WEBSITE', 'This seller sells through their website. Use Buy on website.');
        v = variantOf(l, c.variantId); if (!v) return err('NO_VARIANT', 'Choose a size.');
        if (available(s, l, v, now) < 1) return err('OUT_OF_STOCK', 'This size just sold out.');
        price = l.price; source = 'LIST';
      }
      const channel = channelOf(l); let addr = null, method = null;
      if (channel === 'DIRECT') {
        addr = p.addresses.find((a) => a.id === c.addressId); if (!addr) return err('NO_ADDRESS', 'Choose a delivery address.');
        const methods = directMethods(s.paymentProfiles[l.sellerId]);
        if (!methods.includes(c.paymentMethod)) return err('NO_METHOD', 'Choose how you’ll pay the seller.');
        method = c.paymentMethod;
      }
      if (n) { const r = s.reservations[n.agreement.reservationId]; if (r) r.status = 'CONSUMED'; n.status = 'PURCHASED'; n.closeReason = 'PURCHASED'; n.updatedAt = now; event(n, 'PURCHASED', 'BUYER', now); }
      v.stock -= 1;
      s.orderSeq = (s.orderSeq || 10000) + 1;
      const o = { id: newId(s, 'or'), number: 'FY-' + s.orderSeq, buyerId: u.id, sellerId: l.sellerId, sellerUserId: l.ownerUserId, listingId: l.id, variantId: v.id, variantLabel: v.label, title: l.title, media: l.media[0] || null, listPrice: l.price, price, priceSource: source, negotiationId: n ? n.id : null,
        channel, paymentMethod: method, address: addr ? clone(addr) : null, dealAccess: n && n.agreement.dealAccess ? clone(n.agreement.dealAccess) : null, productUrl: channel === 'WEBSITE' ? l.checkout.productUrl : null,
        status: 'PLACED', confirmBy: now + RULES.ORDER_CONFIRM_WINDOW_HOURS * HOUR, events: [{ status: 'PLACED', at: now }], shipment: null, createdAt: now };
      s.orders[o.id] = o;
      notify(s, u.id, 'buyer', channel === 'WEBSITE' ? `Order ${o.number} started on ${s.sellers[l.sellerId].name}’s website. The seller will confirm it here.` : `Order ${o.number} placed: pay ${fmt(price)} to ${s.sellers[l.sellerId].name} by ${PAY_METHODS[method]}. The seller confirms once it arrives.`, { type: 'order', id: o.id }, now);
      notify(s, l.ownerUserId, 'seller', channel === 'WEBSITE' ? `Order ${o.number}: a buyer is using your ${fmt(price)} deal on your website. Confirm it once you see the order.` : `New order ${o.number}: ${l.title} (${v.label}) — ${fmt(price)} by ${PAY_METHODS[method]}. Confirm when you receive the payment.`, { type: 'order', id: o.id }, now);
      invalidateIfSoldOut(s, l, v, now);
      return { ok: true, orderId: o.id, url: o.productUrl };
    },
    'order.confirm'(s, c, now) {
      const o = s.orders[c.orderId]; if (!o || o.sellerUserId !== c.userId) return err('NOT_FOUND', 'Order not found.');
      if (o.status !== 'PLACED') return err('INVALID_STATE', 'This order is no longer waiting for confirmation.');
      let sh = null;
      if (c.shipment && hasShipment(c.shipment)) { const v = validateShipment(c.shipment); if (v.fields) return Object.assign(err('VALIDATION', 'Check the shipment details.'), { fields: v.fields }); sh = v.clean; }
      o.status = 'CONFIRMED'; o.confirmedAt = now; o.events.push({ status: 'CONFIRMED', at: now });
      notify(s, o.buyerId, 'buyer', o.channel === 'WEBSITE' ? `Order ${o.number} confirmed by the seller: ${o.title}.` : `Payment received for ${o.number}. The seller is processing your order.`, { type: 'order', id: o.id }, now);
      if (sh) { o.shipment = sh; o.status = 'SHIPPED'; o.events.push({ status: 'SHIPPED', at: now }); notify(s, o.buyerId, 'buyer', `Order ${o.number} shipped${sh.carrier ? ' via ' + sh.carrier : ''}.`, { type: 'order', id: o.id }, now); }
      return { ok: true };
    },
    'order.ship'(s, c, now) {
      const o = s.orders[c.orderId]; if (!o || o.sellerUserId !== c.userId) return err('NOT_FOUND', 'Order not found.');
      if (!['CONFIRMED', 'SHIPPED'].includes(o.status)) return err('INVALID_STATE', 'Confirm the order before adding shipment details.');
      const v = validateShipment(c.shipment || {}); if (v.fields) return Object.assign(err('VALIDATION', 'Check the shipment details.'), { fields: v.fields });
      const first = o.status === 'CONFIRMED'; o.shipment = v.clean;
      if (first) { o.status = 'SHIPPED'; o.events.push({ status: 'SHIPPED', at: now }); }
      notify(s, o.buyerId, 'buyer', first ? `Order ${o.number} shipped${v.clean.carrier ? ' via ' + v.clean.carrier : ''}.` : `Shipment details updated for ${o.number}.`, { type: 'order', id: o.id }, now);
      return { ok: true };
    },
    'order.deliver'(s, c, now) {
      const o = s.orders[c.orderId]; if (!o || o.sellerUserId !== c.userId) return err('NOT_FOUND', 'Order not found.');
      if (!['CONFIRMED', 'SHIPPED'].includes(o.status)) return err('INVALID_STATE', 'Only confirmed orders can be marked delivered.');
      o.status = 'DELIVERED'; o.events.push({ status: 'DELIVERED', at: now });
      notify(s, o.buyerId, 'buyer', `Order ${o.number} marked delivered by the seller: ${o.title}.`, { type: 'order', id: o.id }, now);
      return { ok: true };
    },
    'order.cancel'(s, c, now) {
      const o = s.orders[c.orderId]; if (!o || o.sellerUserId !== c.userId) return err('NOT_FOUND', 'Order not found.');
      if (!['PLACED', 'CONFIRMED'].includes(o.status)) return err('INVALID_STATE', 'Shipped or finished orders can’t be cancelled here.');
      if (!CANCEL_REASONS[c.reason]) return Object.assign(err('VALIDATION', 'Choose a reason.'), { fields: { reason: 'Choose a reason.' } });
      const note = String(c.note || '').trim().slice(0, 200);
      o.status = 'CANCELLED'; o.cancelReason = c.reason; o.cancelNote = note; o.events.push({ status: 'CANCELLED', at: now });
      if (c.reason !== 'OUT_OF_STOCK') restock(s, o); else o.restocked = true;
      notify(s, o.buyerId, 'buyer', `Order ${o.number} was cancelled by the seller: ${CANCEL_REASONS[c.reason]}${note ? ' — ' + note : ''}.`, { type: 'order', id: o.id }, now);
      return { ok: true };
    },
    'notifications.markRead'(s, c) { s.notifications.forEach((x) => { if (x.userId === c.userId && x.app === c.app) x.read = true; }); return { ok: true }; },
    'clock.advance'(s, c) { const ms = Number(c.ms); if (!(ms > 0) || ms > 30 * DAY) return err('INVALID', 'Invalid time skip.'); s.clockOffsetMs += ms; return { ok: true }; },
    'system.sweep'() { return { ok: true }; }
  };

  function validateSeller(s, c, selfId) {
    const f = {};
    if (!['BUSINESS', 'INDIVIDUAL'].includes(c.sellerType)) f.sellerType = 'Choose business or individual.';
    const name = String(c.name || '').trim(); if (name.length < 2 || name.length > 60) f.name = 'Enter your shop name (2–60 characters).';
    const handle = String(c.handle || '').trim().toLowerCase();
    if (!HANDLE_RE.test(handle)) f.handle = 'Use 3–24 lowercase letters, numbers, dots or underscores.';
    else if (values(s.sellers).some((x) => x.handle === handle && x.id !== selfId)) f.handle = 'That handle is taken.';
    if (!String(c.area || '').trim()) f.area = 'Enter your area or locality.';
    const gstin = String(c.gstin || '').trim().toUpperCase();
    if (gstin && !GSTIN_RE.test(gstin)) f.gstin = 'Enter a valid 15-character GSTIN, or leave it blank.';
    if (String(c.bio || '').length > 160) f.bio = 'Keep it under 160 characters.';
    return f;
  }
  function sellerFields(c) {
    return { type: c.sellerType, name: String(c.name).trim(), handle: String(c.handle).trim().toLowerCase(), area: String(c.area).trim(), city: String(c.city || 'Hyderabad').trim() || 'Hyderabad', gstin: String(c.gstin || '').trim().toUpperCase() || null, bio: String(c.bio || '').trim() };
  }
  function toggle(s, table, userId, key, target) {
    if (!target) return err('NOT_FOUND', 'Not found.'); if (!s.users[userId]) return err('NO_USER', 'Sign in first.');
    const k = userId + '|' + key; if (s[table][k]) delete s[table][k]; else s[table][k] = true; return { ok: true, on: !!s[table][k] };
  }

  /** Execute one command atomically against a copy of the state. Failed commands leave state untouched. */
  function exec(state, cmd, now) {
    const h = handlers[cmd && cmd.type]; if (!h) return { state, result: err('UNKNOWN_COMMAND', 'Unknown command.') };
    const s = clone(state);
    sweep(s, now);
    const result = h(s, cmd, now);
    if (!result.ok) return { state, result };
    sweep(s, now);
    return { state: s, result };
  }
  function runSweep(state, now) { const s = clone(state); return sweep(s, now) ? s : null; }

  // ---------- read models (audience-scoped DTOs) ----------
  const mask = (id) => 'Buyer ' + (id.replace(/[^a-z0-9]/gi, '').slice(-3).toUpperCase());
  const likeCount = (s, id) => (s.listings[id].seedLikes || 0) + Object.keys(s.likes).filter((k) => k.endsWith('|' + id)).length;
  const commentCount = (s, id) => s.comments.filter((c) => c.listingId === id).length;

  function sellerStats(s, sellerId) {
    const os = values(s.orders).filter((o) => o.sellerId === sellerId);
    const times = os.filter((o) => o.confirmedAt).map((o) => o.confirmedAt - o.createdAt).sort((a, b) => a - b);
    const median = times.length ? times[Math.floor((times.length - 1) / 2)] : null;
    return { orders: os.length, completed: os.filter((o) => o.status === 'DELIVERED').length, confirmed: os.filter((o) => o.confirmedAt).length, cancelled: os.filter((o) => o.status === 'CANCELLED').length, expired: os.filter((o) => o.status === 'EXPIRED').length, medianConfirmMs: median };
  }
  function sellerPublic(s, sellerId, viewerId) {
    const x = s.sellers[sellerId];
    return { id: x.id, name: x.name, handle: x.handle, type: x.type, area: x.area, city: x.city, verification: x.verification, bio: x.bio, following: !!s.follows[viewerId + '|' + x.id], followers: Object.keys(s.follows).filter((k) => k.endsWith('|' + x.id)).length, isMe: x.userId === viewerId, stats: sellerStats(s, x.id) };
    // NOTE: payment details are never part of the public seller view.
  }
  function paymentForBuyer(s, sellerId) {
    const p = s.paymentProfiles[sellerId]; if (!p) return null;
    return { upiId: p.upiId, upiQrMediaId: p.upiQrMediaId, bank: p.bankAccount ? { holder: p.bankHolder, account: p.bankAccount, ifsc: p.bankIfsc, bankName: p.bankName } : null, paymentLink: p.paymentLink, payeeName: s.sellers[sellerId].name };
  }
  function listingBuyerDTO(s, l, viewerId, now) {
    const variants = l.variants.map((v) => ({ id: v.id, label: v.label, available: available(s, l, v, now) > 0, low: available(s, l, v, now) > 0 && available(s, l, v, now) <= 2 }));
    return {
      id: l.id, title: l.title, description: l.description, category: l.category, price: l.price, media: l.media, status: l.status,
      soldOut: !variants.some((v) => v.available), variants,
      bargaining: { mode: l.bargaining.mode, acceptsOffers: l.bargaining.mode !== 'FIXED', expiryHours: l.bargaining.expiryHours },
      checkout: channelOf(l) === 'WEBSITE' ? { channel: 'WEBSITE', productUrl: l.checkout.productUrl } : { channel: 'DIRECT', methods: directMethods(s.paymentProfiles[l.sellerId]) },
      seller: sellerPublic(s, l.sellerId, viewerId), likes: likeCount(s, l.id), comments: commentCount(s, l.id),
      liked: !!s.likes[viewerId + '|' + l.id], saved: !!s.saves[viewerId + '|' + l.id], publishedAt: l.publishedAt || l.createdAt, isMine: l.ownerUserId === viewerId
    };
    // NOTE: s.privateRules is intentionally never read here.
  }
  function statusLabel(n) {
    if (n.status === 'OPEN') { const last = latest(n); return sideOf(last.by) === 'BUYER' ? 'Waiting for seller' : 'Seller countered'; }
    return { AGREED: 'Agreed', PURCHASED: 'Purchased', LAPSED: 'Lapsed', CLOSED: CLOSE_TEXT[n.closeReason] || 'Closed' }[n.status];
  }
  function negBuyerDTO(s, n, viewerId, now) {
    const l = s.listings[n.listingId]; const v = variantOf(l, n.variantId); const last = latest(n);
    const myTurn = n.status === 'OPEN' && last.status === 'PENDING' && sideOf(last.by) === 'SELLER';
    const myLast = lastBySide(n, 'BUYER');
    return {
      id: n.id, status: n.status, statusLabel: statusLabel(n), visibility: n.visibility, closeReason: n.closeReason || null, closeText: n.closeReason ? CLOSE_TEXT[n.closeReason] : null,
      listing: { id: l.id, title: l.title, price: l.price, media: l.media[0] || null, sellerName: s.sellers[l.sellerId].name, status: l.status },
      variant: { id: v ? v.id : n.variantId, label: v ? v.label : '—' },
      offers: n.offers.map((o) => ({ id: o.id, side: sideOf(o.by) === 'BUYER' ? 'ME' : 'SELLER', amount: o.amount, status: o.status, at: o.at, expiresAt: o.expiresAt })),
      events: n.events.filter((e) => ['CLOSED', 'LAPSED', 'PURCHASED', 'ACCEPTED'].includes(e.type)).map((e) => ({ type: e.type, at: e.at, actor: e.actor === 'SYSTEM' ? 'AUTO' : sideOf(e.actor) === 'BUYER' ? 'ME' : 'SELLER', reason: e.reason || null })),
      pendingExpiresAt: n.status === 'OPEN' ? last.expiresAt : null,
      agreement: n.agreement ? { price: n.agreement.price, deadline: n.agreement.deadline, automatic: n.agreement.acceptedBy === 'SYSTEM', dealAccess: n.agreement.dealAccess ? clone(n.agreement.dealAccess) : null } : null,
      channel: channelOf(l), productUrl: channelOf(l) === 'WEBSITE' ? l.checkout.productUrl : null,
      canRespond: myTurn, canCounter: myTurn && n.offers.length < RULES.MAX_OFFERS_PER_NEGOTIATION,
      canWithdraw: n.status === 'OPEN' && last.status === 'PENDING' && last.by === 'BUYER',
      counterBounds: myTurn ? { minExclusive: myLast ? myLast.amount : 0, maxExclusive: last.amount } : null,
      updatedAt: n.updatedAt, offersLeft: RULES.MAX_OFFERS_PER_NEGOTIATION - n.offers.length
    };
    // NOTE: whether a counter was automatic, offer.autoDeclineAt and pending auto-counters are intentionally omitted.
  }

  const buyer = {
    feed(s, userId, now, opts) {
      opts = opts || {};
      let ls = values(s.listings).filter((l) => l.status === 'ACTIVE');
      if (opts.tab === 'following') ls = ls.filter((l) => s.follows[userId + '|' + l.sellerId]);
      if (opts.category && opts.category !== 'All') ls = ls.filter((l) => l.category === opts.category);
      const score = (l) => likeCount(s, l.id) * 2 + commentCount(s, l.id) * 3 - (now - (l.publishedAt || l.createdAt)) / HOUR * 0.5;
      return ls.map((l) => ({ l, sc: score(l) })).sort((a, b) => b.sc - a.sc).map((x) => listingBuyerDTO(s, x.l, userId, now)).sort((a, b) => Number(a.soldOut) - Number(b.soldOut));
    },
    search(s, userId, now, q) {
      const text = String(q.text || '').trim().toLowerCase();
      return values(s.listings).filter((l) => l.status === 'ACTIVE').filter((l) => {
        const sel = s.sellers[l.sellerId];
        if (text && !(l.title + ' ' + l.description + ' ' + sel.name + ' ' + sel.handle + ' ' + l.category).toLowerCase().includes(text)) return false;
        if (q.category && q.category !== 'All' && l.category !== q.category) return false;
        if (q.maxPrice && l.price > q.maxPrice) return false;
        if (q.offersOnly && l.bargaining.mode === 'FIXED') return false;
        if (q.sellerType && sel.type !== q.sellerType) return false;
        if (q.size && !l.variants.some((v) => v.label.toLowerCase() === q.size.toLowerCase() && available(s, l, v, now) > 0)) return false;
        return true;
      }).sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0)).map((l) => listingBuyerDTO(s, l, userId, now));
    },
    sizes(s) { const set = new Set(); values(s.listings).forEach((l) => l.status === 'ACTIVE' && l.variants.forEach((v) => set.add(v.label))); return [...set]; },
    listing(s, userId, id, now) {
      const l = s.listings[id]; if (!l || (l.status === 'DRAFT')) return null;
      const dto = listingBuyerDTO(s, l, userId, now);
      dto.publicOffers = (l.bargaining.mode === 'PUBLIC' || l.bargaining.mode === 'BOTH') ? values(s.negotiations).filter((n) => n.listingId === l.id && n.visibility === 'PUBLIC').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8).map((n) => {
        const lastBuyer = lastBySide(n, 'BUYER');
        return { id: n.id, who: n.buyerId === userId ? 'You' : mask(n.buyerId), amount: lastBuyer.amount, status: statusLabel(n), variant: (variantOf(l, n.variantId) || {}).label, at: n.updatedAt };
      }) : [];
      dto.myNegotiations = values(s.negotiations).filter((n) => n.listingId === l.id && n.buyerId === userId).sort((a, b) => b.updatedAt - a.updatedAt).map((n) => ({ id: n.id, variantId: n.variantId, status: n.status, statusLabel: statusLabel(n) }));
      dto.platformFloor = Math.ceil(l.price * RULES.OFFER_MIN_RATIO / 100) * 100;
      return dto;
    },
    negotiations(s, userId, now) { return values(s.negotiations).filter((n) => n.buyerId === userId).sort((a, b) => b.updatedAt - a.updatedAt).map((n) => negBuyerDTO(s, n, userId, now)); },
    negotiation(s, userId, id, now) { const n = s.negotiations[id]; return n && n.buyerId === userId ? negBuyerDTO(s, n, userId, now) : null; },
    orders(s, userId) { return values(s.orders).filter((o) => o.buyerId === userId).sort((a, b) => b.createdAt - a.createdAt).map((o) => orderDTO(s, o, false)); },
    order(s, userId, id) { const o = s.orders[id]; return o && o.buyerId === userId ? orderDTO(s, o, o.status === 'PLACED' && o.channel === 'DIRECT') : null; },
    profile(s, userId, now) {
      const u = s.users[userId]; const p = s.buyerProfiles[userId]; if (!u) return null;
      const orders = values(s.orders).filter((o) => o.buyerId === userId);
      return {
        user: { id: u.id, name: u.name, phone: u.phone }, profile: p ? clone(p) : null,
        saved: Object.keys(s.saves).filter((k) => k.startsWith(userId + '|')).map((k) => s.listings[k.split('|')[1]]).filter((l) => l && l.status !== 'DRAFT').map((l) => listingBuyerDTO(s, l, userId, now)),
        following: Object.keys(s.follows).filter((k) => k.startsWith(userId + '|')).map((k) => s.sellers[k.split('|')[1]]).filter(Boolean).map((x) => sellerPublic(s, x.id, userId)),
        savings: orders.reduce((t, o) => t + (o.listPrice - o.price), 0), orderCount: orders.length,
        hasShop: !!sellerOfUser(s, userId)
      };
    },
    shop(s, userId, sellerId, now) {
      if (!s.sellers[sellerId]) return null;
      return { seller: sellerPublic(s, sellerId, userId), listings: values(s.listings).filter((l) => l.sellerId === sellerId && l.status === 'ACTIVE').map((l) => listingBuyerDTO(s, l, userId, now)) };
    }
  };

  function orderDTO(s, o, withPayment) {
    const d = Object.assign(clone(o), { sellerName: s.sellers[o.sellerId].name, buyerName: (s.users[o.buyerId] || {}).name || 'Buyer', statusLabel: orderStatusLabel(o), cancelText: o.cancelReason ? CANCEL_REASONS[o.cancelReason] : null });
    if (withPayment) d.payTo = paymentForBuyer(s, o.sellerId);
    return d;
  }
  function orderStatusLabel(o) {
    const web = o.channel === 'WEBSITE';
    return { PLACED: web ? 'Awaiting seller confirmation' : 'Awaiting payment confirmation', CONFIRMED: web ? 'Confirmed' : 'Payment received', SHIPPED: 'Shipped', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', EXPIRED: 'Expired' }[o.status];
  }

  const common = {
    comments(s, listingId) {
      const l = s.listings[listingId];
      return s.comments.filter((c) => c.listingId === listingId).map((c) => ({ id: c.id, text: c.text, at: c.at, name: (s.users[c.userId] || {}).name || 'Someone', isSeller: l && c.userId === l.ownerUserId, shopName: l && c.userId === l.ownerUserId ? s.sellers[l.sellerId].name : null, userId: c.userId }));
    },
    notifications(s, userId, app) { return s.notifications.filter((n) => n.userId === userId && n.app === app); },
    unread(s, userId, app) { return s.notifications.filter((n) => n.userId === userId && n.app === app && !n.read).length; },
    user(s, userId) { const u = s.users[userId]; return u ? { id: u.id, name: u.name, phone: u.phone } : null; }
  };

  function negSellerDTO(s, n, now) {
    const l = s.listings[n.listingId]; const v = variantOf(l, n.variantId); const last = latest(n);
    const myTurn = n.status === 'OPEN' && last.status === 'PENDING' && last.by === 'BUYER';
    const myLast = lastBySide(n, 'SELLER');
    const b = s.users[n.buyerId];
    return {
      id: n.id, status: n.status, statusLabel: n.status === 'OPEN' ? (myTurn ? (last.autoDeclineAt ? 'Auto-declining' : last.systemCounterDueAt ? 'Auto-countering' : 'Needs your reply') : 'Waiting for buyer') : statusLabel(n),
      visibility: n.visibility, closeReason: n.closeReason || null, closeText: n.closeReason ? CLOSE_TEXT[n.closeReason] : null,
      buyer: { id: b.id, name: b.name || 'Buyer', masked: mask(b.id) },
      listing: { id: l.id, title: l.title, price: l.price, media: l.media[0] || null },
      variant: { id: v ? v.id : n.variantId, label: v ? v.label : '—', available: v ? available(s, l, v, now) : 0 },
      offers: n.offers.map((o) => ({ id: o.id, side: sideOf(o.by) === 'SELLER' ? 'ME' : 'BUYER', automatic: o.by === 'SYSTEM', amount: o.amount, status: o.status, at: o.at, expiresAt: o.expiresAt, autoDeclineAt: o.autoDeclineAt || null, autoCounterDueAt: o.systemCounterDueAt || null, dealAccess: o.dealAccess ? clone(o.dealAccess) : null })),
      channel: channelOf(l),
      events: n.events.filter((e) => ['CLOSED', 'LAPSED', 'PURCHASED', 'ACCEPTED'].includes(e.type)).map((e) => ({ type: e.type, at: e.at, actor: e.actor === 'SYSTEM' ? 'AUTO' : sideOf(e.actor) === 'SELLER' ? 'ME' : 'BUYER', reason: e.reason || null })),
      pendingExpiresAt: n.status === 'OPEN' ? last.expiresAt : null,
      agreement: n.agreement ? clone(n.agreement) : null,
      canRespond: myTurn, canCounter: myTurn && n.offers.length < RULES.MAX_OFFERS_PER_NEGOTIATION,
      counterBounds: myTurn ? { minExclusive: last.amount, maxExclusive: myLast ? myLast.amount : l.price } : null,
      rules: clone(s.privateRules[l.id] || {}), updatedAt: n.updatedAt, offersLeft: RULES.MAX_OFFERS_PER_NEGOTIATION - n.offers.length
    };
  }

  const seller = {
    me(s, userId) { const x = sellerOfUser(s, userId); return x ? clone(x) : null; },
    listings(s, userId, now) {
      const x = sellerOfUser(s, userId); if (!x) return [];
      return values(s.listings).filter((l) => l.sellerId === x.id).sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt)).map((l) => seller.listingSummary(s, l, now));
    },
    listingSummary(s, l, now) {
      const negs = values(s.negotiations).filter((n) => n.listingId === l.id);
      return {
        id: l.id, title: l.title, status: l.status, price: l.price, media: l.media[0] || null, category: l.category, mode: l.bargaining.mode, channel: channelOf(l), websiteClicks: l.websiteClicks || 0,
        stock: l.variants.reduce((t, v) => t + v.stock, 0), available: l.variants.reduce((t, v) => t + available(s, l, v, now), 0),
        reserved: l.variants.reduce((t, v) => t + activeReservations(s, v.id, now), 0),
        views: l.views || 0, likes: likeCount(s, l.id), saves: Object.keys(s.saves).filter((k) => k.endsWith('|' + l.id)).length, comments: commentCount(s, l.id),
        offers: negs.length, openOffers: negs.filter((n) => n.status === 'OPEN').length,
        orders: values(s.orders).filter((o) => o.listingId === l.id).length
      };
    },
    listing(s, userId, id) {
      const x = sellerOfUser(s, userId); const l = s.listings[id]; if (!x || !l || l.sellerId !== x.id) return null;
      return Object.assign(clone(l), { rules: clone(s.privateRules[l.id] || {}), dealCodes: clone(s.dealCodes[l.id] || {}), checkout: clone(l.checkout || { channel: 'DIRECT' }) });
    },
    negotiations(s, userId, now) {
      const x = sellerOfUser(s, userId); if (!x) return [];
      return values(s.negotiations).filter((n) => n.sellerId === x.id).sort((a, b) => b.updatedAt - a.updatedAt).map((n) => negSellerDTO(s, n, now));
    },
    negotiation(s, userId, id, now) { const x = sellerOfUser(s, userId); const n = s.negotiations[id]; return x && n && n.sellerId === x.id ? negSellerDTO(s, n, now) : null; },
    orders(s, userId) {
      const x = sellerOfUser(s, userId); if (!x) return [];
      return values(s.orders).filter((o) => o.sellerId === x.id).sort((a, b) => b.createdAt - a.createdAt).map((o) => orderDTO(s, o, false));
    },
    order(s, userId, id) { const x = sellerOfUser(s, userId); const o = s.orders[id]; return x && o && o.sellerId === x.id ? orderDTO(s, o, false) : null; },
    payment(s, userId) { const x = sellerOfUser(s, userId); return x ? clone(s.paymentProfiles[x.id] || {}) : null; },
    stats(s, userId) { const x = sellerOfUser(s, userId); return x ? sellerStats(s, x.id) : null; },
    dashboard(s, userId, now) {
      const ls = seller.listings(s, userId, now); const negs = seller.negotiations(s, userId, now); const orders = seller.orders(s, userId);
      return {
        totals: { views: ls.reduce((t, l) => t + l.views, 0), likes: ls.reduce((t, l) => t + l.likes, 0), offers: negs.length, orders: orders.length, revenue: orders.filter((o) => ['CONFIRMED', 'SHIPPED', 'DELIVERED'].includes(o.status)).reduce((t, o) => t + o.price, 0), bargained: orders.filter((o) => o.priceSource === 'NEGOTIATED').length, websiteClicks: ls.reduce((t, l) => t + l.websiteClicks, 0) },
        needsReply: negs.filter((n) => n.statusLabel === 'Needs your reply').length,
        toConfirm: orders.filter((o) => o.status === 'PLACED').length, toShip: orders.filter((o) => o.status === 'CONFIRMED').length,
        active: ls.filter((l) => l.status === 'ACTIVE').length, drafts: ls.filter((l) => l.status === 'DRAFT').length,
        top: ls.filter((l) => l.status === 'ACTIVE').sort((a, b) => (b.views + b.likes * 3 + b.offers * 5) - (a.views + a.likes * 3 + a.offers * 5)).slice(0, 3)
      };
    }
  };

  root.FaydaEngine = { RULES, CATEGORIES, MODES, ORDER_FLOW, CANCEL_REASONS, PAY_METHODS, validatePayment, HOUR, DAY, emptyState, exec, runSweep, buyer, seller, common, fmt, validateListingDraft, normPhone };
})(typeof window !== 'undefined' ? window : globalThis);
