/* Fayda Seller app (prototype). */
(function () {
  'use strict';
  const U = window.FaydaUI; const { h, E, Store, Media, money, left, ago, when, pctOff, Icon, MediaView, Btn, Field, Input, Chip, Seg, Badge, Empty, Page, Sheet, Confirm, Thumb, Avatar, Kv, useToast, useNav, AppCtx, useApp, BRAND } = U;
  const { useState, useEffect, useRef } = React;
  const S = E.seller;

  function SellerApp() {
    const s = Store.state; const uid = s.sessions.seller;
    if (!uid || !s.users[uid]) return h(U.AuthFlow, { app: 'seller' });
    if (!S.me(s, uid)) return h(SellerOnboarding, { uid });
    return h(SellerMain, { uid });
  }

  // ---------- onboarding ----------
  function SellerOnboarding({ uid }) {
    const u = Store.state.users[uid];
    const [step, setStep] = useState('shop');
    const [v, setV] = useState({ sellerType: null, name: '', handle: '', area: '', city: 'Hyderabad', gstin: '', bio: '', ownerName: u.name || '' });
    const [pay, setPay] = useState({ upiId: '', upiQrMediaId: null, bankHolder: '', bankAccount: '', bankIfsc: '', bankName: '', paymentLink: '', website: '' });
    const [errors, setErrors] = useState({}); const [conduct, setConduct] = useState(false); const [toast, toastNode] = useToast(); const [touchedHandle, setTouchedHandle] = useState(false);
    const SHOP_FIELDS = ['sellerType', 'name', 'handle', 'area', 'city', 'gstin', 'bio', 'ownerName'];
    const set = (k) => (e) => { const val = e.target.value; const next = Object.assign({}, v, { [k]: k === 'gstin' ? val.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15) : val }); if (k === 'name' && !touchedHandle) next.handle = val.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24); if (k === 'handle') setTouchedHandle(true); setV(next); setErrors(Object.assign({}, errors, { [k]: null })); };
    const nextFromShop = () => {
      const e = {};
      if (!v.sellerType) e.sellerType = 'Choose business or individual.';
      if (!u.name && v.ownerName.trim().length < 2) e.ownerName = 'Enter your name.';
      if (v.name.trim().length < 2) e.name = 'Enter your shop name (2–60 characters).';
      if (!/^[a-z0-9_.]{3,24}$/.test(v.handle)) e.handle = 'Use 3–24 lowercase letters, numbers, dots or underscores.';
      if (!v.area.trim()) e.area = 'Enter your area or locality.';
      if (Object.keys(e).length) { setErrors(e); return; }
      setErrors({}); setStep('pay');
    };
    const nextFromPay = () => { const r = E.validatePayment(pay); if (Object.keys(r.errors).length) { setErrors(r.errors); return; } setErrors({}); setConduct(true); };
    const register = () => {
      setConduct(false);
      if (!u.name) Store.dispatch({ type: 'user.updateName', userId: uid, name: v.ownerName });
      const r = Store.dispatch(Object.assign({ type: 'seller.register', userId: uid, conductAccepted: true, payment: pay }, v));
      if (!r.ok) { const f = r.fields || {}; setErrors(f); if (Object.keys(f).some((k) => SHOP_FIELDS.includes(k))) setStep('shop'); toast(r.message, true); }
    };
    const f = (k, label, extra, hint) => h(Field, { label, id: 'so-' + k, error: errors[k], hint }, h(Input, Object.assign({ id: 'so-' + k, value: v[k], invalid: !!errors[k], onChange: set(k) }, extra || {})));
    return h('div', { className: 'body' }, h('div', { className: 'screen' }, h('div', { className: 'pad stack', style: { gap: 16 } },
      step === 'shop' ? h(React.Fragment, null,
        h('div', null, h('div', { className: 'small muted strong' }, 'Step 1 of 2 · Your shop'), h('div', { className: 'h2' }, 'Tell buyers who you are')),
        h('div', { className: 'stack', style: { gap: 10 } },
          [['BUSINESS', 'Registered business', 'Boutiques, brands and retailers. Add your GSTIN if you have one.', 'store'], ['INDIVIDUAL', 'Individual seller', 'Home sellers and small resellers. No business registration needed.', 'user']].map(([k, t, d, ic]) => h('button', { key: k, className: 'choice', 'aria-pressed': v.sellerType === k, onClick: () => { setV(Object.assign({}, v, { sellerType: k })); setErrors(Object.assign({}, errors, { sellerType: null })); } }, h('div', { className: 'ic' }, h(Icon, { name: ic })), h('div', null, h('div', { className: 'strong', style: { fontSize: 16 } }, t), h('div', { className: 'small muted' }, d)))),
          errors.sellerType && h('div', { className: 'error' }, errors.sellerType)),
        !u.name && f('ownerName', 'Your name', { autoComplete: 'name' }),
        f('name', 'Shop name', { autoComplete: 'organization' }),
        f('handle', 'Shop handle', { autoCapitalize: 'none' }, 'Buyers see this as @' + (v.handle || 'yourshop')),
        h('div', { className: 'grid2' }, f('area', 'Area', { placeholder: 'e.g. Kondapur' }), f('city', 'City')),
        v.sellerType === 'BUSINESS' && f('gstin', 'GSTIN (optional)', { placeholder: '15 characters', autoCapitalize: 'characters' }, 'Stored only. GST verification isn’t part of this prototype.'),
        h(Field, { label: 'About your shop (optional)', id: 'so-bio', error: errors.bio }, h(Input, { id: 'so-bio', multiline: true, maxLength: 160, value: v.bio, onChange: set('bio') })))
      : h(React.Fragment, null,
        h('button', { className: 'iconbtn', onClick: () => { setStep('shop'); setErrors({}); }, 'aria-label': 'Back' }, h(Icon, { name: 'back' })),
        h('div', null, h('div', { className: 'small muted strong' }, 'Step 2 of 2 · Getting paid'), h('div', { className: 'h2' }, 'How will buyers pay you?'), h('div', { className: 'small muted', style: { marginTop: 4 } }, 'Add any that you use. You can change these later.')),
        h(U.PaymentForm, { value: pay, onChange: (x) => { setPay(x); setErrors({}); }, errors, idp: 'sop-' })))),
      h('div', { className: 'actionbar' }, h(Btn, { size: 'lg', block: true, onClick: step === 'shop' ? nextFromShop : nextFromPay }, 'Continue'), step === 'shop' && h('button', { className: 'btn ghost sm', onClick: () => Store.dispatch({ type: 'auth.signOut', app: 'seller' }) }, 'Use a different number')),
      conduct && h('div', { className: 'dialog', role: 'dialog', 'aria-label': 'Seller Code of Conduct' }, h('div', { style: { maxHeight: '90%', overflow: 'auto' } },
        h('div', { className: 'h3', style: { fontSize: 18 } }, 'Seller Code of Conduct'), h(Badge, { tone: 'accent' }, 'Draft — pending legal review'),
        h('ol', { className: 'small', style: { paddingLeft: 18, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 } }, h('li', null, 'List genuine products with accurate photos, videos and descriptions.'), h('li', null, 'Honour prices you agree with buyers, including coupon codes and discount links you give them.'), h('li', null, 'Confirm payments and orders promptly and keep stock accurate.'), h('li', null, 'Payment details you add must be your own. Deliver what buyers paid for, and refund them yourself if you can’t.'), h('li', null, 'Respond to buyers respectfully and resolve genuine complaints.')),
        h('div', { className: 'hint' }, `${BRAND} doesn’t handle payments, delivery or refunds. Enforcement and appeals are open policy decisions and aren’t part of this prototype.`),
        h('div', { className: 'btn-row' }, h(Btn, { kind: 'outline', onClick: () => { setConduct(false); toast('Registration cancelled. Nothing was saved.'); } }, 'Disagree'), h(Btn, { onClick: register }, 'Agree and register')))), toastNode);
  }

  // ---------- main ----------
  function SellerMain({ uid }) {
    const nav = useNav('home'); const [toast, toastNode] = useToast(); const [sheet, setSheet] = useState(null);
    const s = Store.state; const now = Store.now(); const dash = S.dashboard(s, uid, now); const unread = E.common.unread(s, uid, 'seller');
    const ctx = { app: 'seller', uid, nav, toast, unread, openSheet: (type, params) => setSheet({ type, params: params || {} }), closeSheet: () => setSheet(null) };
    const tabs = [['home', 'Home', 'chart'], ['listings', 'Listings', 'list'], ['offers', 'Offers', 'tag', dash.needsReply], ['orders', 'Orders', 'box', dash.toConfirm + dash.toShip], ['profile', 'Shop', 'store']];
    const Tab = { home: Dashboard, listings: ListingsScreen, offers: OffersInbox, orders: SellerOrders, profile: ShopProfile }[nav.tab];
    const Sh = sheet ? SHEETS[sheet.type] : null;
    return h(AppCtx.Provider, { value: ctx }, h('div', { className: 'body' },
      h(Tab, null),
      h('nav', { className: 'tabbar', 'aria-label': 'Seller app' }, tabs.map(([k, label, icon, dot]) => h('button', { key: k, className: 'tab', 'aria-current': nav.tab === k ? 'page' : undefined, onClick: () => nav.setTab(k) }, h(Icon, { name: icon, size: 22 }), label, dot ? h('span', { className: 'dot' }, dot) : null))),
      nav.stack.map((p, i) => i === nav.stack.length - 1 ? h(SCREENS[p.screen], Object.assign({ key: p.key }, p.params)) : null),
      Sh && h(Sh, sheet.params), toastNode));
  }
  function Bell() {
    const { nav, unread } = useApp();
    return h('button', { className: 'iconbtn', onClick: () => nav.go('notifications'), 'aria-label': `Notifications${unread ? `, ${unread} unread` : ''}` }, h(Icon, { name: 'bell', size: 20 }), unread ? h('span', { className: 'dot' }, unread) : null);
  }

  function Dashboard() {
    const { uid, nav } = useApp(); const s = Store.state; const now = Store.now(); const me = S.me(s, uid); const d = S.dashboard(s, uid, now);
    const actions = [[d.needsReply, d.needsReply === 1 ? 'offer needs your reply' : 'offers need your reply', () => nav.setTab('offers')], [d.toConfirm, d.toConfirm === 1 ? 'order waiting for your confirmation' : 'orders waiting for your confirmation', () => nav.setTab('orders')], [d.toShip, `order${d.toShip === 1 ? '' : 's'} to ship`, () => nav.setTab('orders')], [d.drafts, d.drafts === 1 ? 'draft isn’t published' : 'drafts aren’t published', () => nav.setTab('listings')]].filter((x) => x[0] > 0);
    return h('div', { className: 'screen' }, h(U.AppBar, { title: me.name, right: h(Bell) }), h('div', { className: 'pad stack' },
      h('div', { className: 'row between' }, h('div', null, h('div', { className: 'small muted' }, 'Hello, ' + (Store.state.users[uid].name || 'there').split(' ')[0]), h('div', { className: 'h2' }, actions.length ? 'Here’s what needs you' : 'You’re up to date')), h(Btn, { size: 'sm', onClick: () => nav.go('editor', {}) }, h(Icon, { name: 'plus', size: 18 }), 'New listing')),
      actions.length ? h('div', { className: 'stack', style: { gap: 8 } }, actions.map(([n, t, go], i) => h('button', { key: i, className: 'card tint row', style: { textAlign: 'left', color: 'var(--ink)' }, onClick: go }, h('span', { style: { fontSize: 22, fontWeight: 800, color: 'var(--accent)', minWidth: 28 } }, n), h('span', { className: 'grow strong' }, t), h(Icon, { name: 'back', size: 18, style: { transform: 'rotate(180deg)' } })))) : h('div', { className: 'small muted' }, 'New offers and orders will appear here.'),
      h('div', { className: 'section-title' }, 'All-time activity'),
      h('div', { className: 'stat-grid' }, [['Views', d.totals.views], ['Likes', d.totals.likes], ['Offers', d.totals.offers], ['Orders', d.totals.orders], ['Website visits', d.totals.websiteClicks], ['Confirmed sales', money(d.totals.revenue)]].map(([k, v]) => h('div', { key: k, className: 'stat' }, h('b', null, v), h('span', null, k)))),
      h('div', { className: 'hint' }, `Confirmed sales are orders you marked as paid or confirmed. ${BRAND} doesn’t see or handle the money.`),
      h('div', { className: 'section-title' }, 'Top listings'),
      d.top.length ? d.top.map((l) => h(ListingRow, { key: l.id, l })) : h(Empty, { icon: 'video', title: 'Publish your first listing', body: 'Add a video or photos, sizes, a price and your bargaining rules.', action: h(Btn, { onClick: () => nav.go('editor', {}) }, 'New listing') })));
  }

  function ListingRow({ l }) {
    const { nav } = useApp();
    return h('button', { className: 'listrow', style: { paddingLeft: 0, paddingRight: 0 }, onClick: () => nav.go('listing', { id: l.id }) }, h(Thumb, { m: l.media }),
      h('div', { className: 'grow' }, h('div', { className: 'strong ellipsis' }, l.title), h('div', { className: 'small' }, h('b', null, money(l.price)), ' · ', U.MODE_LABEL[l.mode], l.channel === 'WEBSITE' ? ' · via website' : ''), h('div', { className: 'tiny muted' }, `${l.available} available${l.reserved ? ` · ${l.reserved} reserved` : ''} · ${l.views} views · ${l.likes} likes · ${l.openOffers} open offer${l.openOffers === 1 ? '' : 's'}`)),
      h(Badge, { tone: l.status === 'ACTIVE' ? (l.available ? 'success' : 'danger') : l.status === 'DRAFT' ? '' : 'accent' }, l.status === 'ACTIVE' ? (l.available ? 'Live' : 'Sold out') : l.status === 'DRAFT' ? 'Draft' : 'Paused'));
  }

  function ListingsScreen() {
    const { uid, nav } = useApp(); const all = S.listings(Store.state, uid, Store.now()); const [f, setF] = useState('ACTIVE');
    const list = all.filter((l) => l.status === f); const count = (st) => all.filter((l) => l.status === st).length;
    return h('div', { className: 'screen' }, h(U.AppBar, { title: 'Listings', right: h('button', { className: 'iconbtn', onClick: () => nav.go('editor', {}), 'aria-label': 'New listing' }, h(Icon, { name: 'plus', size: 20 })) }),
      h('div', { style: { padding: '12px 16px' } }, h(Seg, { label: 'Status', value: f, onChange: setF, options: [{ value: 'ACTIVE', label: `Live (${count('ACTIVE')})` }, { value: 'PAUSED', label: `Paused (${count('PAUSED')})` }, { value: 'DRAFT', label: `Drafts (${count('DRAFT')})` }] })),
      h('div', { style: { padding: '0 16px' } }, list.length ? list.map((l) => h(ListingRow, { key: l.id, l })) : h(Empty, { icon: 'list', title: f === 'ACTIVE' ? 'No live listings' : f === 'PAUSED' ? 'No paused listings' : 'No drafts', body: f === 'DRAFT' ? 'Save a listing as a draft to finish it later.' : 'Publish a listing and it goes straight to the buyer feed.', action: h(Btn, { onClick: () => nav.go('editor', {}) }, 'New listing') })));
  }

  // ---------- listing detail ----------
  function ListingDetail({ id }) {
    const { uid, nav, toast } = useApp(); const s = Store.state; const now = Store.now();
    const l = S.listing(s, uid, id); const [confirm, setConfirm] = useState(null);
    if (!l) return h(Page, { title: 'Listing', onBack: nav.back }, h(Empty, { title: 'Listing not found' }));
    const sum = S.listingSummary(s, s.listings[id], now); const r = l.rules || {};
    const setStatus = (status) => { const res = Store.dispatch({ type: 'listing.setStatus', userId: uid, listingId: id, status }); toast(res.ok ? (status === 'PAUSED' ? 'Listing paused. Open offers were closed.' : 'Listing is live') : res.message, !res.ok); };
    const footer = h('div', { className: 'btn-row' }, h(Btn, { kind: 'outline', onClick: () => nav.go('editor', { id }) }, h(Icon, { name: 'edit', size: 18 }), 'Edit'),
      l.status === 'ACTIVE' ? h(Btn, { kind: 'dark', onClick: () => setConfirm('pause') }, 'Pause') : l.status === 'PAUSED' ? h(Btn, { onClick: () => setStatus('ACTIVE') }, 'Resume') : h(Btn, { kind: 'danger', onClick: () => setConfirm('delete') }, 'Delete draft'));
    return h(Page, { title: l.title, onBack: nav.back, footer },
      h('div', { className: 'gallery', style: { aspectRatio: '16 / 11' } }, h(MediaView, { m: l.media[0], active: true, controls: l.media[0] && l.media[0].kind === 'video' })),
      h('div', { className: 'pad stack' },
        h('div', { className: 'row between' }, h('div', null, h('div', { className: 'price' }, money(l.price)), h('div', { className: 'small muted' }, l.category + ' · ' + U.MODE_LABEL[l.bargaining.mode])), h(Badge, { tone: l.status === 'ACTIVE' ? 'success' : l.status === 'DRAFT' ? '' : 'accent' }, l.status === 'ACTIVE' ? 'Live' : l.status === 'DRAFT' ? 'Draft' : 'Paused')),
        h('div', { className: 'stat-grid' }, [['Views', sum.views], ['Likes', sum.likes], ['Saves', sum.saves], ['Comments', sum.comments], ['Offers', sum.offers], ['Orders', sum.orders]].map(([k, v]) => h('div', { key: k, className: 'stat' }, h('b', null, v), h('span', null, k)))),
        h('div', null, h('div', { className: 'section-title' }, 'Stock'), l.variants.map((v) => { const res = Object.values(s.reservations).filter((x) => x.variantId === v.id && x.status === 'ACTIVE' && x.expiresAt > now).length; return h(Kv, { key: v.id, k: v.label, v: `${v.stock} in stock${res ? ` · ${res} reserved for agreed offers` : ''}` }); })),
        h('div', { className: 'card small' }, h('b', null, l.checkout.channel === 'WEBSITE' ? 'Sold on your website. ' : 'Buyers pay you directly. '), l.checkout.channel === 'WEBSITE' ? h('a', { href: l.checkout.productUrl, target: '_blank', rel: 'noopener noreferrer' }, l.checkout.productUrl.replace(/^https:\/\//, '')) : 'They see your payment details after placing an order.', l.checkout.channel === 'WEBSITE' && h('div', { className: 'tiny muted', style: { marginTop: 4 } }, `${sum.websiteClicks} website visit${sum.websiteClicks === 1 ? '' : 's'} from ${BRAND}`)),
        l.bargaining.mode !== 'FIXED' && h('div', { className: 'rule' }, h('div', { className: 'private-note' }, h(Icon, { name: 'lock', size: 16 }), 'Private settings — buyers never see these'), h(RuleSummary, { price: l.price, rules: r, expiry: l.bargaining.expiryHours, website: l.checkout.channel === 'WEBSITE' }), l.checkout.channel === 'WEBSITE' && (l.dealCodes.accept || l.dealCodes.counter) && h('div', { className: 'small' }, [l.dealCodes.accept && `Automatic price code: ${l.dealCodes.accept.type === 'CODE' ? l.dealCodes.accept.value : 'discount link'}`, l.dealCodes.counter && `Automatic counter code: ${l.dealCodes.counter.type === 'CODE' ? l.dealCodes.counter.value : 'discount link'}`].filter(Boolean).join(' · '))),
        h('div', null, h('div', { className: 'section-title' }, 'Comments'), h(U.CommentsPanel, { listingId: id, userId: uid, compact: true }))),
      confirm === 'pause' && h(Confirm, { title: 'Pause this listing?', body: 'It disappears from the buyer feed and any open offers close. Agreed offers stay valid until their checkout window ends.', confirmLabel: 'Pause listing', onCancel: () => setConfirm(null), onConfirm: () => { setConfirm(null); setStatus('PAUSED'); } }),
      confirm === 'delete' && h(Confirm, { title: 'Delete this draft?', body: 'This can’t be undone.', confirmLabel: 'Delete', danger: true, onCancel: () => setConfirm(null), onConfirm: () => { setConfirm(null); const res = Store.dispatch({ type: 'listing.delete', userId: uid, listingId: id }); if (res.ok) { nav.back(); toast('Draft deleted'); } else toast(res.message, true); } }));
  }

  function RuleSummary({ price, rules, expiry, website }) {
    const A = rules.autoAcceptAt, D = rules.autoDeclineBelow, C = rules.autoCounterAt; const lines = [];
    if (A != null) lines.push(`Offers of ${money(A)} or more are accepted automatically (up to ${pctOff(price, A)}% off)${website ? ` at ${money(A)}, the price your code gives` : ''}.`);
    if (C != null) lines.push(`${A != null ? 'Offers below that' : `Offers below ${money(C)}`} get your counter of ${money(C)} a few seconds later, every time. Buyers see it as your own reply.`);
    if (D != null) lines.push(`Offers below ${money(D)} are declined automatically after a short delay.`);
    lines.push(A == null && C == null && D == null ? 'Every offer comes to you to accept, counter or decline.' : 'Anything else comes to you to decide.');
    lines.push(`Unanswered offers expire after ${expiry} hours.`);
    return h('div', { className: 'small', style: { display: 'flex', flexDirection: 'column', gap: 4 } }, lines.map((t, i) => h('div', { key: i }, t)));
  }

  // ---------- listing editor (publish flow) ----------
  const toStr = (p) => (p == null ? '' : String(Math.round(p / 100)));
  function ListingEditor({ id }) {
    const { uid, nav, toast } = useApp(); const s = Store.state;
    const pay = S.payment(s, uid) || {}; const hasDirect = !!(pay.upiId || pay.upiQrMediaId || pay.bankAccount || pay.paymentLink);
    const existing = id ? S.listing(s, uid, id) : null; const summary = existing ? S.listingSummary(s, s.listings[id], Store.now()) : null;
    const [d, setD] = useState(() => existing ? {
      title: existing.title, description: existing.description, category: existing.category, price: toStr(existing.price), media: existing.media.slice(),
      variants: existing.variants.map((v) => ({ id: v.id, label: v.label, stock: String(v.stock) })), bargaining: Object.assign({}, existing.bargaining),
      rules: { autoAcceptAt: toStr(existing.rules.autoAcceptAt), autoDeclineBelow: toStr(existing.rules.autoDeclineBelow), autoCounterAt: toStr(existing.rules.autoCounterAt) },
      checkout: Object.assign({ productUrl: '' }, existing.checkout), dealCodes: { accept: existing.dealCodes.accept || null, counter: existing.dealCodes.counter || null }
    } : { title: '', description: '', category: 'Ethnic wear', price: '', media: [], variants: [{ label: 'S', stock: '' }, { label: 'M', stock: '' }, { label: 'L', stock: '' }], bargaining: { mode: 'BOTH', expiryHours: 24 }, rules: { autoAcceptAt: '', autoDeclineBelow: '', autoCounterAt: '' }, checkout: { channel: hasDirect ? 'DIRECT' : 'WEBSITE', productUrl: pay.website ? pay.website.replace(/\/$/, '') + '/' : '' }, dealCodes: { accept: null, counter: null } });
    const [errors, setErrors] = useState({}); const [busy, setBusy] = useState(false); const [mediaMsg, setMediaMsg] = useState(null); const [advanced, setAdvanced] = useState(!!(existing && (existing.rules.autoDeclineBelow != null || existing.rules.autoCounterAt != null)));
    const fileRef = useRef(null);
    const set = (patch) => { setD(Object.assign({}, d, patch)); };
    const clearErr = (k) => errors[k] && setErrors(Object.assign({}, errors, { [k]: null }));
    const num = (v) => v.replace(/[^0-9]/g, '').slice(0, 8);

    async function addFiles(files) {
      setMediaMsg(null); let media = d.media.slice(); const notes = [];
      for (const f of Array.from(files)) {
        if (media.length >= 6) { notes.push('Up to 6 media items per listing.'); break; }
        const isV = f.type.startsWith('video/'), isI = f.type.startsWith('image/');
        if (!isV && !isI) { notes.push(`${f.name}: choose a video or photo.`); continue; }
        if (isI && f.size > 15e6) { notes.push(`${f.name}: photos can be up to 15 MB.`); continue; }
        if (isV && f.size > 80e6) { notes.push(`${f.name}: videos can be up to 80 MB in the prototype.`); continue; }
        if (isV) { const dur = await videoDuration(f); if (dur > 61) { notes.push(`${f.name}: reels can be up to 60 seconds (this one is ${Math.round(dur)} s).`); continue; } if (!(dur > 0)) notes.push(`${f.name}: couldn’t read the video length — it may not play in this browser.`); }
        setBusy(true); const r = await Media.put(f); setBusy(false);
        if (!r.persisted) notes.push('This browser couldn’t store the file, so it will disappear on reload.');
        media.push({ kind: isV ? 'video' : 'image', mediaId: r.id });
      }
      setD((cur) => Object.assign({}, cur, { media })); clearErr('media'); if (notes.length) setMediaMsg(notes.join(' '));
    }
    const addSample = () => { if (d.media.length >= 6) return; const pal = U.PALETTE_NAMES[(d.media.length + d.title.length) % U.PALETTE_NAMES.length]; set({ media: d.media.concat([{ kind: 'seed', scene: U.SCENE_FOR_CATEGORY[d.category] || 'kurta', palette: pal }]) }); clearErr('media'); };
    const move = (i, dir) => { const m = d.media.slice(); const j = i + dir; if (j < 0 || j >= m.length) return; [m[i], m[j]] = [m[j], m[i]]; set({ media: m }); };

    const save = (publish) => {
      const draft = Object.assign({}, d, { price: d.price === '' ? NaN : Number(d.price), variants: d.variants.map((v) => ({ id: v.id, label: v.label, stock: v.stock === '' ? 0 : Number(v.stock) })), rules: advanced ? d.rules : Object.assign({}, d.rules, { autoDeclineBelow: '', autoCounterAt: '' }) });
      const r = Store.dispatch({ type: 'listing.save', userId: uid, listingId: id || null, draft, publish });
      if (!r.ok) { setErrors(r.fields || {}); toast(r.message, true); return; }
      nav.replace('listing', { id: r.listingId });
      toast(publish ? (existing && existing.status === 'ACTIVE' ? 'Changes saved' : 'Published — it’s in the buyer feed now') : existing && existing.status !== 'DRAFT' ? 'Changes saved' : 'Draft saved');
    };
    const live = existing && existing.status !== 'DRAFT';
    const P = Number(d.price) || 0; const A = d.rules.autoAcceptAt === '' ? null : Number(d.rules.autoAcceptAt);
    const footer = h('div', { className: live ? '' : 'btn-row' }, !live && h(Btn, { kind: 'outline', onClick: () => save(false), disabled: busy }, 'Save draft'), h(Btn, { block: live, onClick: () => save(!existing || existing.status === 'DRAFT'), disabled: busy }, busy ? 'Uploading…' : live ? 'Save changes' : 'Publish'));
    const presets = [['S–XL', ['S', 'M', 'L', 'XL']], ['One size', ['One size']], ['UK 6–9', ['6', '7', '8', '9']]];
    return h(Page, { title: existing ? 'Edit listing' : 'New listing', onBack: nav.back, footer },
      h('div', { className: 'pad stack', style: { gap: 18 } },
        h('div', null, h('div', { className: 'label', style: { marginBottom: 8 } }, 'Video and photos'),
          h('div', { className: 'upload-grid' },
            d.media.map((m, i) => h('div', { key: (m.mediaId || m.scene) + i, className: 'upload-cell' }, h(MediaView, { m, small: true }), h('button', { className: 'x', 'aria-label': 'Remove', onClick: () => set({ media: d.media.filter((_, j) => j !== i) }) }, h(Icon, { name: 'x', size: 14 })), h('span', { className: 'kind' }, h(Badge, { tone: 'dark' }, i === 0 ? 'Cover' : m.kind === 'seed' ? 'Sample' : m.kind === 'video' ? 'Video' : 'Photo')), i > 0 && h('button', { className: 'x', style: { right: 'auto', left: 4 }, 'aria-label': 'Make cover', onClick: () => move(i, -i) }, h(Icon, { name: 'back', size: 14, style: { transform: 'rotate(90deg)' } })))),
            d.media.length < 6 && h('label', { className: 'upload-add' }, h(Icon, { name: 'upload' }), busy ? 'Uploading…' : 'Add video or photos', h('input', { ref: fileRef, type: 'file', accept: 'video/*,image/*', multiple: true, style: { display: 'none' }, onChange: (e) => { addFiles(e.target.files); e.target.value = ''; } }))),
          h('div', { className: 'row wrap', style: { marginTop: 8, gap: 6 } }, h('span', { className: 'hint grow' }, 'Reels up to 60 s. The first item is the cover in the feed.'), h('button', { className: 'btn ghost sm', style: { padding: 0 }, onClick: addSample }, 'No media handy? Use sample artwork')),
          mediaMsg && h('div', { className: 'hint', style: { color: 'var(--accent-strong)' } }, mediaMsg), errors.media && h('div', { className: 'error' }, errors.media),
          h('div', { className: 'hint' }, 'Prototype: files stay in this browser. Real uploads go to Cloudflare in production.')),
        h(Field, { label: 'Product name', id: 'le-title', error: errors.title }, h(Input, { id: 'le-title', value: d.title, maxLength: 80, invalid: !!errors.title, onChange: (e) => { set({ title: e.target.value }); clearErr('title'); } })),
        h('div', null, h('div', { className: 'label', style: { marginBottom: 8 } }, 'Category'), h('div', { className: 'chips' }, E.CATEGORIES.map((c) => h(Chip, { key: c, on: d.category === c, onClick: () => set({ category: c }) }, c))), errors.category && h('div', { className: 'error' }, errors.category)),
        h(Field, { label: 'Description', id: 'le-desc', error: errors.description, hint: 'Fabric, fit, care, what’s included.' }, h(Input, { id: 'le-desc', multiline: true, maxLength: 600, value: d.description, onChange: (e) => set({ description: e.target.value }) })),
        h('div', null, h('div', { className: 'row between', style: { marginBottom: 8 } }, h('div', { className: 'label' }, 'Sizes and stock'), h('div', { className: 'chips' }, presets.map(([n, ls]) => h('button', { key: n, className: 'btn ghost sm', style: { padding: '0 4px', height: 28 }, onClick: () => set({ variants: ls.map((label) => ({ label, stock: '' })) }) }, n)))),
          h('div', { className: 'stack', style: { gap: 8 } }, d.variants.map((v, i) => h('div', { key: i, className: 'variant-row' }, h(Input, { 'aria-label': 'Size name', placeholder: 'Size', value: v.label, onChange: (e) => { const vs = d.variants.slice(); vs[i] = Object.assign({}, v, { label: e.target.value.slice(0, 16) }); set({ variants: vs }); clearErr('variants'); } }), h(Input, { 'aria-label': `Stock for ${v.label || 'size'}`, inputMode: 'numeric', placeholder: 'Stock', value: v.stock, onChange: (e) => { const vs = d.variants.slice(); vs[i] = Object.assign({}, v, { stock: num(e.target.value).slice(0, 4) }); set({ variants: vs }); clearErr('variants'); } }), h('button', { className: 'iconbtn plain', 'aria-label': 'Remove size', disabled: d.variants.length === 1, onClick: () => set({ variants: d.variants.filter((_, j) => j !== i) }) }, h(Icon, { name: 'trash', size: 18 })))),
            h('button', { className: 'btn ghost sm', style: { alignSelf: 'flex-start', padding: 0 }, onClick: () => set({ variants: d.variants.concat([{ label: '', stock: '' }]) }) }, '+ Add size')),
          errors.variants && h('div', { className: 'error' }, errors.variants)),
        h(Field, { label: 'Listed price', id: 'le-price', error: errors.price, hint: 'This is the price every buyer sees.' }, h('div', { className: 'input-group' }, h('div', { className: 'prefix' }, '₹'), h(Input, { id: 'le-price', inputMode: 'numeric', value: d.price, invalid: !!errors.price, onChange: (e) => { set({ price: num(e.target.value) }); clearErr('price'); } }))),
        h('div', { className: 'stack' }, h('div', { className: 'label' }, 'Where buyers buy'),
          h(Seg, { label: 'Checkout', value: d.checkout.channel, onChange: (c) => { set({ checkout: Object.assign({}, d.checkout, { channel: c }) }); clearErr('channel'); }, options: [{ value: 'DIRECT', label: 'Pay me directly' }, { value: 'WEBSITE', label: 'My website' }] }),
          d.checkout.channel === 'DIRECT' ? h('div', { className: 'hint' }, hasDirect ? `Buyers place the order here and pay you by ${[pay.upiId || pay.upiQrMediaId ? 'UPI' : null, pay.bankAccount ? 'bank transfer' : null, pay.paymentLink ? 'payment link' : null].filter(Boolean).join(', ')}. You confirm the payment and arrange delivery.` : 'Add UPI, bank or a payment link in Shop → How buyers pay you first.')
            : h(Field, { label: 'Product link on your website', id: 'le-url', error: errors.productUrl, hint: 'Buy now opens this page. Accepted offers get a coupon code or discount link for that price.' }, h(Input, { id: 'le-url', inputMode: 'url', placeholder: 'https://yourshop.com/products/…', value: d.checkout.productUrl, invalid: !!errors.productUrl, onChange: (e) => { set({ checkout: Object.assign({}, d.checkout, { productUrl: e.target.value.trim() }) }); clearErr('productUrl'); } })),
          errors.channel && h('div', { className: 'error' }, errors.channel)),
        h('div', { className: 'card tint stack' },
          h('div', { className: 'h3' }, 'Bargaining'),
          h(Seg, { label: 'Bargaining mode', value: d.bargaining.mode, onChange: (m) => set({ bargaining: Object.assign({}, d.bargaining, { mode: m }) }), options: [{ value: 'FIXED', label: 'Fixed' }, { value: 'PRIVATE', label: 'Private' }, { value: 'PUBLIC', label: 'Public' }, { value: 'BOTH', label: 'Both' }] }),
          h('div', { className: 'small muted' }, { FIXED: 'Buyers can only buy at the listed price.', PRIVATE: 'Buyers send offers only you see.', PUBLIC: 'Offer amounts are shown on the listing (never buyer names). Good for creating urgency.', BOTH: 'Each buyer chooses a private or public offer.' }[d.bargaining.mode]),
          live && summary && summary.openOffers > 0 && h('div', { className: 'card info small' }, `${summary.openOffers} open offer${summary.openOffers === 1 ? '' : 's'}: switching to fixed price, lowering the price below an offer, or removing a size closes the affected offers.`),
          d.bargaining.mode !== 'FIXED' && h(React.Fragment, null,
            h('div', { className: 'private-note' }, h(Icon, { name: 'lock', size: 16 }), 'Private — buyers never see these amounts'),
            h(Field, { label: 'Lowest you’ll accept automatically', id: 'le-a', error: errors.autoAcceptAt, hint: A && P && A < P ? `Offers of ${money(A * 100)} or more are accepted instantly (up to ${pctOff(P, A)}% off). Leave blank to review every offer yourself.` : 'Leave blank to review every offer yourself.' }, h('div', { className: 'input-group' }, h('div', { className: 'prefix' }, '₹'), h(Input, { id: 'le-a', inputMode: 'numeric', placeholder: 'Optional', value: d.rules.autoAcceptAt, invalid: !!errors.autoAcceptAt, onChange: (e) => { set({ rules: Object.assign({}, d.rules, { autoAcceptAt: num(e.target.value) }) }); clearErr('autoAcceptAt'); } }))),
            d.checkout.channel === 'WEBSITE' && d.rules.autoAcceptAt !== '' && h(U.DealAccessInput, { label: `Code or link that gives ${A ? money(A * 100) : 'this price'} on your website`, value: d.dealCodes.accept, onChange: (x) => { set({ dealCodes: Object.assign({}, d.dealCodes, { accept: x }) }); clearErr('acceptCode'); }, error: errors.acceptCode, id: 'le-acode' }),
            d.checkout.channel === 'WEBSITE' && h('div', { className: 'hint' }, 'Website listings: automatic accepts are agreed at your automatic price, the price this code gives. When you accept or counter yourself, you add a code or link for that price.'),
            h('button', { className: 'btn ghost sm', style: { alignSelf: 'flex-start', padding: 0 }, onClick: () => setAdvanced(!advanced) }, advanced ? 'Hide automatic counter and decline' : 'More automation: counter or decline automatically'),
            advanced && h(React.Fragment, null,
              h(Field, { label: 'Counter lower offers automatically at', id: 'le-c', error: errors.autoCounterAt, hint: `Sent ${Math.round(E.RULES.AUTO_COUNTER_DELAY_MS / 1000)} seconds after every offer below your lowest price. Buyers see it as your counter. If you counter lower yourself, that lower amount is used.` }, h('div', { className: 'input-group' }, h('div', { className: 'prefix' }, '₹'), h(Input, { id: 'le-c', inputMode: 'numeric', placeholder: 'Optional', value: d.rules.autoCounterAt, invalid: !!errors.autoCounterAt, onChange: (e) => { set({ rules: Object.assign({}, d.rules, { autoCounterAt: num(e.target.value) }) }); clearErr('autoCounterAt'); } }))),
              d.checkout.channel === 'WEBSITE' && d.rules.autoCounterAt !== '' && h(U.DealAccessInput, { label: 'Code or link for your automatic counter price', value: d.dealCodes.counter, onChange: (x) => { set({ dealCodes: Object.assign({}, d.dealCodes, { counter: x }) }); clearErr('counterCode'); }, error: errors.counterCode, id: 'le-ccode' }),
              h(Field, { label: 'Decline offers below', id: 'le-d', error: errors.autoDeclineBelow, hint: `Declined after a ${Math.round(E.RULES.AUTO_DECLINE_DELAY_MS / 60e3)}-minute delay so buyers can’t probe your limit.` }, h('div', { className: 'input-group' }, h('div', { className: 'prefix' }, '₹'), h(Input, { id: 'le-d', inputMode: 'numeric', placeholder: 'Optional', value: d.rules.autoDeclineBelow, invalid: !!errors.autoDeclineBelow, onChange: (e) => { set({ rules: Object.assign({}, d.rules, { autoDeclineBelow: num(e.target.value) }) }); clearErr('autoDeclineBelow'); } })))),
            h('div', null, h('div', { className: 'label', style: { marginBottom: 6 } }, 'Offers expire after'), h('div', { className: 'chips' }, [6, 12, 24, 48, 72].map((x) => h(Chip, { key: x, on: Number(d.bargaining.expiryHours) === x, onClick: () => set({ bargaining: Object.assign({}, d.bargaining, { expiryHours: x }) }) }, x + ' h'))), errors.expiryHours && h('div', { className: 'error' }, errors.expiryHours))))));
  }
  function videoDuration(file) {
    return new Promise((res) => { const v = document.createElement('video'); v.preload = 'metadata'; const u = URL.createObjectURL(file); const done = (x) => { URL.revokeObjectURL(u); res(x); }; v.onloadedmetadata = () => done(v.duration); v.onerror = () => done(NaN); setTimeout(() => done(NaN), 4000); v.src = u; });
  }

  // ---------- negotiations ----------
  function OffersInbox() {
    const { uid, nav } = useApp(); const now = Store.now(); const all = S.negotiations(Store.state, uid, now); const [f, setF] = useState('reply');
    const groups = { reply: all.filter((n) => n.canRespond), waiting: all.filter((n) => n.status === 'OPEN' && !n.canRespond), agreed: all.filter((n) => n.status === 'AGREED'), closed: all.filter((n) => !['OPEN', 'AGREED'].includes(n.status)) };
    const list = groups[f];
    return h('div', { className: 'screen' }, h(U.AppBar, { title: 'Offers', right: h(Bell) }),
      h('div', { style: { padding: '12px 16px' } }, h(Seg, { label: 'Filter offers', value: f, onChange: setF, options: [{ value: 'reply', label: `Reply (${groups.reply.length})` }, { value: 'waiting', label: `Waiting (${groups.waiting.length})` }, { value: 'agreed', label: `Agreed (${groups.agreed.length})` }, { value: 'closed', label: 'Closed' }] })),
      list.length ? list.map((n) => { const last = n.offers[n.offers.length - 1]; return h('button', { key: n.id, className: 'listrow', onClick: () => nav.go('negotiation', { id: n.id }) }, h(Thumb, { m: n.listing.media }), h('div', { className: 'grow' }, h('div', { className: 'strong ellipsis' }, n.listing.title), h('div', { className: 'tiny muted' }, `${n.buyer.name} · ${U.sizeText(n.variant.label).toLowerCase()} · ${n.visibility === 'PUBLIC' ? 'public' : 'private'}`), h('div', { className: 'small' }, h('b', null, money(n.agreement ? n.agreement.price : last.amount)), ` · ${pctOff(n.listing.price, n.agreement ? n.agreement.price : last.amount)}% off`, n.status === 'OPEN' ? ` · ${left(last.expiresAt - now)} left` : '')), h(Badge, { tone: n.canRespond ? (n.statusLabel === 'Auto-declining' ? '' : 'accent') : n.status === 'AGREED' ? 'success' : '' }, n.statusLabel)); })
        : h(Empty, { icon: 'tag', title: { reply: 'No offers waiting for you', waiting: 'Nothing waiting on buyers', agreed: 'No agreed offers', closed: 'No closed offers' }[f], body: f === 'reply' ? 'When buyers make offers that your settings don’t handle automatically, they appear here.' : null }));
  }

  function SellerNegotiation({ id }) {
    const { uid, nav, toast } = useApp(); const now = Store.now(); const d = S.negotiation(Store.state, uid, id, now);
    const [countering, setCountering] = useState(false); const [confirm, setConfirm] = useState(false); const [acceptSheet, setAcceptSheet] = useState(false); const [deal, setDeal] = useState({ type: 'CODE', value: '' }); const [dealErr, setDealErr] = useState(null);
    if (!d) return h(Page, { title: 'Offer', onBack: nav.back }, h(Empty, { title: 'Negotiation not found' }));
    const last = d.offers[d.offers.length - 1]; const web = d.channel === 'WEBSITE';
    const act = (action, amount, dealAccess) => { const r = Store.dispatch({ type: 'offer.respond', userId: uid, negotiationId: id, action, amount, dealAccess }); if (r.ok) { setCountering(false); setAcceptSheet(false); toast(action === 'ACCEPT' ? 'Accepted — 1 unit reserved for the buyer' : action === 'COUNTER' ? 'Counter sent' : 'Offer declined'); } else if (r.code === 'DEAL_ACCESS_REQUIRED' && action === 'ACCEPT') setDealErr(r.message); else if (r.code !== 'DEAL_ACCESS_REQUIRED') toast(r.message, true); return r; };
    const order = d.status === 'PURCHASED' ? S.orders(Store.state, uid).find((o) => o.negotiationId === id) : null;
    let footer;
    if (d.canRespond) footer = countering ? h(U.CounterBox, { dto: d, requireDeal: web, onSubmit: (a, da) => act('COUNTER', a, da), onCancel: () => setCountering(false) }) : h(React.Fragment, null,
      h('div', { className: 'small' }, h('b', null, `${d.buyer.name} offered ${money(last.amount)}`), ` (${pctOff(d.listing.price, last.amount)}% off) · expires in ${left(last.expiresAt - now)}`),
      last.autoDeclineAt && h('div', { className: 'card small', style: { background: 'var(--surface-3)' } }, `Below your auto-decline amount — it will be declined automatically in ${left(last.autoDeclineAt - now)}. You can still respond now.`),
      last.autoCounterDueAt && h('div', { className: 'card small', style: { background: 'var(--surface-3)' } }, `Your automatic counter goes out in ${left(last.autoCounterDueAt - now)}. You can still respond now.`),
      d.variant.available < 1 && h('div', { className: 'error' }, 'No stock available in this size, so you can’t accept right now.'),
      h('div', { className: 'btn-row' }, h(Btn, { onClick: () => (web ? (setDeal({ type: 'CODE', value: '' }), setDealErr(null), setAcceptSheet(true)) : act('ACCEPT')), disabled: d.variant.available < 1 }, 'Accept ' + money(last.amount)), d.canCounter ? h(Btn, { kind: 'outline', onClick: () => setCountering(true) }, 'Counter') : h(Btn, { kind: 'danger', onClick: () => setConfirm(true) }, 'Decline')),
      d.canCounter && h('button', { className: 'btn ghost sm', onClick: () => setConfirm(true) }, 'Decline offer'));
    else if (d.status === 'OPEN') footer = h('div', { className: 'small' }, h('b', null, 'Waiting for the buyer'), ` · your ${last.automatic ? 'automatic ' : ''}counter expires in ${left(last.expiresAt - now)}`);
    else if (d.status === 'AGREED') footer = h('div', { className: 'card success small' }, h('b', null, `Agreed at ${money(d.agreement.price)}. `), `One unit is reserved. The buyer has until ${when(d.agreement.deadline)} (${left(d.agreement.deadline - now)}) to check out.`);
    else if (d.status === 'PURCHASED') footer = h(Btn, { kind: 'dark', block: true, onClick: () => order && nav.replace('order', { id: order.id }) }, 'View order');
    else footer = h('div', { className: 'small muted' }, d.closeText || d.statusLabel);
    return h(Page, { title: 'Offer from ' + d.buyer.name, onBack: nav.back, footer },
      h('button', { className: 'listrow', onClick: () => nav.go('listing', { id: d.listing.id }) }, h(Thumb, { m: d.listing.media }), h('div', { className: 'grow' }, h('div', { className: 'strong ellipsis' }, d.listing.title), h('div', { className: 'small muted' }, `${U.sizeText(d.variant.label)} · listed ${money(d.listing.price)} · ${d.variant.available} available`)), h(Badge, { tone: d.canRespond ? 'accent' : d.status === 'AGREED' || d.status === 'PURCHASED' ? 'success' : '' }, d.statusLabel)),
      h(U.Timeline, { dto: d, perspective: 'seller', now }),
      h('div', { className: 'pad', style: { paddingTop: 0 } }, h('div', { className: 'rule' }, h('div', { className: 'private-note' }, h(Icon, { name: 'lock', size: 16 }), 'Your private settings'), h(RuleSummary, { price: d.listing.price, rules: d.rules, website: web, expiry: Math.round((d.offers[0].expiresAt - d.offers[0].at) / E.HOUR) })), web && d.agreement && d.agreement.dealAccess && h('div', { className: 'small', style: { marginTop: 8 } }, `Sent to the buyer: ${d.agreement.dealAccess.type === 'CODE' ? 'code ' + d.agreement.dealAccess.value : 'discount link'}`)),
      acceptSheet && h(Sheet, { title: 'Accept ' + money(last.amount), onClose: () => setAcceptSheet(false), footer: h(Btn, { block: true, onClick: () => act('ACCEPT', undefined, deal) }, 'Accept and send to buyer') }, h('div', { className: 'stack' }, h('div', { className: 'small' }, `This listing sells on your website. Give the buyer a coupon code or discount link that sets the price to ${money(last.amount)}.`), h(U.DealAccessInput, { value: deal, onChange: (x) => { setDeal(x); setDealErr(null); }, error: dealErr, id: 'acc-deal' }))),
      confirm && h(Confirm, { title: 'Decline this offer?', body: 'The buyer will be told you declined. They can still buy at the listed price.', confirmLabel: 'Decline', danger: true, onCancel: () => setConfirm(false), onConfirm: () => { setConfirm(false); act('DECLINE'); } }));
  }

  // ---------- orders ----------
  function SellerOrders() {
    const { uid, nav } = useApp(); const all = S.orders(Store.state, uid); const now = Store.now(); const [f, setF] = useState('PLACED');
    const groups = { PLACED: all.filter((o) => o.status === 'PLACED'), CONFIRMED: all.filter((o) => o.status === 'CONFIRMED'), SHIPPED: all.filter((o) => o.status === 'SHIPPED'), DONE: all.filter((o) => ['DELIVERED', 'CANCELLED', 'EXPIRED'].includes(o.status)) };
    const list = groups[f];
    return h('div', { className: 'screen' }, h(U.AppBar, { title: 'Orders', right: h(Bell) }),
      h('div', { style: { padding: '12px 16px' } }, h(Seg, { label: 'Order status', value: f, onChange: setF, options: [{ value: 'PLACED', label: `New (${groups.PLACED.length})` }, { value: 'CONFIRMED', label: `To ship (${groups.CONFIRMED.length})` }, { value: 'SHIPPED', label: 'Shipped' }, { value: 'DONE', label: 'Closed' }] })),
      list.length ? list.map((o) => h('button', { key: o.id, className: 'listrow', onClick: () => nav.go('order', { id: o.id }) }, h(Thumb, { m: o.media }), h('div', { className: 'grow' }, h('div', { className: 'strong ellipsis' }, o.title), h('div', { className: 'tiny muted' }, `${o.number} · ${o.buyerName} · ${U.sizeText(o.variantLabel).toLowerCase()} · ${ago(o.createdAt, now)}`), h('div', { className: 'small' }, h('b', null, money(o.price)), ' · ', o.channel === 'WEBSITE' ? 'website' : E.PAY_METHODS[o.paymentMethod], o.priceSource === 'NEGOTIATED' ? ' · bargained' : '', o.status === 'PLACED' ? ` · ${left(o.confirmBy - now)} to confirm` : '')), h(Badge, { tone: U.ORDER_TONE[o.status] }, { PLACED: 'To confirm', CONFIRMED: 'Confirmed', SHIPPED: 'Shipped', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', EXPIRED: 'Expired' }[o.status])))
        : h(Empty, { icon: 'box', title: { PLACED: 'No new orders', CONFIRMED: 'Nothing waiting to ship', SHIPPED: 'Nothing in transit', DONE: 'No closed orders yet' }[f], body: f === 'PLACED' ? 'When a buyer places an order, confirm it here once you see the payment or the website order.' : null }));
  }
  const EMPTY_SHIP = { carrier: '', trackingId: '', trackingUrl: '', expectedDate: '', note: '' };
  function SellerOrder({ id }) {
    const { uid, nav, toast } = useApp(); const now = Store.now(); const o = S.order(Store.state, uid, id);
    const [sheet, setSheet] = useState(null); const [ship, setShip] = useState(EMPTY_SHIP); const [addShip, setAddShip] = useState(false); const [errors, setErrors] = useState({}); const [reason, setReason] = useState(null); const [note, setNote] = useState('');
    if (!o) return h(Page, { title: 'Order', onBack: nav.back }, h(Empty, { title: 'Order not found' }));
    const web = o.channel === 'WEBSITE';
    const run = (cmd, ok) => { const r = Store.dispatch(Object.assign({ userId: uid, orderId: id }, cmd)); if (!r.ok) { setErrors(r.fields || {}); toast(r.message, true); return false; } setSheet(null); setErrors({}); toast(ok); return true; };
    const open = (which) => { setErrors({}); setShip(o.shipment ? Object.assign({}, EMPTY_SHIP, o.shipment) : EMPTY_SHIP); setAddShip(false); setReason(null); setNote(''); setSheet(which); };
    let footer;
    if (o.status === 'PLACED') footer = h(React.Fragment, null, h('div', { className: 'small' }, web ? `Check your website for a ${money(o.price)} order using this deal.` : `Check that ${money(o.price)} arrived by ${E.PAY_METHODS[o.paymentMethod]} with note ${o.number}.`, ` Confirm within ${left(o.confirmBy - now)} or it expires.`), h('div', { className: 'btn-row' }, h(Btn, { kind: 'outline', onClick: () => open('cancel') }, web ? 'No order found' : 'Not received'), h(Btn, { onClick: () => open('confirm') }, web ? 'Order received' : 'Payment received')));
    else if (o.status === 'CONFIRMED') footer = h('div', { className: 'btn-row' }, h(Btn, { kind: 'outline', onClick: () => open('ship') }, 'Add shipment details'), h(Btn, { onClick: () => run({ type: 'order.deliver' }, 'Marked delivered — buyer notified') }, 'Mark delivered'));
    else if (o.status === 'SHIPPED') footer = h('div', { className: 'btn-row' }, h(Btn, { kind: 'outline', onClick: () => open('ship') }, 'Edit shipment'), h(Btn, { onClick: () => run({ type: 'order.deliver' }, 'Marked delivered — buyer notified') }, 'Mark delivered'));
    else footer = h('div', { className: 'small muted' }, o.status === 'DELIVERED' ? 'Delivered. Nothing left to do.' : o.status === 'CANCELLED' ? 'Cancelled. The unit went back into stock unless you chose “out of stock”.' : 'Expired because it wasn’t confirmed in time. The unit went back into stock.');
    return h(Page, { title: 'Order ' + o.number, onBack: nav.back, footer },
      h('div', { className: 'pad stack' },
        h('div', { className: 'row' }, h(Thumb, { m: o.media, lg: true }), h('div', { className: 'grow' }, h('div', { className: 'strong' }, o.title), h('div', { className: 'small muted' }, `${U.sizeText(o.variantLabel)} · Qty 1 · ${o.buyerName}`), h('div', { style: { marginTop: 4 } }, h(Badge, { tone: U.ORDER_TONE[o.status] }, o.statusLabel)))),
        h(U.OrderSteps, { order: o }),
        o.status === 'CONFIRMED' && !o.shipment && h('div', { className: 'hint' }, 'Shipment details are optional. Add them if you use a courier, or mark the order delivered when the buyer has it.'),
        h(U.ShipmentCard, { sh: o.shipment }),
        h('div', null, h('div', { className: 'section-title' }, 'Sale'), h(Kv, { k: 'Listed price', v: money(o.listPrice) }), h(Kv, { k: o.priceSource === 'NEGOTIATED' ? 'Agreed price' : 'Sold at', v: money(o.price), strong: true }), h(Kv, { k: 'Buyer pays via', v: web ? 'Your website' : E.PAY_METHODS[o.paymentMethod] }), web && o.dealAccess && h(Kv, { k: o.dealAccess.type === 'CODE' ? 'Coupon used' : 'Discount link', v: o.dealAccess.type === 'CODE' ? o.dealAccess.value : 'Given to buyer' }), h(Kv, { k: 'Payment reference', v: o.number })),
        h('div', null, h('div', { className: 'section-title' }, web ? 'Buyer' : 'Ship to'), h('div', { className: 'strong' }, o.address ? o.address.name : o.buyerName), o.address ? h('div', { className: 'small' }, U.addrLine(o.address)) : h('div', { className: 'small muted' }, 'The buyer enters the delivery address on your website.'), o.address && h('div', { className: 'tiny muted', style: { marginTop: 4 } }, 'Buyer: ' + o.buyerName)),
        h('div', { className: 'hint' }, `${BRAND} doesn’t process payments or deliveries. Only you can update this order; the buyer sees each change.`)),
      sheet === 'confirm' && h(Sheet, { title: web ? 'Confirm website order' : 'Confirm payment received', onClose: () => setSheet(null), footer: h(Btn, { block: true, onClick: () => run({ type: 'order.confirm', shipment: addShip ? ship : null }, web ? 'Order confirmed — buyer notified' : 'Payment confirmed — buyer notified') }, addShip ? 'Confirm and add shipment' : 'Confirm') },
        h('div', { className: 'stack' }, h('div', { className: 'small' }, web ? `Confirm only if you can see this ${money(o.price)} order on your website.` : `Confirm only if ${money(o.price)} has reached your account.`),
          h('label', { className: 'row', style: { gap: 8, fontWeight: 700 } }, h('input', { type: 'checkbox', checked: addShip, onChange: (e) => setAddShip(e.target.checked) }), 'Add shipment details now (optional)'),
          addShip && h(U.ShipmentFields, { value: ship, onChange: setShip, errors, idp: 'cs-' }))),
      sheet === 'ship' && h(Sheet, { title: o.shipment ? 'Edit shipment details' : 'Add shipment details', onClose: () => setSheet(null), footer: h(Btn, { block: true, onClick: () => run({ type: 'order.ship', shipment: ship }, o.shipment ? 'Shipment updated' : 'Marked shipped — buyer notified') }, o.shipment ? 'Save' : 'Save and mark shipped') }, h(U.ShipmentFields, { value: ship, onChange: setShip, errors, idp: 'sh-' })),
      sheet === 'cancel' && h(Sheet, { title: 'Cancel this order?', onClose: () => setSheet(null), footer: h(Btn, { kind: 'danger', block: true, disabled: !reason, onClick: () => run({ type: 'order.cancel', reason, note }, 'Order cancelled — buyer notified') }, 'Cancel order') },
        h('div', { className: 'stack' }, h('div', { className: 'chips' }, (web ? ['WEBSITE_ORDER_NOT_FOUND', 'OUT_OF_STOCK', 'BUYER_REQUEST', 'OTHER'] : ['PAYMENT_NOT_RECEIVED', 'OUT_OF_STOCK', 'BUYER_REQUEST', 'OTHER']).map((k) => h(Chip, { key: k, accent: true, on: reason === k, onClick: () => setReason(k) }, E.CANCEL_REASONS[k]))), errors.reason && h('div', { className: 'error' }, errors.reason),
          h(Field, { label: 'Note for the buyer (optional)', id: 'cn-note' }, h(Input, { id: 'cn-note', value: note, maxLength: 200, onChange: (e) => setNote(e.target.value) })),
          h('div', { className: 'hint' }, 'Cancellations show on your shop’s order record. If the buyer already paid you, refund them directly.'))));
  }

  // ---------- shop profile ----------
  // ---------- shop profile ----------
  function ShopProfile() {
    const { uid, toast } = useApp(); const me = S.me(Store.state, uid); const u = Store.state.users[uid]; const pay = S.payment(Store.state, uid); const st = S.stats(Store.state, uid);
    const [edit, setEdit] = useState(null); const [v, setV] = useState(null); const [errors, setErrors] = useState({});
    const start = () => { setV({ name: me.name, handle: me.handle, area: me.area, city: me.city, gstin: me.gstin || '', bio: me.bio || '' }); setErrors({}); setEdit('shop'); };
    const startPay = () => { setV(Object.assign({ upiId: '', upiQrMediaId: null, bankHolder: '', bankAccount: '', bankIfsc: '', bankName: '', paymentLink: '', website: '' }, Object.fromEntries(Object.entries(pay).filter(([, x]) => x != null)))); setErrors({}); setEdit('pay'); };
    const save = () => { const r = Store.dispatch(Object.assign({ type: 'seller.updateProfile', userId: uid }, v)); if (!r.ok) { setErrors(r.fields || {}); return; } setEdit(null); toast('Shop details saved'); };
    const savePay = () => { const r = Store.dispatch({ type: 'seller.updatePayment', userId: uid, payment: v }); if (!r.ok) { setErrors(r.fields || {}); toast(r.message, true); return; } setEdit(null); toast('Payment details saved'); };
    const f = (k, label, extra) => h(Field, { label, id: 'sp-' + k, error: errors[k] }, h(Input, Object.assign({ id: 'sp-' + k, value: v[k], invalid: !!errors[k], onChange: (e) => setV(Object.assign({}, v, { [k]: k === 'gstin' ? e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 15) : e.target.value })) }, extra || {})));
    const mask = (x) => (x ? '•••• ' + x.slice(-4) : '');
    if (edit === 'pay') return h('div', { className: 'screen' }, h(U.AppBar, { title: 'Payment details', onBack: () => setEdit(null) }), h('div', { className: 'pad stack' }, h(U.PaymentForm, { value: v, onChange: (x) => { setV(x); setErrors({}); }, errors, idp: 'spp-' }), h('div', { className: 'btn-row' }, h(Btn, { kind: 'outline', onClick: () => setEdit(null) }, 'Cancel'), h(Btn, { onClick: savePay }, 'Save'))));
    return h('div', { className: 'screen' }, h(U.AppBar, { title: 'Shop', right: h(Bell) }), h('div', { className: 'pad stack' },
      edit === 'shop' ? h(React.Fragment, null, f('name', 'Shop name'), f('handle', 'Shop handle'), h('div', { className: 'grid2' }, f('area', 'Area'), f('city', 'City')), me.type === 'BUSINESS' && f('gstin', 'GSTIN (optional)'), f('bio', 'About', { multiline: true, maxLength: 160 }), h('div', { className: 'btn-row' }, h(Btn, { kind: 'outline', onClick: () => setEdit(null) }, 'Cancel'), h(Btn, { onClick: save }, 'Save changes'))) :
        h(React.Fragment, null,
          h('div', { className: 'row' }, h(Avatar, { name: me.name, lg: true }), h('div', { className: 'grow' }, h('div', { className: 'h3', style: { fontSize: 18 } }, me.name), h('div', { className: 'small muted' }, '@' + me.handle + ' · ' + me.area + ', ' + me.city)), h(Btn, { kind: 'outline', size: 'sm', onClick: start }, 'Edit')),
          me.bio && h('div', null, me.bio),
          h('div', { className: 'card' }, h('div', { className: 'strong', style: { marginBottom: 2 } }, 'Your public order record'), h('div', { className: 'small' }, h(U.StatsLine, { st })), h('div', { className: 'tiny muted', style: { marginTop: 4 } }, 'Buyers see this on your shop and listings. Confirm orders promptly to keep it strong.')),
          h('div', { className: 'card' }, h('div', { className: 'row between' }, h('div', { className: 'strong' }, 'How buyers pay you'), h(Btn, { kind: 'outline', size: 'sm', onClick: startPay }, 'Edit')),
            pay.upiId && h(Kv, { k: 'UPI ID', v: pay.upiId }), pay.upiQrMediaId && h(Kv, { k: 'UPI QR', v: 'Uploaded' }), pay.bankAccount && h(Kv, { k: 'Bank', v: `${pay.bankName || pay.bankIfsc} ${mask(pay.bankAccount)}` }), pay.paymentLink && h(Kv, { k: 'Payment link', v: 'Added' }), pay.website && h(Kv, { k: 'Website', v: pay.website.replace(/^https:\/\//, '') }),
            h('div', { className: 'tiny muted', style: { marginTop: 4 } }, 'Shown only to buyers with an order waiting for payment.')),
          h(Kv, { k: 'Seller type', v: me.type === 'BUSINESS' ? 'Registered business' : 'Individual seller' }), me.gstin && h(Kv, { k: 'GSTIN', v: me.gstin }), h(Kv, { k: 'Owner', v: u.name + ' · +91 ' + u.phone }), h(Kv, { k: 'Code of Conduct', v: 'Agreed ' + when(me.conductAcceptedAt) }),
          h('div', { className: 'card row', style: { alignItems: 'flex-start' } }, h(Icon, { name: 'shield' }), h('div', null, h('div', { className: 'strong' }, 'Not verified'), h('div', { className: 'small muted' }, 'Seller verification and KYC aren’t part of this prototype. Buyers see “Not verified (prototype)”.'))),
          h('div', { className: 'card' }, h('div', { className: 'strong' }, 'Shopping too?'), h('div', { className: 'small muted' }, 'Sign in to the buyer app with +91 ' + u.phone + '. It’s the same account.')),
          h(Btn, { kind: 'danger', block: true, onClick: () => Store.dispatch({ type: 'auth.signOut', app: 'seller' }) }, 'Sign out'))));
  }
  function NotificationsScreen() {
    const { uid, nav } = useApp();
    return h(U.Notifications, { app: 'seller', userId: uid, onBack: nav.back, onOpen: (ref) => { if (ref.type === 'negotiation') nav.replace('negotiation', { id: ref.id }); if (ref.type === 'order') nav.replace('order', { id: ref.id }); if (ref.type === 'listing') nav.replace('listing', { id: ref.id }); } });
  }

  const SCREENS = { editor: ListingEditor, listing: ListingDetail, negotiation: SellerNegotiation, order: SellerOrder, notifications: NotificationsScreen };
  const SHEETS = {};
  window.FaydaSellerApp = SellerApp;
})();
