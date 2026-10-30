/* Fayda Buyer app (prototype). Reads only buyer-scoped DTOs from the engine. */
(function () {
  'use strict';
  const U = window.FaydaUI; const { h, E, Store, money, left, ago, when, pctOff, Icon, MediaView, Btn, Field, Input, Chip, Seg, Badge, Empty, Page, Sheet, Confirm, Thumb, Avatar, Kv, useToast, useNav, AppCtx, useApp, BRAND } = U;
  const { useState, useEffect, useRef } = React;
  const B = E.buyer;

  function BuyerApp() {
    const s = Store.state; const uid = s.sessions.buyer;
    if (!uid || !s.users[uid]) return h(U.AuthFlow, { app: 'buyer' });
    if (!s.buyerProfiles[uid]) return h(BuyerOnboarding, { uid });
    return h(BuyerMain, { uid });
  }

  function BuyerOnboarding({ uid }) {
    const u = Store.state.users[uid];
    const [name, setName] = useState(u.name || ''); const [addr, setAddr] = useState(Object.assign({}, U.EMPTY_ADDR, { name: u.name || '' })); const [errors, setErrors] = useState({});
    const save = () => { const r = Store.dispatch({ type: 'buyer.completeProfile', userId: uid, name, address: Object.assign({}, addr, { name: addr.name || name }) }); if (!r.ok) setErrors(r.fields || { form: r.message }); };
    return h('div', { className: 'body' }, h('div', { className: 'screen' }, h('div', { className: 'pad stack', style: { gap: 16 } },
      h('div', null, h('div', { className: 'small muted strong' }, 'One last step'), h('div', { className: 'h2' }, 'Where should we deliver?')),
      h(Field, { label: 'Your name', id: 'ob-fullname', error: errors.fullName }, h(Input, { id: 'ob-fullname', value: name, autoComplete: 'name', invalid: !!errors.fullName, onChange: (e) => setName(e.target.value) })),
      h(U.AddressForm, { value: addr, onChange: setAddr, errors, idp: 'ob-' }),
      h('div', { className: 'hint' }, 'Location detection and map pins come with the production app.'))),
      h('div', { className: 'actionbar' }, h(Btn, { size: 'lg', block: true, onClick: save }, 'Save address and start shopping'),
        h('button', { className: 'btn ghost sm', onClick: () => Store.dispatch({ type: 'auth.signOut', app: 'buyer' }) }, 'Use a different number')));
  }

  function BuyerMain({ uid }) {
    const nav = useNav('home'); const [toast, toastNode] = useToast(); const [sheet, setSheet] = useState(null);
    const s = Store.state; const now = Store.now();
    const negs = B.negotiations(s, uid, now);
    const actionable = negs.filter((n) => n.canRespond || n.status === 'AGREED').length;
    const unread = E.common.unread(s, uid, 'buyer');
    const ctx = { app: 'buyer', uid, nav, toast, openSheet: (type, params) => setSheet({ type, params: params || {} }), closeSheet: () => setSheet(null), unread };
    const tabs = [['home', 'Home', 'home'], ['search', 'Search', 'search'], ['offers', 'Offers', 'tag', actionable], ['orders', 'Orders', 'box'], ['profile', 'Profile', 'user']];
    const Tab = { home: HomeFeed, search: SearchScreen, offers: OffersScreen, orders: OrdersScreen, profile: ProfileScreen }[nav.tab];
    const top = nav.top; const Screen = top ? SCREENS[top.screen] : null;
    const Sh = sheet ? SHEETS[sheet.type] : null;
    return h(AppCtx.Provider, { value: ctx }, h('div', { className: 'body' },
      h(Tab, null),
      h('nav', { className: 'tabbar', 'aria-label': 'Buyer app' }, tabs.map(([k, label, icon, dot]) => h('button', { key: k, className: 'tab', 'aria-current': nav.tab === k ? 'page' : undefined, onClick: () => nav.setTab(k) }, h(Icon, { name: icon, size: 22 }), label, dot ? h('span', { className: 'dot' }, dot) : null))),
      nav.stack.map((p, i) => i === nav.stack.length - 1 ? h(SCREENS[p.screen], Object.assign({ key: p.key }, p.params)) : null),
      Sh && h(Sh, Object.assign({}, sheet.params)), toastNode));
  }

  function Bell() {
    const { nav, unread } = useApp();
    return h('button', { className: 'iconbtn', onClick: () => nav.go('notifications'), 'aria-label': `Notifications${unread ? `, ${unread} unread` : ''}` }, h(Icon, { name: 'bell', size: 20 }), unread ? h('span', { className: 'dot' }, unread) : null);
  }

  // ---------- Home: full-screen reels ----------
  function HomeFeed() {
    const { uid, nav, openSheet, unread } = useApp();
    const [tab, setTab] = useState('foryou'); const [cat, setCat] = useState('All'); const [active, setActive] = useState(0); const [muted, setMuted] = useState(true);
    const ref = useRef(null); const seen = useRef(new Set());
    const now = Store.now(); const items = B.feed(Store.state, uid, now, { tab: tab === 'following' ? 'following' : 'foryou', category: cat });
    useEffect(() => { if (ref.current) ref.current.scrollTop = 0; setActive(0); }, [tab, cat]);
    useEffect(() => { const it = items[active]; if (it && !seen.current.has(it.id)) { seen.current.add(it.id); Store.dispatch({ type: 'listing.view', userId: uid, listingId: it.id }); } }, [active, items.length ? items[active] && items[active].id : null]);
    const onScroll = (e) => { const el = e.currentTarget; const i = Math.round(el.scrollTop / Math.max(1, el.clientHeight)); if (i !== active) setActive(i); };
    return h('div', { className: 'screen', style: { overflow: 'hidden', background: '#000' } },
      items.length ? h('div', { className: 'reels', ref, onScroll }, items.map((it, i) => h(Reel, { key: it.id, it, active: i === active, near: Math.abs(i - active) <= 1, muted, setMuted }))) :
        h('div', { style: { position: 'absolute', inset: 0, background: 'var(--surface)', paddingTop: 70 } }, tab === 'following' ? h(Empty, { icon: 'heart', title: 'Follow shops to see them here', body: 'Tap Follow on any reel and new posts from that shop will appear in this feed.', action: h(Btn, { kind: 'dark', onClick: () => setTab('foryou') }, 'Browse For You') }) : h(Empty, { icon: 'search', title: 'Nothing in ' + cat + ' yet', body: 'Try another category.', action: h(Btn, { kind: 'dark', onClick: () => setCat('All') }, 'Show all categories') })),
      h('div', { className: 'reel-top' },
        h(Seg, { label: 'Feed', value: tab, onChange: setTab, options: [{ value: 'foryou', label: 'For you' }, { value: 'following', label: 'Following' }] }),
        h('button', { className: 'glass', onClick: () => openSheet('category', { value: cat, onPick: setCat }), 'aria-label': 'Category: ' + cat }, cat === 'All' ? 'All' : cat.split(' ')[0], h(Icon, { name: 'back', size: 14, style: { transform: 'rotate(-90deg)' } })),
        h('button', { className: 'glass round', onClick: () => nav.go('notifications'), 'aria-label': 'Notifications' }, h(Icon, { name: 'bell', size: 18 }), unread ? h('span', { className: 'dot' }, unread) : null)));
  }

  function Reel({ it, active, near, muted, setMuted }) {
    const { uid, nav, openSheet, toast } = useApp();
    const m = it.media[0]; const isVideo = m && m.kind === 'video';
    const myOpen = (B.listing(Store.state, uid, it.id, Store.now()).myNegotiations || []).find((n) => n.status === 'OPEN' || n.status === 'AGREED');
    const web = it.checkout.channel === 'WEBSITE';
    const buy = () => { const avail = it.variants.filter((v) => v.available); if (avail.length === 1 && it.variants.length === 1) nav.go('checkout', { listingId: it.id, variantId: avail[0].id }); else nav.go('product', { id: it.id, needSize: true }); };
    const buyBtn = (kind, block, text) => web ? h(WebsiteLink, { listingId: it.id, url: it.checkout.productUrl, kind, block }, text || 'Buy on website') : h(Btn, { kind, block, onClick: buy }, text || 'Buy now');
    const toggle = (type) => { const r = Store.dispatch({ type, userId: uid, listingId: it.id }); if (!r.ok) toast(r.message, true); };
    return h('section', { className: 'reel', 'aria-label': it.title },
      h('div', { className: 'reel-media' }, near ? h(MediaView, { m, active, muted }) : null),
      h('div', { className: 'reel-shade' }),
      m && m.kind === 'seed' && h('div', { className: 'seed-tag' }, 'Sample artwork'),
      isVideo && h('button', { className: 'glass round mute', onClick: () => setMuted(!muted), 'aria-label': muted ? 'Unmute' : 'Mute' }, h(Icon, { name: muted ? 'mute' : 'volume', size: 18 })),
      it.media.length > 1 && h('div', { className: 'seed-tag', style: { top: 84 } }, `1 / ${it.media.length} · open for more`),
      h('button', { className: 'tap-target', onClick: () => nav.go('product', { id: it.id }), 'aria-label': 'Open ' + it.title }),
      h('div', { className: 'rail' },
        h('button', { onClick: () => toggle('social.toggleLike'), 'aria-pressed': it.liked, 'aria-label': 'Like' }, h('span', { className: 'rail-ic' }, h(Icon, { name: 'heart', size: 24, fill: it.liked ? '#F43F5E' : 'none', style: it.liked ? { color: '#F43F5E' } : null })), it.likes),
        h('button', { onClick: () => openSheet('comments', { listingId: it.id }), 'aria-label': 'Comments' }, h('span', { className: 'rail-ic' }, h(Icon, { name: 'chat', size: 22 })), it.comments),
        h('button', { onClick: () => { toggle('social.toggleSave'); if (!it.saved) toast('Saved to your profile'); }, 'aria-pressed': it.saved, 'aria-label': 'Save' }, h('span', { className: 'rail-ic' }, h(Icon, { name: 'bookmark', size: 22, fill: it.saved ? '#fff' : 'none' })), it.saved ? 'Saved' : 'Save'),
        h('button', { onClick: () => shareListing(it, toast), 'aria-label': 'Share' }, h('span', { className: 'rail-ic' }, h(Icon, { name: 'send', size: 22 })), 'Share')),
      h('div', { className: 'reel-info' },
        h('div', { className: 'seller' }, h('button', { style: { background: 'none', border: 0, padding: 0, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }, onClick: () => nav.go('shop', { sellerId: it.seller.id }) }, h(Avatar, { name: it.seller.name }), h('span', { className: 'strong' }, it.seller.name)),
          !it.seller.isMe && h('button', { className: 'follow', 'aria-pressed': it.seller.following, onClick: () => { const r = Store.dispatch({ type: 'social.toggleFollow', userId: uid, sellerId: it.seller.id }); if (!r.ok) toast(r.message, true); } }, it.seller.following ? 'Following' : 'Follow')),
        h('div', { className: 'title' }, it.title),
        h('div', { className: 'reel-badges', style: { alignItems: 'center' } }, h('span', { style: { fontSize: 20, fontWeight: 800, letterSpacing: -0.3, marginRight: 4, textShadow: '0 1px 4px rgba(0,0,0,.45)' } }, money(it.price)), it.soldOut ? h(Badge, null, 'Sold out') : it.bargaining.acceptsOffers ? h(Badge, { tone: 'accent' }, 'Accepts offers') : h(Badge, null, 'Fixed price'), h(Badge, null, it.category)),
        it.isMine ? h('div', { className: 'small', style: { opacity: 0.85 } }, 'This is your listing.') :
          it.soldOut ? h(Btn, { kind: 'outline', block: true, disabled: true }, 'Sold out') :
            it.bargaining.acceptsOffers ? h('div', { className: 'btn-row' }, buyBtn('outline', false), myOpen ? h(Btn, { kind: 'primary', onClick: () => nav.go('negotiation', { id: myOpen.id }) }, 'View offer') : h(Btn, { kind: 'primary', onClick: () => openSheet('offer', { listingId: it.id }) }, 'Make offer')) :
              buyBtn('outline', true, (web ? 'Buy on website · ' : 'Buy now · ') + money(it.price))));
  }

  function WebsiteLink({ listingId, url, kind, block, children }) {
    const { uid } = useApp();
    return h('a', { className: ['btn', kind || 'outline', block ? 'block' : ''].join(' '), style: { textDecoration: 'none' }, href: url, target: '_blank', rel: 'noopener noreferrer', onClick: () => Store.dispatch({ type: 'listing.websiteClick', userId: uid, listingId }) }, children, h(Icon, { name: 'send', size: 16 }));
  }

  async function shareListing(it, toast) {
    const text = `${it.title} — ${money(it.price)} from ${it.seller.name} on ${BRAND}`;
    try { if (navigator.share) { await navigator.share({ title: it.title, text }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); toast('Listing details copied. Shareable links arrive with the production app.'); } catch (e) { toast('Sharing isn’t available in this browser. Shareable links arrive with the production app.'); }
  }

  // ---------- Product ----------
  function ProductScreen({ id, needSize }) {
    const { uid, nav, openSheet, toast } = useApp(); const now = Store.now();
    const d = B.listing(Store.state, uid, id, now);
    const [variant, setVariant] = useState(() => (d && d.variants.length === 1 && d.variants[0].available ? d.variants[0].id : null));
    const [idx, setIdx] = useState(0); const [sizeErr, setSizeErr] = useState(needSize ? 'Choose a size to continue.' : null);
    useEffect(() => { if (d) Store.dispatch({ type: 'listing.view', userId: uid, listingId: id }); }, []);
    if (!d) return h(Page, { title: 'Listing', onBack: nav.back }, h(Empty, { title: 'This listing isn’t available', body: 'The seller may have paused or removed it.' }));
    const unavailable = d.status !== 'ACTIVE';
    const openFor = (vid) => (d.myNegotiations || []).find((n) => n.variantId === vid && (n.status === 'OPEN' || n.status === 'AGREED'));
    const need = () => { if (!variant) { setSizeErr('Choose a size to continue.'); return false; } return true; };
    const m = d.media[idx];
    const footer = d.isMine ? h('div', { className: 'muted small' }, 'This is your listing. Manage it in the seller app.') : unavailable ? h(Btn, { kind: 'outline', block: true, disabled: true }, 'Not available') : d.soldOut ? h(Btn, { kind: 'outline', block: true, disabled: true }, 'Sold out') :
      h('div', { className: d.bargaining.acceptsOffers ? 'btn-row' : '' },
        d.checkout.channel === 'WEBSITE' ? h(WebsiteLink, { listingId: id, url: d.checkout.productUrl, kind: d.bargaining.acceptsOffers ? 'dark' : 'primary', block: true }, 'Buy on website · ' + money(d.price)) : h(Btn, { kind: d.bargaining.acceptsOffers ? 'dark' : 'primary', block: true, onClick: () => need() && nav.go('checkout', { listingId: id, variantId: variant }) }, 'Buy now · ' + money(d.price)),
        d.bargaining.acceptsOffers && (variant && openFor(variant) ? h(Btn, { kind: 'primary', onClick: () => nav.go('negotiation', { id: openFor(variant).id }) }, 'View your offer') : h(Btn, { kind: 'primary', onClick: () => need() && openSheet('offer', { listingId: id, variantId: variant }) }, 'Make offer')));
    return h(Page, { title: d.seller.name, onBack: nav.back, footer, right: h('button', { className: 'iconbtn', onClick: () => Store.dispatch({ type: 'social.toggleSave', userId: uid, listingId: id }), 'aria-pressed': d.saved, 'aria-label': d.saved ? 'Remove from saved' : 'Save' }, h(Icon, { name: 'bookmark', size: 20, fill: d.saved ? 'currentColor' : 'none' })) },
      h('div', { className: 'gallery' }, h(MediaView, { m, active: true, controls: m && m.kind === 'video' }),
        d.media.length > 1 && (!m || m.kind !== 'video') && h('div', { className: 'gallery-nav' }, h('button', { 'aria-label': 'Previous', onClick: () => setIdx((idx - 1 + d.media.length) % d.media.length) }), h('button', { 'aria-label': 'Next', onClick: () => setIdx((idx + 1) % d.media.length) })),
        d.media.length > 1 && h('div', { className: 'carousel-dots' }, d.media.map((_, i) => h('i', { key: i, className: i === idx ? 'on' : '' }))),
        m && m.kind === 'seed' && h('div', { className: 'seed-tag', style: { top: 10 } }, 'Sample artwork')),
      d.media.length > 1 && h('div', { className: 'chips scroll', style: { padding: '10px 16px 0' } }, d.media.map((x, i) => h(Chip, { key: i, on: i === idx, onClick: () => setIdx(i) }, (x.kind === 'video' ? 'Video ' : 'Photo ') + (i + 1)))),
      h('div', { className: 'pad stack' },
        h('div', null, h('div', { className: 'h2' }, d.title), h('div', { className: 'row', style: { marginTop: 6 } }, h('span', { className: 'price' }, money(d.price)), d.bargaining.acceptsOffers ? h(Badge, { tone: 'accent' }, 'Accepts offers') : h(Badge, null, 'Fixed price'), h(Badge, null, d.category))),
        h('div', null, h('div', { className: 'label', style: { marginBottom: 8 } }, d.variants.length === 1 ? 'Option' : 'Size'), h('div', { className: 'chips' }, d.variants.map((v) => h(Chip, { key: v.id, on: variant === v.id, disabled: !v.available, onClick: () => { setVariant(v.id); setSizeErr(null); } }, v.label))),
          sizeErr ? h('div', { className: 'error', style: { marginTop: 6 } }, sizeErr) : variant && (d.variants.find((v) => v.id === variant) || {}).low ? h('div', { className: 'hint', style: { marginTop: 6 } }, 'Only a couple left in this size.') : null),
        d.description && h('div', null, d.description),
        h('div', { className: 'card small' }, h('b', null, d.checkout.channel === 'WEBSITE' ? 'Bought on the seller’s website. ' : 'Pay the seller directly. '), d.checkout.channel === 'WEBSITE' ? 'Checkout, payment and delivery happen on their site. If your offer is accepted you get a coupon code or link for that price.' : `By ${d.checkout.methods.map((m) => E.PAY_METHODS[m]).join(', ')}. The seller confirms your payment and handles delivery — ${BRAND} doesn’t process payments or ship orders.`),
        d.bargaining.acceptsOffers && h('div', { className: 'card tint small' }, h('b', null, 'How offers work here: '), `${d.bargaining.mode === 'PUBLIC' ? 'offers are public — other buyers see the amount, never your name' : d.bargaining.mode === 'BOTH' ? 'choose a private or public offer' : 'offers are private between you and the seller'}. The seller has ${d.bargaining.expiryHours} hours to respond. If they accept, one unit is held for you for ${E.RULES.CHECKOUT_WINDOW_HOURS} hours.`),
        d.publicOffers && d.publicOffers.length > 0 && h('div', null, h('div', { className: 'section-title' }, 'Public offers'), d.publicOffers.map((o) => h('div', { key: o.id, className: 'kv' }, h('span', null, h('b', null, o.who), h('span', { className: 'muted small' }, ' · ' + o.variant + ' · ' + ago(o.at, now))), h('span', null, h('b', null, money(o.amount)), ' ', h(Badge, null, o.status))))),
        h('button', { className: 'card row', style: { textAlign: 'left', color: 'var(--ink)' }, onClick: () => nav.go('shop', { sellerId: d.seller.id }) }, h(Avatar, { name: d.seller.name }), h('div', { className: 'grow' }, h('div', { className: 'strong' }, d.seller.name), h('div', { className: 'tiny muted' }, (d.seller.type === 'BUSINESS' ? 'Business' : 'Individual seller') + ' · ' + d.seller.area + ' · Not verified (prototype)'), h('div', { className: 'tiny', style: { marginTop: 2 } }, h(U.StatsLine, { st: d.seller.stats }))), h(Icon, { name: 'back', size: 18, style: { transform: 'rotate(180deg)' } })),
        h('div', null, h('div', { className: 'section-title' }, `Comments (${d.comments})`), h(U.CommentsPanel, { listingId: id, userId: uid, compact: true }))));
  }

  // ---------- Make offer sheet ----------
  function OfferSheet({ listingId, variantId }) {
    const { uid, nav, closeSheet, toast } = useApp(); const now = Store.now();
    const d = B.listing(Store.state, uid, listingId, now);
    const [variant, setVariant] = useState(variantId || (d && d.variants.filter((v) => v.available).length === 1 ? d.variants.find((v) => v.available).id : null));
    const [vis, setVis] = useState('PRIVATE'); const [mode, setMode] = useState('inr'); const [val, setVal] = useState(''); const [error, setError] = useState(null);
    if (!d) return null;
    const amount = U.amountFrom(mode, val, d.price);
    const existing = variant && (d.myNegotiations || []).find((n) => n.variantId === variant && (n.status === 'OPEN' || n.status === 'AGREED'));
    const submit = () => {
      if (!variant) { setError('Choose a size first.'); return; }
      if (amount == null) { setError('Enter your offer.'); return; }
      const r = Store.dispatch({ type: 'offer.make', userId: uid, listingId, variantId: variant, amount, visibility: vis });
      if (!r.ok) { setError(r.message); return; }
      closeSheet(); nav.go('negotiation', { id: r.negotiationId }); toast('Offer sent');
    };
    return h(Sheet, { title: 'Make an offer', onClose: closeSheet, footer: existing ? h(Btn, { block: true, onClick: () => { closeSheet(); nav.go('negotiation', { id: existing.id }); } }, 'View your open offer') : h(Btn, { size: 'lg', block: true, onClick: submit, disabled: !val }, amount ? 'Send offer · ' + money(amount * 100) : 'Send offer') },
      h('div', { className: 'stack' },
        h('div', { className: 'row' }, h(Thumb, { m: d.media[0] }), h('div', { className: 'grow' }, h('div', { className: 'strong ellipsis' }, d.title), h('div', { className: 'small muted' }, 'Listed at ' + money(d.price) + ' · ' + d.seller.name))),
        d.variants.length > 1 && h('div', null, h('div', { className: 'label', style: { marginBottom: 6 } }, 'Size'), h('div', { className: 'chips' }, d.variants.map((v) => h(Chip, { key: v.id, on: variant === v.id, disabled: !v.available, onClick: () => { setVariant(v.id); setError(null); } }, v.label)))),
        existing ? h('div', { className: 'card info small' }, 'You already have an open offer for this size. Continue that negotiation instead.') : h(React.Fragment, null,
          d.bargaining.mode === 'BOTH' && h('div', null, h('div', { className: 'label', style: { marginBottom: 6 } }, 'Who sees this offer'), h(Seg, { label: 'Visibility', value: vis, onChange: setVis, options: [{ value: 'PRIVATE', label: 'Private' }, { value: 'PUBLIC', label: 'Public' }] }), h('div', { className: 'hint', style: { marginTop: 6 } }, vis === 'PUBLIC' ? 'Other buyers see the amount on the listing, not your name.' : 'Only you and the seller see this offer.')),
          d.bargaining.mode === 'PUBLIC' && h('div', { className: 'hint' }, 'Offers on this listing are public: other buyers see the amount, not your name.'),
          h(Field, { label: 'Your offer', id: 'offer-amt', error }, h(U.AmountInput, { listPrice: d.price, value: val, onChange: (v) => { setVal(v); setError(null); }, mode, onMode: (m) => { setMode(m); setVal(''); }, id: 'offer-amt', invalid: !!error, onEnter: submit })),
          !error && h('div', { className: 'hint' }, `Offer below ${money(d.price)}. Offers under ${money(d.platformFloor)} aren’t allowed. The seller has ${d.bargaining.expiryHours} h to respond.`))));
  }

  // ---------- Negotiation thread ----------
  function NegotiationScreen({ id }) {
    const { uid, nav, toast, openSheet } = useApp(); const now = Store.now();
    const d = B.negotiation(Store.state, uid, id, now);
    const [countering, setCountering] = useState(false); const [confirm, setConfirm] = useState(null);
    if (!d) return h(Page, { title: 'Offer', onBack: nav.back }, h(Empty, { title: 'Negotiation not found' }));
    const act = (action, amount) => { const r = Store.dispatch({ type: 'offer.respond', userId: uid, negotiationId: id, action, amount }); if (r.ok) { setCountering(false); toast(action === 'ACCEPT' ? 'Price agreed — checkout is open' : action === 'COUNTER' ? 'Counter sent' : 'Offer declined'); } else toast(r.message, true); return r; };
    const last = d.offers[d.offers.length - 1];
    const order = d.status === 'PURCHASED' ? B.orders(Store.state, uid).find((o) => o.negotiationId === id) : null;
    let footer;
    if (d.status === 'AGREED' && d.channel === 'WEBSITE') footer = h(WebsiteDeal, { d, now });
    else if (d.status === 'AGREED') footer = h(React.Fragment, null, h('div', { className: 'card success' }, h('div', { className: 'strong' }, 'Price agreed: ' + money(d.agreement.price)), h('div', { className: 'small' }, `One unit is held for you until ${when(d.agreement.deadline)} (${left(d.agreement.deadline - now)} left).`)), h(Btn, { size: 'lg', block: true, onClick: () => nav.go('checkout', { negotiationId: id }) }, 'Continue · ' + money(d.agreement.price)));
    else if (d.canRespond) footer = countering ? h(U.CounterBox, { dto: d, onSubmit: (a) => act('COUNTER', a), onCancel: () => setCountering(false) }) : h(React.Fragment, null,
      h('div', { className: 'small' }, h('b', null, `Seller countered ${money(last.amount)}`), ` · respond within ${left(last.expiresAt - now)}`, !d.canCounter ? ' · last round: accept or decline' : ''),
      h('div', { className: 'btn-row' }, h(Btn, { kind: 'primary', onClick: () => act('ACCEPT') }, 'Buy at ' + money(last.amount)), d.canCounter ? h(Btn, { kind: 'outline', onClick: () => setCountering(true) }, 'Counter') : h(Btn, { kind: 'danger', onClick: () => setConfirm('decline') }, 'Decline')),
      d.canCounter && h('button', { className: 'btn ghost sm', onClick: () => setConfirm('decline') }, 'Decline counter'));
    else if (d.canWithdraw) footer = h(React.Fragment, null, h('div', { className: 'small' }, h('b', null, 'Waiting for the seller'), ` · your offer expires in ${left(last.expiresAt - now)}`), h(Btn, { kind: 'outline', block: true, onClick: () => setConfirm('withdraw') }, 'Withdraw offer'));
    else if (d.status === 'PURCHASED') footer = h(Btn, { kind: 'dark', block: true, onClick: () => order && nav.replace('order', { id: order.id }) }, 'View order');
    else footer = h(React.Fragment, null, h('div', { className: 'small muted' }, d.closeText || d.statusLabel), d.listing.status === 'ACTIVE' && h('div', { className: 'btn-row' }, h(Btn, { kind: 'outline', onClick: () => nav.replace('product', { id: d.listing.id }) }, 'View listing'), h(Btn, { kind: 'primary', onClick: () => openSheet('offer', { listingId: d.listing.id, variantId: d.variant.id }) }, 'New offer')));
    return h(Page, { title: 'Offer · ' + d.listing.sellerName, onBack: nav.back, footer },
      h('button', { className: 'listrow', onClick: () => nav.go('product', { id: d.listing.id }) }, h(Thumb, { m: d.listing.media }), h('div', { className: 'grow' }, h('div', { className: 'strong ellipsis' }, d.listing.title), h('div', { className: 'small muted' }, `${U.sizeText(d.variant.label)} · listed ${money(d.listing.price)}`)), h(Badge, { tone: d.status === 'AGREED' || d.status === 'PURCHASED' ? 'success' : d.status === 'OPEN' ? 'accent' : '' }, d.statusLabel)),
      h(U.Timeline, { dto: d, perspective: 'buyer', now }),
      confirm && h(Confirm, confirm === 'withdraw' ? { title: 'Withdraw this offer?', body: 'The seller won’t be able to accept it. You can still buy at the listed price.', confirmLabel: 'Withdraw', danger: true, onCancel: () => setConfirm(null), onConfirm: () => { const r = Store.dispatch({ type: 'offer.withdraw', userId: uid, negotiationId: id }); setConfirm(null); toast(r.ok ? 'Offer withdrawn' : r.message, !r.ok); } } : { title: 'Decline the seller’s counter?', body: `This closes the negotiation. You can still buy later at the listed price of ${money(d.listing.price)}.`, confirmLabel: 'Decline', danger: true, onCancel: () => setConfirm(null), onConfirm: () => { setConfirm(null); act('DECLINE'); } }));
  }

  function WebsiteDeal({ d, now }) {
    const { uid, nav, toast } = useApp(); const da = d.agreement.dealAccess;
    const go = (e) => {
      const r = Store.dispatch({ type: 'order.place', userId: uid, negotiationId: d.id });
      if (!r.ok) { e.preventDefault(); toast(r.message, true); return; }
      if (da.type === 'CODE') U.copyText(da.value, null);
      setTimeout(() => nav.replace('order', { id: r.orderId }), 50);
    };
    return h(React.Fragment, null,
      h('div', { className: 'card success stack', style: { gap: 6 } }, h('div', { className: 'strong' }, `Deal agreed: ${money(d.agreement.price)}${d.agreement.automatic ? ' (automatic)' : ''}`),
        da.type === 'CODE' ? h('div', { className: 'row' }, h('div', { className: 'grow' }, h('div', { className: 'tiny muted strong' }, 'Coupon code for the seller’s website'), h('div', { style: { fontSize: 22, fontWeight: 800, letterSpacing: 1, userSelect: 'all' } }, da.value)), h(Btn, { kind: 'outline', size: 'sm', onClick: () => U.copyText(da.value, toast, 'Code copied') }, 'Copy')) : h('div', { className: 'small' }, 'The seller gave you a link that opens the product at this price.'),
        h('div', { className: 'tiny' }, `Held for you until ${when(d.agreement.deadline)} (${left(d.agreement.deadline - now)} left). Use it on the website before then.`)),
      h('a', { className: 'btn primary lg block', style: { textDecoration: 'none' }, href: da.type === 'LINK' ? da.value : d.productUrl, target: '_blank', rel: 'noopener noreferrer', onClick: go }, da.type === 'CODE' ? 'Copy code and open website' : 'Open discounted link', h(Icon, { name: 'send', size: 16 })),
      h('div', { className: 'tiny muted' }, 'You pay and get delivery on the seller’s website. The seller confirms your order here so you can follow it.'));
  }

  // ---------- Checkout ----------
  function CheckoutScreen({ listingId, variantId, negotiationId }) {
    const { uid, nav, toast, openSheet } = useApp(); const now = Store.now(); const s = Store.state;
    const prof = B.profile(s, uid, now); const addrs = prof.profile.addresses;
    const [addrId, setAddrId] = useState(prof.profile.defaultAddressId); const [method, setMethod] = useState(null); const [busy, setBusy] = useState(false);
    const n = negotiationId ? B.negotiation(s, uid, negotiationId, now) : null;
    const lid = n ? n.listing.id : listingId;
    const ld = lid ? B.listing(s, uid, lid, now) : null;
    let item = null;
    if (n && ld) item = { title: n.listing.title, media: n.listing.media, seller: n.listing.sellerName, variant: n.variant.label, list: n.listing.price, price: n.agreement ? n.agreement.price : null, deadline: n.agreement && n.agreement.deadline, ok: n.status === 'AGREED', why: n.closeText || n.statusLabel };
    else if (ld) { const v = ld.variants.find((x) => x.id === variantId); if (v) item = { title: ld.title, media: ld.media[0], seller: ld.seller.name, variant: v.label, list: ld.price, price: ld.price, ok: ld.status === 'ACTIVE' && v.available, why: 'This size is no longer available.' }; }
    if (!item || !ld) return h(Page, { title: 'Order', onBack: nav.back }, h(Empty, { title: 'Nothing to order' }));
    const methods = ld.checkout.methods || [];
    const m = method || (methods.length === 1 ? methods[0] : null);
    const place = () => {
      if (!m) { toast('Choose how you’ll pay the seller.', true); return; }
      setBusy(true);
      const r = Store.dispatch({ type: 'order.place', userId: uid, listingId, variantId, negotiationId, addressId: addrId, paymentMethod: m });
      setBusy(false);
      if (r.ok) { nav.replace('order', { id: r.orderId }); toast('Order placed — now pay the seller'); } else toast(r.message, true);
    };
    const saved = item.list - (item.price || item.list);
    const DESC = { UPI: 'UPI ID or QR code — any UPI app', BANK: 'NEFT, IMPS or RTGS to the seller’s account', LINK: 'The seller’s own payment page' };
    return h(Page, { title: 'Place order', onBack: nav.back, footer: item.ok ? h(Btn, { size: 'lg', block: true, disabled: busy || !addrId || !m, onClick: place }, 'Place order · ' + money(item.price)) : h('div', { className: 'error' }, item.why) },
      h('div', { className: 'pad stack' },
        h('div', { className: 'row' }, h(Thumb, { m: item.media, lg: true }), h('div', { className: 'grow' }, h('div', { className: 'strong' }, item.title), h('div', { className: 'small muted' }, `${U.sizeText(item.variant)} · Qty 1 · ${item.seller}`))),
        item.deadline && h('div', { className: 'card success small' }, `Agreed price held until ${when(item.deadline)} (${left(item.deadline - now)} left).`),
        h('div', null, h('div', { className: 'section-title', style: { marginTop: 4 } }, 'How you’ll pay the seller'), h('div', { className: 'stack', style: { gap: 8 } }, methods.map((x) => h('button', { key: x, className: 'choice', 'aria-pressed': m === x, onClick: () => setMethod(x), style: { padding: 12 } }, h('div', { className: 'grow' }, h('div', { className: 'strong' }, E.PAY_METHODS[x]), h('div', { className: 'small muted' }, DESC[x])))))),
        h('div', null, h('div', { className: 'section-title' }, 'Deliver to'), h('div', { className: 'stack', style: { gap: 8 } }, addrs.map((a) => h('button', { key: a.id, className: 'choice', 'aria-pressed': addrId === a.id, onClick: () => setAddrId(a.id), style: { padding: 12 } }, h('div', { className: 'grow' }, h('div', { className: 'strong' }, a.label + ' · ' + a.name), h('div', { className: 'small muted' }, U.addrLine(a))))),
          h('button', { className: 'btn ghost sm', style: { alignSelf: 'flex-start', padding: 0 }, onClick: () => openSheet('address', { onSaved: setAddrId }) }, '+ Add another address'))),
        h('div', null, h('div', { className: 'section-title' }, 'Price'), h(Kv, { k: 'Listed price', v: money(item.list) }), saved > 0 && h(Kv, { k: 'Bargain discount', v: '− ' + money(saved), tone: 'success' }), h(Kv, { k: 'Delivery', v: 'Arranged by the seller' }), h('div', { className: 'divider' }), h(Kv, { k: 'You pay the seller', v: money(item.price || item.list), strong: true })),
        h('div', { className: 'card tint small' }, h('b', null, 'How this works: '), `after you place the order you’ll see the seller’s payment details. Pay them directly; the seller confirms when the money arrives and arranges delivery. ${BRAND} doesn’t handle payments, refunds or shipping. If the seller doesn’t confirm within ${E.RULES.ORDER_CONFIRM_WINDOW_HOURS} h, the order expires.`)));
  }

  // ---------- Orders ----------
  const SHORT = { PLACED: 'Awaiting seller', CONFIRMED: 'Confirmed', SHIPPED: 'Shipped', DELIVERED: 'Delivered', CANCELLED: 'Cancelled', EXPIRED: 'Expired' };
  function OrdersScreen() {
    const { uid, nav } = useApp(); const orders = B.orders(Store.state, uid); const now = Store.now();
    return h('div', { className: 'screen' }, h(U.AppBar, { title: 'Orders', right: h(Bell) }),
      orders.length ? orders.map((o) => h('button', { key: o.id, className: 'listrow', onClick: () => nav.go('order', { id: o.id }) }, h(Thumb, { m: o.media }), h('div', { className: 'grow' }, h('div', { className: 'strong ellipsis' }, o.title), h('div', { className: 'tiny muted' }, `${o.number} · ${o.sellerName} · ${ago(o.createdAt, now)}`), h('div', { className: 'small' }, h('b', null, money(o.price)), o.listPrice > o.price ? h('span', { style: { color: 'var(--success)', fontWeight: 700 } }, ' · saved ' + money(o.listPrice - o.price)) : null)), h(Badge, { tone: U.ORDER_TONE[o.status] }, SHORT[o.status])))
        : h(Empty, { icon: 'box', title: 'No orders yet', body: 'Place an order or use an accepted offer and it will appear here.', action: h(Btn, { kind: 'dark', onClick: () => nav.setTab('home') }, 'Browse the feed') }));
  }
  function OrderScreen({ id }) {
    const { uid, nav, toast } = useApp(); const now = Store.now(); const o = B.order(Store.state, uid, id);
    if (!o) return h(Page, { title: 'Order', onBack: nav.back }, h(Empty, { title: 'Order not found' }));
    const p = o.payTo; const note = o.number;
    const copyRow = (k, v, label) => h('div', { className: 'kv' }, h('span', { className: 'muted', style: { whiteSpace: 'nowrap' } }, k), h('span', { className: 'row', style: { gap: 6, minWidth: 0 } }, h('b', { style: { userSelect: 'all', wordBreak: 'break-all', textAlign: 'right' } }, v), h('button', { className: 'btn ghost sm', style: { height: 26, padding: '0 4px' }, onClick: () => U.copyText(v, toast, label || k) }, 'Copy')));
    return h(Page, { title: 'Order ' + o.number, onBack: nav.back }, h('div', { className: 'pad stack' },
      h('div', { className: 'row' }, h(Thumb, { m: o.media, lg: true }), h('div', { className: 'grow' }, h('div', { className: 'strong' }, o.title), h('div', { className: 'small muted' }, `${U.sizeText(o.variantLabel)} · ${o.sellerName}`), h('div', { style: { marginTop: 4 } }, h(Badge, { tone: U.ORDER_TONE[o.status] }, o.statusLabel)))),
      o.status === 'PLACED' && o.channel === 'DIRECT' && p && h('div', { className: 'card tint stack', style: { gap: 6 } },
        h('div', { className: 'h3' }, `Pay ${money(o.price)} to ${p.payeeName}`),
        h('div', { className: 'small' }, `Add ${note} as the payment note or remarks so the seller can match it. The seller has ${left(o.confirmBy - now)} to confirm.`),
        o.paymentMethod === 'UPI' && h(React.Fragment, null, p.upiId && copyRow('UPI ID', p.upiId), p.upiId && h('a', { className: 'btn primary block', style: { textDecoration: 'none' }, href: U.upiLink(p.upiId, p.payeeName, o.price, note) }, `Pay ${money(o.price)} in a UPI app`), p.upiQrMediaId && h('div', { className: 'stack', style: { alignItems: 'center', gap: 4 } }, h('div', { style: { width: 180, height: 180, position: 'relative', borderRadius: 12, overflow: 'hidden', background: '#fff' } }, h(MediaView, { m: { kind: 'image', mediaId: p.upiQrMediaId } })), h('div', { className: 'tiny muted' }, 'Seller’s QR code — enter the amount yourself')), h('div', { className: 'tiny muted' }, 'The UPI button opens a UPI app on phones that have one.')),
        o.paymentMethod === 'BANK' && p.bank && h(React.Fragment, null, copyRow('Account name', p.bank.holder), copyRow('Account no.', p.bank.account), copyRow('IFSC', p.bank.ifsc), p.bank.bankName && h(Kv, { k: 'Bank', v: p.bank.bankName }), copyRow('Amount', String(o.price / 100))),
        o.paymentMethod === 'LINK' && p.paymentLink && h(React.Fragment, null, h('a', { className: 'btn primary block', style: { textDecoration: 'none' }, href: p.paymentLink, target: '_blank', rel: 'noopener noreferrer' }, 'Open the seller’s payment link', h(Icon, { name: 'send', size: 16 })), h('div', { className: 'tiny muted' }, `Enter ${money(o.price)} and ${note} if the page asks.`)),
        h('div', { className: 'tiny muted' }, `Payments go straight to the seller. ${BRAND} can’t see, refund or recover them.`)),
      o.status === 'PLACED' && o.channel === 'WEBSITE' && h('div', { className: 'card tint stack', style: { gap: 6 } }, h('div', { className: 'strong' }, 'Finish your order on the seller’s website'), o.dealAccess && o.dealAccess.type === 'CODE' && copyRow('Coupon code', o.dealAccess.value, 'Code'), h('a', { className: 'btn outline block', style: { textDecoration: 'none' }, href: o.dealAccess && o.dealAccess.type === 'LINK' ? o.dealAccess.value : o.productUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Open website', h(Icon, { name: 'send', size: 16 })), h('div', { className: 'tiny muted' }, `The seller confirms the order here within ${left(o.confirmBy - now)}, otherwise it expires.`)),
      h(U.OrderSteps, { order: o }),
      h(U.ShipmentCard, { sh: o.shipment }),
      h('div', null, h('div', { className: 'section-title' }, 'Price'), h(Kv, { k: 'Listed price', v: money(o.listPrice) }), h(Kv, { k: o.priceSource === 'NEGOTIATED' ? 'Agreed price' : 'Price', v: money(o.price) }), o.listPrice > o.price && h(Kv, { k: 'You saved', v: money(o.listPrice - o.price), tone: 'success', strong: true }), h(Kv, { k: 'Paid via', v: o.channel === 'WEBSITE' ? 'Seller’s website' : E.PAY_METHODS[o.paymentMethod] + ' (direct to seller)' })),
      o.address && h('div', null, h('div', { className: 'section-title' }, 'Delivery address'), h('div', { className: 'small' }, o.address.name + ', ' + U.addrLine(o.address))),
      h('div', { className: 'hint' }, `Only the seller updates this order. ${BRAND} doesn’t handle payments, delivery or refunds.`)));
  }

  // ---------- Offers tab ----------
  function OffersScreen() {
    const { uid, nav } = useApp(); const now = Store.now(); const [f, setF] = useState('active');
    const all = B.negotiations(Store.state, uid, now); const list = all.filter((n) => (f === 'active') === (n.status === 'OPEN' || n.status === 'AGREED'));
    return h('div', { className: 'screen' }, h(U.AppBar, { title: 'Your offers', right: h(Bell) }),
      h('div', { style: { padding: '12px 16px' } }, h(Seg, { label: 'Filter', value: f, onChange: setF, options: [{ value: 'active', label: `Active (${all.filter((n) => n.status === 'OPEN' || n.status === 'AGREED').length})` }, { value: 'past', label: 'Past' }] })),
      list.length ? list.map((n) => { const last = n.offers[n.offers.length - 1]; return h('button', { key: n.id, className: 'listrow', onClick: () => nav.go('negotiation', { id: n.id }) }, h(Thumb, { m: n.listing.media }), h('div', { className: 'grow' }, h('div', { className: 'strong ellipsis' }, n.listing.title), h('div', { className: 'tiny muted' }, `${n.listing.sellerName} · ${U.sizeText(n.variant.label).toLowerCase()} · ${n.visibility === 'PUBLIC' ? 'public' : 'private'}`), h('div', { className: 'small' }, h('b', null, money(n.agreement ? n.agreement.price : last.amount)), n.status === 'OPEN' ? ' · ' + left(last.expiresAt - now) + ' left' : n.status === 'AGREED' ? ' · checkout within ' + left(n.agreement.deadline - now) : '')), h(Badge, { tone: n.canRespond ? 'accent' : n.status === 'AGREED' ? 'success' : '' }, n.canRespond ? 'Your turn' : n.statusLabel)); })
        : h(Empty, { icon: 'tag', title: f === 'active' ? 'No active offers' : 'No past offers', body: 'Tap Make offer on a listing that accepts offers. Replies from sellers show up here.' }));
  }

  // ---------- Search ----------
  function SearchScreen() {
    const { uid, nav } = useApp(); const now = Store.now();
    const [q, setQ] = useState({ text: '', category: 'All', maxPrice: null, size: null, offersOnly: false, sellerType: null });
    const set = (k, v) => setQ(Object.assign({}, q, { [k]: v }));
    const res = B.search(Store.state, uid, now, q); const sizes = B.sizes(Store.state);
    const reset = () => setQ({ text: '', category: 'All', maxPrice: null, size: null, offersOnly: false, sellerType: null });
    return h('div', { className: 'screen' }, h(U.AppBar, { title: 'Search', right: h(Bell) }), h('div', { className: 'pad stack', style: { gap: 10 } },
      h('div', { className: 'input-group' }, h(Input, { 'aria-label': 'Search', placeholder: 'Search kurtas, sarees, shops…', value: q.text, onChange: (e) => set('text', e.target.value), type: 'search' })),
      h('div', { className: 'chips scroll' }, ['All'].concat(E.CATEGORIES).map((c) => h(Chip, { key: c, on: q.category === c, onClick: () => set('category', c) }, c))),
      h('div', { className: 'chips scroll' }, h(Chip, { accent: true, on: q.offersOnly, onClick: () => set('offersOnly', !q.offersOnly) }, 'Accepts offers'), [100000, 200000, 500000].map((p) => h(Chip, { key: p, accent: true, on: q.maxPrice === p, onClick: () => set('maxPrice', q.maxPrice === p ? null : p) }, 'Under ' + money(p))), h(Chip, { accent: true, on: q.sellerType === 'BUSINESS', onClick: () => set('sellerType', q.sellerType === 'BUSINESS' ? null : 'BUSINESS') }, 'Business sellers'), h(Chip, { accent: true, on: q.sellerType === 'INDIVIDUAL', onClick: () => set('sellerType', q.sellerType === 'INDIVIDUAL' ? null : 'INDIVIDUAL') }, 'Individual sellers')),
      h('div', { className: 'chips scroll' }, h('span', { className: 'small muted strong', style: { alignSelf: 'center' } }, 'Size'), sizes.map((z) => h(Chip, { key: z, accent: true, on: q.size === z, onClick: () => set('size', q.size === z ? null : z) }, z))),
      h('div', { className: 'row between' }, h('span', { className: 'small muted' }, `${res.length} result${res.length === 1 ? '' : 's'}`), h('button', { className: 'btn ghost sm', style: { padding: 0 }, onClick: reset }, 'Clear filters')),
      res.length ? h('div', { className: 'grid2' }, res.map((it) => h(Tile, { key: it.id, it, onClick: () => nav.go('product', { id: it.id }) }))) : h(Empty, { icon: 'search', title: 'No matches', body: 'Try fewer filters or a different word.', action: h(Btn, { kind: 'dark', onClick: reset }, 'Clear filters') })));
  }
  function Tile({ it, onClick }) {
    return h('button', { className: 'tile', onClick }, h('div', { className: 'media' }, h(MediaView, { m: it.media[0], small: true }), it.soldOut && h('div', { className: 'seed-tag', style: { top: 8 } }, 'Sold out')),
      h('div', { className: 'strong small ellipsis', style: { width: '100%' } }, it.title), h('div', { className: 'row', style: { gap: 6 } }, h('b', null, money(it.price)), it.bargaining.acceptsOffers && h(Badge, { tone: 'accent' }, 'Offers')), h('div', { className: 'tiny muted ellipsis', style: { width: '100%' } }, it.seller.name));
  }

  // ---------- Profile & shop ----------
  function ProfileScreen() {
    const { uid, nav, openSheet, toast } = useApp(); const now = Store.now(); const p = B.profile(Store.state, uid, now);
    const [confirmDel, setConfirmDel] = useState(null);
    return h('div', { className: 'screen' }, h(U.AppBar, { title: 'Profile', right: h(Bell) }), h('div', { className: 'pad stack' },
      h('div', { className: 'row' }, h(Avatar, { name: p.user.name, lg: true }), h('div', { className: 'grow' }, h('div', { className: 'h3', style: { fontSize: 18 } }, p.user.name), h('div', { className: 'small muted' }, '+91 ' + p.user.phone)), h(Btn, { kind: 'outline', size: 'sm', onClick: () => openSheet('name') }, 'Edit')),
      h('div', { className: 'card tint' }, h('div', { className: 'small muted strong' }, 'Saved by bargaining'), h('div', { style: { fontSize: 30, fontWeight: 800, color: 'var(--accent)', letterSpacing: -0.6 } }, money(p.savings)), h('div', { className: 'small muted' }, `Across ${p.orderCount} order${p.orderCount === 1 ? '' : 's'}, compared with listed prices`)),
      h('div', null, h('div', { className: 'section-title' }, `Saved items (${p.saved.length})`), p.saved.length ? h('div', { className: 'grid2' }, p.saved.map((it) => h(Tile, { key: it.id, it, onClick: () => nav.go('product', { id: it.id }) }))) : h('div', { className: 'small muted' }, 'Tap Save on a reel to keep it here.')),
      h('div', null, h('div', { className: 'section-title' }, `Following (${p.following.length})`), p.following.length ? p.following.map((x) => h('button', { key: x.id, className: 'listrow', style: { padding: '10px 0' }, onClick: () => nav.go('shop', { sellerId: x.id }) }, h(Avatar, { name: x.name }), h('div', { className: 'grow' }, h('div', { className: 'strong' }, x.name), h('div', { className: 'tiny muted' }, '@' + x.handle + ' · ' + x.area)))) : h('div', { className: 'small muted' }, 'Follow shops to see their posts in your Following feed.')),
      h('div', null, h('div', { className: 'section-title' }, 'Addresses'), p.profile.addresses.map((a) => h('div', { key: a.id, className: 'card', style: { marginBottom: 8 } }, h('div', { className: 'row between' }, h('div', { className: 'strong' }, a.label + ' · ' + a.name), h('div', { className: 'row', style: { gap: 4 } }, h('button', { className: 'iconbtn plain', 'aria-label': 'Edit address', onClick: () => openSheet('address', { address: a }) }, h(Icon, { name: 'edit', size: 18 })), p.profile.addresses.length > 1 && h('button', { className: 'iconbtn plain', 'aria-label': 'Delete address', onClick: () => setConfirmDel(a) }, h(Icon, { name: 'trash', size: 18 })))), h('div', { className: 'small muted' }, U.addrLine(a)))), h(Btn, { kind: 'outline', size: 'sm', onClick: () => openSheet('address') }, '+ Add address')),
      h('div', { className: 'card' }, h('div', { className: 'strong' }, p.hasShop ? 'You also have a shop' : 'Want to sell?'), h('div', { className: 'small muted' }, p.hasShop ? 'Manage it in the seller app with this same number.' : 'Open the seller app and sign in with this number. Your account works in both apps.')),
      h(Btn, { kind: 'danger', block: true, onClick: () => Store.dispatch({ type: 'auth.signOut', app: 'buyer' }) }, 'Sign out')),
      confirmDel && h(Confirm, { title: 'Delete this address?', body: U.addrLine(confirmDel), confirmLabel: 'Delete', danger: true, onCancel: () => setConfirmDel(null), onConfirm: () => { const r = Store.dispatch({ type: 'buyer.deleteAddress', userId: uid, addressId: confirmDel.id }); setConfirmDel(null); toast(r.ok ? 'Address deleted' : r.message, !r.ok); } }));
  }
  function ShopScreen({ sellerId }) {
    const { uid, nav, toast } = useApp(); const d = B.shop(Store.state, uid, sellerId, Store.now());
    if (!d) return h(Page, { title: 'Shop', onBack: nav.back }, h(Empty, { title: 'Shop not found' }));
    const x = d.seller;
    return h(Page, { title: x.name, onBack: nav.back }, h('div', { className: 'pad stack' },
      h('div', { className: 'row' }, h(Avatar, { name: x.name, lg: true }), h('div', { className: 'grow' }, h('div', { className: 'h3', style: { fontSize: 18 } }, x.name), h('div', { className: 'small muted' }, '@' + x.handle + ' · ' + x.area + ', ' + x.city), h('div', { className: 'row', style: { gap: 6, marginTop: 4 } }, h(Badge, null, x.type === 'BUSINESS' ? 'Business' : 'Individual'), h(Badge, null, 'Not verified (prototype)')))),
      x.bio && h('div', null, x.bio),
      h('div', { className: 'card small' }, h('div', { className: 'strong', style: { marginBottom: 2 } }, 'Order record'), h(U.StatsLine, { st: x.stats }), h('div', { className: 'tiny muted', style: { marginTop: 4 } }, 'Based on what the seller confirmed in the app. Buyers pay sellers directly.')),
      h('div', { className: 'row' }, h('span', { className: 'small muted' }, `${x.followers} follower${x.followers === 1 ? '' : 's'} · ${d.listings.length} listing${d.listings.length === 1 ? '' : 's'}`), h('div', { className: 'grow' }), !x.isMe && h(Btn, { kind: x.following ? 'outline' : 'dark', size: 'sm', onClick: () => { const r = Store.dispatch({ type: 'social.toggleFollow', userId: uid, sellerId }); if (!r.ok) toast(r.message, true); } }, x.following ? 'Following' : 'Follow')),
      d.listings.length ? h('div', { className: 'grid2' }, d.listings.map((it) => h(Tile, { key: it.id, it, onClick: () => nav.go('product', { id: it.id }) }))) : h(Empty, { title: 'No listings right now' })));
  }

  // ---------- sheets ----------
  function CommentsSheet({ listingId }) { const { uid, closeSheet } = useApp(); return h(Sheet, { title: 'Comments', onClose: closeSheet }, h(U.CommentsPanel, { listingId, userId: uid })); }
  function CategorySheet({ value, onPick }) {
    const { closeSheet } = useApp();
    return h(Sheet, { title: 'Category', onClose: closeSheet }, h('div', { className: 'chips' }, ['All'].concat(E.CATEGORIES).map((c) => h(Chip, { key: c, accent: true, on: value === c, onClick: () => { onPick(c); closeSheet(); } }, c))));
  }
  function AddressSheet({ address, onSaved }) {
    const { uid, closeSheet, toast } = useApp(); const u = Store.state.users[uid];
    const [v, setV] = useState(address ? Object.assign({}, address) : Object.assign({}, U.EMPTY_ADDR, { name: u.name })); const [errors, setErrors] = useState({});
    const save = () => { const r = Store.dispatch({ type: 'buyer.saveAddress', userId: uid, address: v }); if (!r.ok) { setErrors(r.fields || {}); return; } if (onSaved) onSaved(r.addressId); closeSheet(); toast('Address saved'); };
    return h(Sheet, { title: address ? 'Edit address' : 'Add address', onClose: closeSheet, footer: h(Btn, { block: true, onClick: save }, 'Save address') }, h(U.AddressForm, { value: v, onChange: setV, errors, idp: 'as-' }));
  }
  function NameSheet() {
    const { uid, closeSheet, toast } = useApp(); const [v, setV] = useState(Store.state.users[uid].name); const [e, setE] = useState(null);
    const save = () => { const r = Store.dispatch({ type: 'user.updateName', userId: uid, name: v }); if (!r.ok) { setE(r.message); return; } closeSheet(); toast('Name updated'); };
    return h(Sheet, { title: 'Your name', onClose: closeSheet, footer: h(Btn, { block: true, onClick: save }, 'Save') }, h(Field, { label: 'Name', id: 'nm', error: e }, h(Input, { id: 'nm', value: v, onChange: (x) => setV(x.target.value) })));
  }
  function NotificationsScreen() {
    const { uid, nav } = useApp();
    return h(U.Notifications, { app: 'buyer', userId: uid, onBack: nav.back, onOpen: (ref) => { if (ref.type === 'negotiation') nav.replace('negotiation', { id: ref.id }); if (ref.type === 'order') nav.replace('order', { id: ref.id }); if (ref.type === 'listing') nav.replace('product', { id: ref.id }); } });
  }

  const SCREENS = { product: ProductScreen, negotiation: NegotiationScreen, checkout: CheckoutScreen, order: OrderScreen, shop: ShopScreen, notifications: NotificationsScreen };
  const SHEETS = { offer: OfferSheet, comments: CommentsSheet, category: CategorySheet, address: AddressSheet, name: NameSheet };
  window.FaydaBuyerApp = BuyerApp;
})();
