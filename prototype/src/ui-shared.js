/* Shared flows used by both apps. */
(function () {
  'use strict';
  const U = window.FaydaUI; const { h, E, Store, money, left, ago, when, Icon, Btn, Field, Input, Chip, Badge, Empty, Page, Avatar, Kv, BRAND } = U;
  const { useState, useEffect, useRef } = React;

  const DEMO = {
    buyer: [{ phone: '9876543210', name: 'Aarav Sharma', note: 'Buyer · follows Indigo Threads' }, { phone: '9123456789', name: 'Priya Nair', note: 'Buyer · has open offers' }],
    seller: [{ phone: '9000011111', name: 'Indigo Threads', note: 'Business · Banjara Hills' }, { phone: '9000033333', name: 'Loom & Co.', note: 'Business · Jubilee Hills' }, { phone: '9000022222', name: 'Meher’s Closet', note: 'Individual · Kondapur' }]
  };

  function AuthFlow({ app }) {
    const [step, setStep] = useState('phone'); const [phone, setPhone] = useState(''); const [code, setCode] = useState('');
    const [error, setError] = useState(null); const [sentAt, setSentAt] = useState(0); const [, force] = useState(0);
    useEffect(() => { const t = setInterval(() => force((x) => x + 1), 1000); return () => clearInterval(t); }, []);
    const valid = /^[6-9]\d{9}$/.test(phone);
    const send = () => { if (!valid) { setError('Enter a valid 10-digit mobile number starting with 6–9.'); return; } setError(null); setCode(''); setSentAt(Date.now()); setStep('otp'); };
    const verify = () => { const r = Store.dispatch({ type: 'auth.verifyOtp', phone, code, app }); if (!r.ok) setError(r.message); };
    const wait = Math.max(0, 30 - Math.floor((Date.now() - sentAt) / 1000));
    const seller = app === 'seller';
    return h('div', { className: 'screen' }, h('div', { className: 'pad stack', style: { gap: 22, paddingTop: 28 } },
      h('div', { className: 'row' }, h('div', { style: { width: 40, height: 40, borderRadius: 12, background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' } }, h(Icon, { name: seller ? 'store' : 'tag', size: 22 })), h('div', { style: { fontSize: 22, fontWeight: 800, letterSpacing: -0.5 } }, BRAND, seller ? h('span', { className: 'muted', style: { fontWeight: 700, fontSize: 15 } }, ' Seller') : null)),
      step === 'phone' ? h('div', { className: 'stack', style: { gap: 18 } },
        h('div', null, h('div', { className: 'h2', style: { fontSize: 30, lineHeight: 1.12 } }, seller ? 'Post once. Sell on your terms.' : 'Shop it. Bargain it.'),
          h('p', { className: 'muted', style: { margin: '8px 0 0', fontSize: 15 } }, seller ? 'Publish videos and photos, set your price and private bargaining rules, and answer offers in one place.' : 'Watch product videos, then buy or make an offer directly to the seller.')),
        h(Field, { label: 'Mobile number', id: app + '-phone', error }, h('div', { className: 'input-group' }, h('div', { className: 'prefix' }, '+91'), h(Input, { id: app + '-phone', type: 'tel', inputMode: 'numeric', autoComplete: 'tel-national', maxLength: 10, placeholder: '10-digit mobile number', value: phone, invalid: !!error, onChange: (e) => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setError(null); }, onKeyDown: (e) => e.key === 'Enter' && send() }))),
        h(Btn, { kind: 'dark', size: 'lg', block: true, onClick: send }, 'Send code'),
        h('div', { className: 'card', style: { background: 'var(--surface-3)' } },
          h('div', { className: 'small strong', style: { marginBottom: 8 } }, 'Demo accounts'),
          h('div', { className: 'stack', style: { gap: 6 } }, DEMO[app].map((d) => h('button', { key: d.phone, className: 'listrow', style: { padding: '8px 4px', borderRadius: 10, borderBottom: 0 }, onClick: () => { setPhone(d.phone); setError(null); } }, h(Avatar, { name: d.name }), h('div', { className: 'grow' }, h('div', { className: 'strong' }, d.name), h('div', { className: 'tiny muted' }, '+91 ' + d.phone + ' · ' + d.note))))),
          h('div', { className: 'tiny muted', style: { marginTop: 8 } }, 'Any other number creates a new account. The same number signs in to both apps as one person.'))
      ) : h('div', { className: 'stack', style: { gap: 18 } },
        h('button', { className: 'iconbtn', onClick: () => { setStep('phone'); setError(null); }, 'aria-label': 'Back' }, h(Icon, { name: 'back' })),
        h('div', null, h('div', { className: 'h2', style: { fontSize: 26 } }, 'Enter the 6-digit code'), h('p', { className: 'muted', style: { margin: '6px 0 0' } }, 'Sent to +91 ' + phone.replace(/(\d{5})(\d{5})/, '$1 $2'))),
        h('div', { className: 'card tint small' }, h('b', null, 'Simulated sign-in: '), 'no SMS is sent in this prototype. Use code ', h('b', null, '123456'), '.'),
        h(Field, { label: 'Verification code', id: app + '-otp', error }, h(Input, { id: app + '-otp', className: 'input otp', inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 6, placeholder: '••••••', value: code, invalid: !!error, autoFocus: true, onChange: (e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null); }, onKeyDown: (e) => e.key === 'Enter' && verify() })),
        h(Btn, { kind: 'primary', size: 'lg', block: true, onClick: verify, disabled: code.length !== 6 }, 'Verify and continue'),
        h('div', { className: 'small muted' }, wait > 0 ? `Resend code in 0:${String(wait).padStart(2, '0')}` : h('button', { className: 'btn ghost sm', style: { padding: 0 }, onClick: () => { setSentAt(Date.now()); setError(null); } }, 'Resend code'))
      )));
  }

  const EMPTY_ADDR = { label: 'Home', name: '', line1: '', line2: '', landmark: '', pin: '', city: 'Hyderabad', state: 'Telangana' };
  function AddressForm({ value, onChange, errors, idp }) {
    const set = (k) => (e) => onChange(Object.assign({}, value, { [k]: k === 'pin' ? e.target.value.replace(/\D/g, '').slice(0, 6) : e.target.value }));
    const f = (k, label, extra) => h(Field, { label, id: idp + k, error: errors && errors[k] }, h(Input, Object.assign({ id: idp + k, value: value[k], invalid: !!(errors && errors[k]), onChange: set(k) }, extra || {})));
    return h('div', { className: 'stack' },
      f('name', 'Recipient name', { autoComplete: 'name' }), f('line1', 'Flat, house no., building', { autoComplete: 'address-line1' }), f('line2', 'Area, street, locality', { autoComplete: 'address-line2' }), f('landmark', 'Landmark (optional)'),
      h('div', { className: 'grid2' }, f('pin', 'PIN code', { inputMode: 'numeric', autoComplete: 'postal-code' }), f('city', 'City', { autoComplete: 'address-level2' })), f('state', 'State', { autoComplete: 'address-level1' }),
      h('div', null, h('div', { className: 'label', style: { marginBottom: 6 } }, 'Save as'), h('div', { className: 'chips' }, ['Home', 'Work', 'Other'].map((l) => h(Chip, { key: l, on: value.label === l, onClick: () => onChange(Object.assign({}, value, { label: l })) }, l)))));
  }
  const addrLine = (a) => [a.line1, a.line2, a.landmark, a.city + ' ' + a.pin].filter(Boolean).join(', ');

  function CommentsPanel({ listingId, userId, compact }) {
    const now = Store.now(); const list = E.common.comments(Store.state, listingId);
    const [text, setText] = useState(''); const [error, setError] = useState(null);
    const post = () => { const r = Store.dispatch({ type: 'social.comment', userId, listingId, text }); if (r.ok) { setText(''); setError(null); } else setError(r.message); };
    return h('div', { className: 'stack' },
      list.length ? list.map((c) => h('div', { key: c.id, className: 'row', style: { alignItems: 'flex-start' } }, h(Avatar, { name: c.shopName || c.name }),
        h('div', { className: 'grow' }, h('div', { className: 'row', style: { gap: 6 } }, h('span', { className: 'strong small' }, c.shopName || c.name), c.isSeller && h(Badge, { tone: 'accent' }, 'Seller'), h('span', { className: 'tiny muted' }, ago(c.at, now))), h('div', null, c.text))))
        : h('div', { className: 'muted small', style: { padding: '8px 0' } }, compact ? 'No comments yet.' : 'No comments yet. Ask about fit, fabric or delivery.'),
      h(Field, { label: 'Add a comment', id: 'cm-' + listingId, error }, h('div', { className: 'input-group' }, h(Input, { id: 'cm-' + listingId, placeholder: 'Write a comment…', value: text, maxLength: 300, onChange: (e) => { setText(e.target.value); setError(null); }, onKeyDown: (e) => e.key === 'Enter' && post() }), h(Btn, { kind: 'dark', onClick: post, disabled: !text.trim() }, 'Post'))));
  }

  function Notifications({ app, userId, onBack, onOpen }) {
    const [list] = useState(() => E.common.notifications(Store.state, userId, app));
    useEffect(() => { Store.dispatch({ type: 'notifications.markRead', userId, app }); }, []);
    const now = Store.now();
    return h(Page, { title: 'Notifications', onBack }, list.length ? list.map((n) => h('button', { key: n.id, className: 'listrow', onClick: () => n.ref && onOpen(n.ref), style: n.read ? null : { background: 'var(--accent-tint)' } },
      h('div', { className: 'grow' }, h('div', { style: { fontWeight: n.read ? 500 : 700 } }, n.text), h('div', { className: 'tiny muted' }, ago(n.at, now)))))
      : h(Empty, { icon: 'bell', title: 'You’re all caught up', body: app === 'seller' ? 'Offers, orders and comments will show up here.' : 'Replies to your offers and order updates will show up here.' }));
  }

  // Structured negotiation rendered as a timeline (presentation kept from the prototype's bargain chat)
  const OFFER_STATUS = { PENDING: 'Pending', COUNTERED: 'Countered', ACCEPTED: 'Accepted', DECLINED: 'Declined', EXPIRED: 'Expired', WITHDRAWN: 'Withdrawn', INVALIDATED: 'Closed' };
  function Timeline({ dto, perspective, now }) {
    const items = [];
    dto.offers.forEach((o, i) => {
      const mine = o.side === 'ME';
      const who = mine ? (perspective === 'buyer' ? 'Your offer' : (o.automatic ? 'Automatic counter' : 'Your counter')) : (perspective === 'buyer' ? (o.automatic ? 'Seller’s counter · automatic' : 'Seller’s counter') : (i === 0 ? 'Buyer’s offer' : 'Buyer’s counter'));
      const statusText = o.status === 'PENDING' ? 'Waiting · expires in ' + left(o.expiresAt - now) : OFFER_STATUS[o.status];
      items.push({ at: o.at, k: o.id, node: h('div', { className: 'bubble ' + (mine ? 'me' : 'them') }, h('span', { className: 'meta', style: { marginTop: 0, marginBottom: 2 } }, who), h('span', { className: 'amt' }, money(o.amount)), h('span', { className: 'meta' }, `${U.pctOff(dto.listing.price, o.amount)}% off · ${statusText}`)) });
    });
    dto.events.forEach((e, i) => {
      let text = null;
      if (e.type === 'ACCEPTED') text = e.actor === 'AUTO' ? 'Accepted automatically by the seller’s settings' : (e.actor === 'ME' ? 'You accepted' : (perspective === 'buyer' ? 'Seller accepted' : 'Buyer accepted'));
      if (e.type === 'CLOSED') text = dto.closeText;
      if (e.type === 'LAPSED') text = 'Checkout window closed — the reserved unit was released';
      if (e.type === 'PURCHASED') text = 'Purchased at the agreed price';
      if (text) items.push({ at: e.at + 1, k: 'e' + i, node: h('div', { className: 'sysmsg' }, text + ' · ' + when(e.at)) });
    });
    items.sort((a, b) => a.at - b.at);
    const endRef = useRef(null); const count = items.length;
    useEffect(() => { if (endRef.current && endRef.current.scrollIntoView) endRef.current.scrollIntoView({ block: 'end' }); }, [count]);
    return h('div', { className: 'timeline' }, h('div', { className: 'sysmsg' }, (dto.visibility === 'PUBLIC' ? 'Public negotiation: other buyers see amounts, not names' : 'Private negotiation: only you and the ' + (perspective === 'buyer' ? 'seller' : 'buyer') + ' see this')), items.map((x) => h(React.Fragment, { key: x.k }, x.node)), h('div', { ref: endRef }));
  }

  function CounterBox({ dto, onSubmit, onCancel, requireDeal }) {
    const [mode, setMode] = useState('inr'); const [val, setVal] = useState(''); const [error, setError] = useState(null);
    const [deal, setDeal] = useState({ type: 'CODE', value: '' }); const [dealErr, setDealErr] = useState(null);
    const b = dto.counterBounds; const lo = b.minExclusive, hi = b.maxExclusive;
    const submit = () => { const r = U.amountFrom(mode, val, dto.listing.price); if (r == null || !(r > 0)) { setError('Enter an amount.'); return; } const res = onSubmit(r, requireDeal ? deal : undefined); if (res && !res.ok) { if (res.code === 'DEAL_ACCESS_REQUIRED') setDealErr(res.message); else setError(res.message); } };
    return h('div', { className: 'stack', style: { gap: 8 } },
      h(U.AmountInput, { listPrice: dto.listing.price, value: val, onChange: (v) => { setVal(v); setError(null); }, mode, onMode: (m) => { setMode(m); setVal(''); }, id: 'counter-' + dto.id, invalid: !!error, autoFocus: true, onEnter: submit }),
      error ? h('div', { className: 'error' }, error) : h('div', { className: 'hint' }, `Your counter must be above ${money(lo)} and below ${money(hi)}.`),
      requireDeal && h(DealAccessInput, { label: 'Code or link that gives this price on your website', value: deal, onChange: (d) => { setDeal(d); setDealErr(null); }, error: dealErr, id: 'deal-' + dto.id }),
      h('div', { className: 'btn-row' }, h(Btn, { kind: 'outline', onClick: onCancel }, 'Cancel'), h(Btn, { kind: 'primary', onClick: submit, disabled: !val }, 'Send counter')));
  }

  function OrderSteps({ order }) {
    const at = {}; order.events.forEach((e) => { at[e.status] = e.at; });
    const web = order.channel === 'WEBSITE';
    const steps = [['PLACED', web ? 'Order started on the seller’s website' : 'Order placed', web ? 'Buyer used the deal on the website' : 'Buyer pays the seller directly'], ['CONFIRMED', web ? 'Confirmed by seller' : 'Payment received', web ? 'Seller found the order on their website' : 'Seller confirmed the payment arrived'], ['SHIPPED', 'Shipped', 'Optional — seller adds courier or delivery details'], ['DELIVERED', 'Delivered', 'Seller marked it delivered']];
    const closed = order.status === 'CANCELLED' || order.status === 'EXPIRED';
    return h('div', { className: 'status-steps' }, steps.filter(([k]) => !(closed && !at[k])).map(([k, t, d]) => h('div', { key: k, className: 'st' + (at[k] ? ' done' : '') }, h('div', { className: 'pt' }, at[k] ? h(Icon, { name: 'check', size: 12, sw: 3 }) : null), h('div', null, h('div', { className: 'strong' }, t), h('div', { className: 'tiny muted' }, at[k] ? when(at[k]) : (k === 'SHIPPED' && at.DELIVERED ? 'Skipped' : d))))),
      closed && h('div', { className: 'st' }, h('div', { className: 'pt', style: { background: 'var(--danger)', borderColor: 'var(--danger)', color: '#fff' } }, h(Icon, { name: 'x', size: 12, sw: 3 })), h('div', null, h('div', { className: 'strong' }, order.status === 'CANCELLED' ? 'Cancelled by seller' : 'Expired'), h('div', { className: 'tiny muted' }, (order.status === 'CANCELLED' ? (order.cancelText + (order.cancelNote ? ' — ' + order.cancelNote : '')) : `Not confirmed within ${E.RULES.ORDER_CONFIRM_WINDOW_HOURS} h`) + ' · ' + when(at[order.status])))));
  }
  const ORDER_TONE = { PLACED: 'info', CONFIRMED: 'accent', SHIPPED: 'accent', DELIVERED: 'success', CANCELLED: 'danger', EXPIRED: 'danger' };
  const MODE_LABEL = { FIXED: 'Fixed price', PRIVATE: 'Private offers', PUBLIC: 'Public offers', BOTH: 'Private or public offers' };

  function ShipmentCard({ sh }) {
    if (!sh) return null;
    return h('div', { className: 'card' }, h('div', { className: 'strong', style: { marginBottom: 4 } }, 'Shipment details'),
      sh.carrier && h(Kv, { k: 'Courier', v: sh.carrier }), sh.trackingId && h(Kv, { k: 'Tracking no.', v: sh.trackingId }), sh.expectedDate && h(Kv, { k: 'Expected', v: new Date(sh.expectedDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) }), sh.note && h('div', { className: 'small', style: { marginTop: 4 } }, sh.note),
      sh.trackingUrl && h('a', { className: 'btn outline sm', style: { marginTop: 8, textDecoration: 'none' }, href: sh.trackingUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Track shipment'));
  }
  function ShipmentFields({ value, onChange, errors, idp }) {
    const set = (k) => (e) => onChange(Object.assign({}, value, { [k]: e.target.value }));
    const f = (k, label, extra) => h(Field, { label, id: idp + k, error: errors && errors[k] }, h(Input, Object.assign({ id: idp + k, value: value[k] || '', invalid: !!(errors && errors[k]), onChange: set(k) }, extra || {})));
    return h('div', { className: 'stack' }, h('div', { className: 'grid2' }, f('carrier', 'Courier', { placeholder: 'e.g. DTDC' }), f('trackingId', 'Tracking no.')), f('trackingUrl', 'Tracking link', { placeholder: 'https://', inputMode: 'url' }), f('expectedDate', 'Expected delivery', { type: 'date' }), f('note', 'Note for the buyer', { placeholder: 'e.g. Hand delivery on Saturday' }), errors && errors.shipment && h('div', { className: 'error' }, errors.shipment));
  }

  function DealAccessInput({ value, onChange, error, id, label }) {
    const v = value || { type: 'CODE', value: '' };
    return h('div', { className: 'stack', style: { gap: 6 } }, label && h('div', { className: 'label' }, label),
      h(U.Seg, { label: 'Code or link', value: v.type, onChange: (t) => onChange({ type: t, value: '' }), options: [{ value: 'CODE', label: 'Coupon code' }, { value: 'LINK', label: 'Discount link' }] }),
      h(Input, { id, value: v.value, invalid: !!error, placeholder: v.type === 'CODE' ? 'e.g. FAYDA2200' : 'https://yourshop.com/product?deal=…', autoCapitalize: v.type === 'CODE' ? 'characters' : 'none', inputMode: v.type === 'LINK' ? 'url' : 'text', onChange: (e) => onChange({ type: v.type, value: v.type === 'CODE' ? e.target.value.toUpperCase().replace(/\s/g, '') : e.target.value.trim() }) }),
      error ? h('div', { className: 'error' }, error) : h('div', { className: 'hint' }, v.type === 'CODE' ? 'A code that already exists on your website and gives this price.' : 'A link that opens this product at this price on your website.'));
  }

  function StatsLine({ st }) {
    if (!st || !st.orders) return h('span', null, 'No orders yet');
    const parts = [`${st.completed} of ${st.orders} order${st.orders === 1 ? '' : 's'} delivered`];
    if (st.medianConfirmMs != null) parts.push('confirms in ~' + left(st.medianConfirmMs));
    if (st.cancelled) parts.push(`${st.cancelled} cancelled`); if (st.expired) parts.push(`${st.expired} unconfirmed`);
    return h('span', null, parts.join(' · '));
  }

  // Seller payment details form (onboarding + shop settings)
  function PaymentForm({ value, onChange, errors, idp }) {
    const set = (k, fn) => (e) => onChange(Object.assign({}, value, { [k]: fn ? fn(e.target.value) : e.target.value }));
    const f = (k, label, extra, hint, fn) => h(Field, { label, id: idp + k, error: errors && errors[k], hint }, h(Input, Object.assign({ id: idp + k, value: value[k] || '', invalid: !!(errors && errors[k]), onChange: set(k, fn) }, extra || {})));
    const [qrMsg, setQrMsg] = useState(null);
    async function onQr(file) {
      if (!file) return; if (!file.type.startsWith('image/') || file.size > 5e6) { setQrMsg({ err: true, t: 'Choose an image under 5 MB.' }); return; }
      const r = await U.Media.put(file); onChange(Object.assign({}, value, { upiQrMediaId: r.id }));
      if (!('BarcodeDetector' in window)) { setQrMsg({ t: 'Saved. This browser can’t read QR codes, so we couldn’t check it matches your UPI ID.' }); return; }
      try {
        const det = new window.BarcodeDetector({ formats: ['qr_code'] }); const bmp = await createImageBitmap(file); const codes = await det.detect(bmp);
        const raw = codes[0] && codes[0].rawValue; const pa = raw && /^upi:\/\/pay/i.test(raw) ? new URLSearchParams(raw.split('?')[1] || '').get('pa') : null;
        if (!pa) setQrMsg({ err: true, t: 'That image doesn’t contain a UPI payment QR code.' });
        else if (value.upiId && pa.toLowerCase() !== value.upiId.toLowerCase()) setQrMsg({ err: true, t: `This QR pays ${pa}, not ${value.upiId}. Check before saving.` });
        else { setQrMsg({ t: `QR checked: pays ${pa}.` }); if (!value.upiId) onChange(Object.assign({}, value, { upiQrMediaId: r.id, upiId: pa })); }
      } catch (e) { setQrMsg({ t: 'Saved. We couldn’t read the QR in this browser.' }); }
    }
    return h('div', { className: 'stack', style: { gap: 14 } },
      h('div', { className: 'card info small' }, 'Buyers pay you directly. Fayda doesn’t collect, hold or refund money. Your details are shown only to a buyer who has placed an order with you.'),
      h('div', { className: 'rule' }, h('div', { className: 'strong' }, 'UPI'), f('upiId', 'UPI ID', { placeholder: 'yourname@okbank', autoCapitalize: 'none' }, null, (x) => x.trim()),
        h('div', { className: 'row', style: { alignItems: 'flex-start' } }, value.upiQrMediaId ? h('div', { className: 'thumb lg' }, h(U.MediaView, { m: { kind: 'image', mediaId: value.upiQrMediaId } })) : null,
          h('div', { className: 'grow stack', style: { gap: 6 } }, h('label', { className: 'btn outline sm', style: { alignSelf: 'flex-start' } }, h(Icon, { name: 'upload', size: 16 }), value.upiQrMediaId ? 'Replace QR code' : 'Upload UPI QR code', h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: (e) => { onQr(e.target.files[0]); e.target.value = ''; } })),
            value.upiQrMediaId && h('button', { className: 'btn ghost sm', style: { padding: 0, alignSelf: 'flex-start' }, onClick: () => { onChange(Object.assign({}, value, { upiQrMediaId: null })); setQrMsg(null); } }, 'Remove QR'),
            qrMsg && h('div', { className: qrMsg.err ? 'error' : 'hint' }, qrMsg.t)))),
      h('div', { className: 'rule' }, h('div', { className: 'strong' }, 'Bank transfer'), f('bankHolder', 'Account holder name'), f('bankAccount', 'Account number', { inputMode: 'numeric' }, null, (x) => x.replace(/\D/g, '').slice(0, 18)), h('div', { className: 'grid2' }, f('bankIfsc', 'IFSC', { autoCapitalize: 'characters' }, null, (x) => x.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11)), f('bankName', 'Bank (optional)'))),
      h('div', { className: 'rule' }, h('div', { className: 'strong' }, 'Payment link'), f('paymentLink', 'Link', { placeholder: 'https://…', inputMode: 'url' }, 'A payment page from your bank or payment app.', (x) => x.trim())),
      h('div', { className: 'rule' }, h('div', { className: 'strong' }, 'Your website (optional)'), f('website', 'Shop website', { placeholder: 'https://yourshop.com', inputMode: 'url' }, 'For products buyers should buy on your site. You’ll add the product link per listing.', (x) => x.trim())),
      errors && errors.payment && h('div', { className: 'error' }, errors.payment));
  }

  Object.assign(U, { AuthFlow, AddressForm, EMPTY_ADDR, addrLine, CommentsPanel, Notifications, Timeline, CounterBox, OrderSteps, ORDER_TONE, MODE_LABEL, ShipmentCard, ShipmentFields, DealAccessInput, StatsLine, PaymentForm });
})();
