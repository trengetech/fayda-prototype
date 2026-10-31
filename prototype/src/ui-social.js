/* Reviews, chat, contact, requests and agreement components shared by both apps. */
(function () {
  'use strict';
  const U = window.FaydaUI; const { h, E, Store, Media, money, left, ago, when, Icon, Btn, Field, Input, Chip, Badge, Empty, Page, Sheet, Thumb, Avatar, Kv, MediaView, BRAND } = U;
  const { useState, useEffect, useRef } = React;

  // ---------- stars ----------
  function Stars({ value, size = 14 }) {
    const full = Math.round(value || 0);
    return h('span', { className: 'stars', 'aria-label': `${value} out of 5 stars` }, [1, 2, 3, 4, 5].map((i) => h(Icon, { key: i, name: 'star', size, sw: 1.5, fill: i <= full ? 'currentColor' : 'none' })));
  }
  function RatingChip({ stats, light }) {
    if (!stats || !stats.reviewCount) return h('span', { className: 'rating-chip', style: { opacity: 0.8, color: light ? '#fff' : 'var(--muted)' } }, 'No reviews yet');
    return h('span', { className: 'rating-chip', style: light ? { color: '#fff' } : null }, h(Icon, { name: 'star', size: 13, sw: 1.5, fill: '#F59E0B', style: { color: '#F59E0B' } }), stats.rating.toFixed(1), h('span', { style: { fontWeight: 600, opacity: 0.8 } }, `(${stats.reviewCount})`));
  }
  function StarInput({ value, onChange }) {
    return h('div', { className: 'stars input', role: 'radiogroup', 'aria-label': 'Rating' }, [1, 2, 3, 4, 5].map((i) => h('button', { key: i, type: 'button', role: 'radio', 'aria-checked': value === i, 'aria-label': `${i} star${i === 1 ? '' : 's'}`, onClick: () => onChange(i) }, h(Icon, { name: 'star', size: 34, sw: 1.5, fill: i <= value ? 'currentColor' : 'none' }))));
  }
  const confirmText = (hrs) => (hrs === 1 ? 'within 1 hour' : hrs < 24 ? `within ${hrs} hours` : hrs === 24 ? 'within a day' : `within ${hrs / 24} days`);
  const shipText = (d) => `within ${d} day${d === 1 ? '' : 's'}`;
  function SlaLines({ sla, stats }) {
    if (!sla) return null;
    return h('div', { className: 'small', style: { display: 'flex', flexDirection: 'column', gap: 2 } },
      h('div', null, h('b', null, 'Confirms payment: '), 'usually ' + confirmText(sla.confirmHours), stats && stats.medianConfirmMs != null ? h('span', { className: 'muted' }, ` · typically ${left(stats.medianConfirmMs)} on ${BRAND}`) : null),
      h('div', null, h('b', null, 'Ships: '), 'usually ' + shipText(sla.shipDays)));
  }

  // ---------- media ----------
  function MediaViewer({ m, onClose }) {
    return h('div', { className: 'viewer', onClick: (e) => e.target === e.currentTarget && onClose() }, h('button', { className: 'glass round close', onClick: onClose, 'aria-label': 'Close' }, h(Icon, { name: 'x', size: 18 })), h('div', { className: 'box' }, h(MediaView, { m, active: true, controls: m.kind === 'video' })));
  }
  function MediaRow({ media, onOpen }) {
    if (!media || !media.length) return null;
    return h('div', { className: 'media-row' }, media.map((m, i) => h('button', { key: i, className: 'cell', onClick: () => onOpen && onOpen(m), 'aria-label': m.kind === 'video' ? 'Play video' : 'View photo' }, h(MediaView, { m, small: true }), m.kind === 'video' && h('span', { style: { position: 'absolute', left: 4, bottom: 4, zIndex: 3 } }, h(Badge, { tone: 'dark' }, 'Video')))));
  }
  function MediaPicker({ value, onChange, max = 4, videos = true, label, error, sample }) {
    const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(null);
    async function add(files) {
      setMsg(null); const out = value.slice(); const notes = [];
      for (const f of Array.from(files)) {
        if (out.length >= max) { notes.push(`Up to ${max}.`); break; }
        const isV = f.type.startsWith('video/'), isI = f.type.startsWith('image/');
        if (!isI && !(videos && isV)) { notes.push(`${f.name}: choose ${videos ? 'a photo or video' : 'a photo'}.`); continue; }
        if (isI && f.size > 15e6) { notes.push(`${f.name}: photos up to 15 MB.`); continue; }
        if (isV && f.size > 80e6) { notes.push(`${f.name}: videos up to 80 MB.`); continue; }
        setBusy(true); const r = await Media.put(f); setBusy(false);
        out.push({ kind: isV ? 'video' : 'image', mediaId: r.id });
      }
      onChange(out); if (notes.length) setMsg(notes.join(' '));
    }
    return h('div', { className: 'stack', style: { gap: 6 } }, label && h('div', { className: 'label' }, label),
      h('div', { className: 'media-row' }, value.map((m, i) => h('div', { key: i, className: 'cell' }, h(MediaView, { m, small: true }), h('button', { className: 'x', 'aria-label': 'Remove', onClick: () => onChange(value.filter((_, j) => j !== i)) }, h(Icon, { name: 'x', size: 12 })))),
        value.length < max && h('label', { className: 'add' }, h(Icon, { name: 'upload', size: 18 }), busy ? 'Adding…' : videos ? 'Photo or video' : 'Add photo', h('input', { type: 'file', accept: videos ? 'image/*,video/*' : 'image/*', multiple: true, style: { display: 'none' }, onChange: (e) => { add(e.target.files); e.target.value = ''; } }))),
      sample && value.length < max && h('button', { className: 'btn ghost sm', style: { padding: 0, alignSelf: 'flex-start' }, onClick: () => onChange(value.concat([sample()])) }, 'No photo handy? Use sample artwork'),
      msg && h('div', { className: 'hint' }, msg), error && h('div', { className: 'error' }, error));
  }

  // ---------- reviews ----------
  function ReviewCard({ r, now, onOpenMedia }) {
    return h('div', { className: 'card stack', style: { gap: 6 } },
      h('div', { className: 'row between' }, h('div', { className: 'row', style: { gap: 8 } }, h(Avatar, { name: r.buyerName }), h('div', null, h('div', { className: 'strong small' }, r.buyerName), h('div', { className: 'tiny muted' }, ago(r.at, now) + (r.editedAt ? ' · edited' : '')))), h(Stars, { value: r.rating })),
      h('div', { className: 'tiny muted' }, 'Verified order · ' + r.title), r.text && h('div', null, r.text), h(MediaRow, { media: r.media, onOpen: onOpenMedia }));
  }
  function ReviewsList({ reviews, stats, now }) {
    const [view, setView] = useState(null);
    return h('div', { className: 'stack' },
      h('div', { className: 'row', style: { gap: 10 } }, h('div', { style: { fontSize: 34, fontWeight: 800, letterSpacing: -1 } }, stats && stats.reviewCount ? stats.rating.toFixed(1) : '—'), h('div', null, h(Stars, { value: stats ? stats.rating : 0, size: 16 }), h('div', { className: 'tiny muted' }, `${stats ? stats.reviewCount : 0} review${stats && stats.reviewCount === 1 ? '' : 's'} from buyers with orders`))),
      reviews.length ? reviews.map((r) => h(ReviewCard, { key: r.id, r, now, onOpenMedia: setView })) : h('div', { className: 'small muted' }, 'No reviews yet.'),
      view && h(MediaViewer, { m: view, onClose: () => setView(null) }));
  }
  function ReviewForm({ order, onDone, toast }) {
    const prev = order.review;
    const [rating, setRating] = useState(prev ? prev.rating : 0); const [text, setText] = useState(prev ? prev.text : ''); const [media, setMedia] = useState(prev ? prev.media : []); const [errors, setErrors] = useState({});
    const save = () => { const r = Store.dispatch({ type: 'review.save', userId: order.buyerId, orderId: order.id, rating, text, media }); if (!r.ok) { setErrors(r.fields || {}); return; } toast(prev ? 'Review updated' : 'Thanks — your review is live on the seller’s profile'); onDone(); };
    return h('div', { className: 'stack' },
      h(StarInput, { value: rating, onChange: (v) => { setRating(v); setErrors({}); } }), errors.rating && h('div', { className: 'error' }, errors.rating),
      h(Field, { label: 'Your feedback', id: 'rv-text', error: errors.text, hint: 'Fit, quality, packaging, how the seller handled payment and delivery.' }, h(Input, { id: 'rv-text', multiline: true, maxLength: 1000, value: text, onChange: (e) => { setText(e.target.value); setErrors({}); } })),
      h(MediaPicker, { value: media, onChange: setMedia, max: 4, label: 'Photos or videos (optional)', error: errors.media }),
      h('div', { className: 'card small', style: { background: 'var(--surface-3)' } }, h('b', null, 'Please be honest. '), `If feedback is found to be misleading, ${BRAND} may ban the account from the platform.`),
      h(Btn, { block: true, onClick: save, disabled: !rating }, prev ? 'Update review' : 'Post review'));
  }

  // ---------- contact & links ----------
  const waLink = (num, text) => `https://wa.me/91${num}?text=${encodeURIComponent(text || '')}`;
  function ContactButtons({ contact, chatLabel, onChat, unread, note }) {
    return h('div', { className: 'stack', style: { gap: 8 } },
      h(Btn, { kind: 'dark', block: true, onClick: onChat }, h(Icon, { name: 'msg', size: 18 }), chatLabel || 'Chat in app', unread ? h('span', { className: 'badge accent' }, unread + ' new') : null),
      contact && (contact.whatsapp || contact.phone) && h('div', { className: contact.whatsapp && contact.phone ? 'btn-row' : '' },
        contact.whatsapp && h('a', { className: 'btn outline block', style: { textDecoration: 'none' }, href: waLink(contact.whatsapp, note), target: '_blank', rel: 'noopener noreferrer' }, h(Icon, { name: 'chat', size: 18 }), 'WhatsApp'),
        contact.phone && h('a', { className: 'btn outline block', style: { textDecoration: 'none' }, href: 'tel:+91' + contact.phone }, h(Icon, { name: 'phone', size: 18 }), 'Call')));
  }
  function SellerLinks({ seller }) {
    const links = [[seller.mapsUrl, 'Shop location', 'pin'], [seller.googleProfileUrl, 'Google profile', 'external'], [seller.socialUrl, /instagram/i.test(seller.socialUrl || '') ? 'Instagram' : 'Facebook', 'external']].filter((x) => x[0]);
    if (!links.length) return null;
    return h('div', { className: 'link-row' }, links.map(([u, t, ic]) => h('a', { key: t, className: 'btn outline sm', href: u, target: '_blank', rel: 'noopener noreferrer' }, h(Icon, { name: ic, size: 16 }), t)));
  }

  // ---------- user agreement ----------
  const AGREEMENT = [
    `${BRAND} helps you discover sellers and agree prices. Payment and delivery happen directly between you and the seller.`,
    `Any dispute about payment, delivery, quality, returns or refunds must be resolved directly with the seller. ${BRAND} does not mediate or resolve disputes and is not responsible for their outcome.`,
    'Before you buy, check the seller’s reviews, star rating and order record to decide which seller to shop from.',
    'Pay only using the details shown on your order, and only to the seller you are buying from.',
    `Please be honest in your feedback for sellers. If feedback is found to be misleading, ${BRAND} holds the right to ban any user from the platform.`
  ];
  function AgreementText() { return h('div', { className: 'agreement stack', style: { gap: 8 } }, h(Badge, { tone: 'accent' }, 'Draft — pending legal review'), h('ol', { className: 'small' }, AGREEMENT.map((t, i) => h('li', { key: i }, t)))); }

  // ---------- chat ----------
  function ChatScreen({ app, userId, threadId, onBack, onOpenListing, onShareListing, header, toast }) {
    const now = Store.now(); const t = E.common.thread(Store.state, userId, app, threadId, now);
    const [text, setText] = useState(''); const [view, setView] = useState(null); const endRef = useRef(null);
    const count = t ? t.messages.length : 0;
    useEffect(() => { if (t && t.unread) Store.dispatch({ type: 'chat.markRead', userId, threadId }); }, [count]);
    useEffect(() => { if (endRef.current && endRef.current.scrollIntoView) endRef.current.scrollIntoView({ block: 'end' }); }, [count]);
    if (!t) return h(Page, { title: 'Chat', onBack }, h(Empty, { title: 'Chat not found' }));
    const send = (payload) => { const r = Store.dispatch(Object.assign({ type: 'chat.send', userId, threadId }, payload)); if (!r.ok) toast(r.message, true); return r.ok; };
    const attach = async (f) => { if (!f) return; if (!f.type.startsWith('image/') || f.size > 15e6) { toast('Choose a photo under 15 MB.', true); return; } const m = await Media.put(f); send({ media: { kind: 'image', mediaId: m.id } }); };
    return h('div', { className: 'page' }, h(U.AppBar, { title: t.counterpart, onBack }),
      h('div', { className: 'screen' },
        h('div', { className: 'pad', style: { paddingBottom: 0 } }, header || h('div', { className: 'small muted' }, t.title + (t.orderStatus ? ' · ' + t.orderStatus : ''))),
        h('div', { className: 'chat' }, t.messages.map((m) => {
          if (m.side === 'SYSTEM') return h('div', { key: m.id, className: 'sysmsg' }, m.text);
          if (m.type === 'LISTING') return m.listing ? h('button', { key: m.id, className: 'listing-card' + (m.side === 'ME' ? ' me' : ''), onClick: () => onOpenListing(m.listing.id) }, h(Thumb, { m: m.listing.media }), h('div', { className: 'grow', style: { textAlign: 'left' } }, h('div', { className: 'strong small ellipsis' }, m.listing.title), h('div', { className: 'small' }, h('b', null, money(m.listing.price)), m.listing.status !== 'ACTIVE' ? ' · not available' : !m.listing.available ? ' · sold out' : ''), h('div', { className: 'tiny', style: { color: 'var(--accent)', fontWeight: 800 } }, app === 'buyer' ? 'View and buy' : 'View listing'))) : null;
          if (m.type === 'MEDIA') return h('button', { key: m.id, className: 'media-msg' + (m.side === 'ME' ? ' me' : ''), style: { border: 0, padding: 0, alignSelf: m.side === 'ME' ? 'flex-end' : 'flex-start' }, onClick: () => setView(m.media) }, h(MediaView, { m: m.media, small: true }));
          return h('div', { key: m.id, className: 'bubble ' + (m.side === 'ME' ? 'me' : 'them') }, m.text, h('span', { className: 'meta' }, ago(m.at, now)));
        }), h('div', { ref: endRef }))),
      h('div', { className: 'composer' },
        h('label', { className: 'iconbtn plain', 'aria-label': 'Attach photo', style: { cursor: 'pointer' } }, h(Icon, { name: 'clip', size: 20 }), h('input', { type: 'file', accept: 'image/*', style: { display: 'none' }, onChange: (e) => { attach(e.target.files[0]); e.target.value = ''; } })),
        onShareListing && h('button', { className: 'iconbtn plain', 'aria-label': 'Share a listing', onClick: onShareListing }, h(Icon, { name: 'tag', size: 20 })),
        h(Input, { 'aria-label': 'Message', placeholder: 'Message…', value: text, maxLength: 1000, onChange: (e) => setText(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && text.trim() && send({ text })) setText(''); } }),
        h(Btn, { kind: 'primary', size: 'sm', disabled: !text.trim(), onClick: () => { if (send({ text })) setText(''); } }, 'Send')),
      view && h(MediaViewer, { m: view, onClose: () => setView(null) }));
  }
  function ThreadsScreen({ app, userId, onBack, onOpen }) {
    const now = Store.now(); const list = E.common.threads(Store.state, userId, app, now);
    return h(Page, { title: 'Messages', onBack }, list.length ? list.map((t) => h('button', { key: t.id, className: 'listrow', onClick: () => onOpen(t.id) }, h(Avatar, { name: t.counterpart }),
      h('div', { className: 'grow' }, h('div', { className: 'row between' }, h('span', { className: 'strong ellipsis' }, t.counterpart), h('span', { className: 'tiny muted' }, ago(t.updatedAt, now))), h('div', { className: 'tiny muted ellipsis' }, t.title), h('div', { className: 'small ellipsis', style: { fontWeight: t.unread ? 700 : 400 } }, t.last.type === 'LISTING' ? 'Shared a listing' : t.last.type === 'MEDIA' ? 'Photo' : t.last.text)),
      t.unread ? h('span', { className: 'badge accent' }, t.unread) : null))
      : h(Empty, { icon: 'msg', title: 'No messages yet', body: app === 'buyer' ? 'A chat with the seller opens when you place an order or say you want an item from a request.' : 'Chats open when a buyer places an order or wants an item you offered for their request.' }));
  }
  function MsgButton({ app, userId, onClick }) {
    const n = E.common.threads(Store.state, userId, app, Store.now()).reduce((t, x) => t + x.unread, 0);
    return h('button', { className: 'iconbtn', onClick, 'aria-label': `Messages${n ? `, ${n} unread` : ''}` }, h(Icon, { name: 'msg', size: 20 }), n ? h('span', { className: 'dot' }, n) : null);
  }

  Object.assign(U, { Stars, RatingChip, StarInput, SlaLines, confirmText, shipText, MediaViewer, MediaRow, MediaPicker, ReviewCard, ReviewsList, ReviewForm, ContactButtons, SellerLinks, AgreementText, ChatScreen, ThreadsScreen, MsgButton, waLink });
})();
