/* Fayda prototype — store, media, shared UI primitives. */
(function () {
  'use strict';
  const { useState, useEffect, useRef, useId, createContext, useContext } = React;
  const h = React.createElement;
  const E = window.FaydaEngine, Seed = window.FaydaSeed;
  const BRAND = 'Fayda'; // working name (T17): change here when the brand is decided
  const KEY = 'fayda-proto-state-v1';

  // ---------- Store: single source of truth shared by both apps (and other tabs of this artifact) ----------
  const Store = (() => {
    let storageOk = true; let state;
    function load() {
      try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 3 && s.listings && s.paymentProfiles && s.dealCodes && s.chats && s.requests) return s; } } catch (e) { storageOk = false; }
      return Seed.createSeedState(Date.now());
    }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); storageOk = true; } catch (e) { storageOk = false; } }
    state = load(); save();
    const subs = new Set();
    const now = () => Date.now() + (state.clockOffsetMs || 0);
    const emit = () => subs.forEach((f) => f());
    function dispatch(cmd) { const r = E.exec(state, cmd, now()); if (r.result.ok) { state = r.state; save(); emit(); } return r.result; }
    function tick() { const s2 = E.runSweep(state, now()); if (s2) { state = s2; save(); } emit(); }
    function reset() { state = Seed.createSeedState(Date.now()); save(); emit(); }
    try { window.addEventListener('storage', (e) => { if (e.key === KEY && e.newValue) { try { const x = JSON.parse(e.newValue); if (x && x.v === 3) { state = x; emit(); } } catch (x) { /* ignore */ } } }); } catch (e) { /* ignore */ }
    setInterval(tick, 1000);
    return { get state() { return state; }, now, dispatch, reset, subscribe(f) { subs.add(f); return () => subs.delete(f); }, get storageOk() { return storageOk; } };
  })();

  // ---------- Media: uploaded files kept in this browser's IndexedDB (SIMULATED media service) ----------
  const Media = (() => {
    let dbp = null; const urls = new Map();
    function open() {
      if (!dbp) dbp = new Promise((res, rej) => { try { const r = indexedDB.open('fayda-proto-media', 1); r.onupgradeneeded = () => r.result.createObjectStore('blobs'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); } catch (e) { rej(e); } });
      return dbp;
    }
    async function put(blob) {
      const id = 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      let persisted = true;
      try { const db = await open(); await new Promise((res, rej) => { const tx = db.transaction('blobs', 'readwrite'); tx.objectStore('blobs').put(blob, id); tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); }); } catch (e) { persisted = false; }
      urls.set(id, URL.createObjectURL(blob));
      return { id, persisted };
    }
    async function url(id) {
      if (urls.has(id)) return urls.get(id);
      try {
        const db = await open();
        const blob = await new Promise((res, rej) => { const q = db.transaction('blobs').objectStore('blobs').get(id); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
        if (!blob) return null; const u = URL.createObjectURL(blob); urls.set(id, u); return u;
      } catch (e) { return null; }
    }
    async function clear() { try { const db = await open(); await new Promise((res) => { const tx = db.transaction('blobs', 'readwrite'); tx.objectStore('blobs').clear(); tx.oncomplete = res; tx.onerror = res; }); } catch (e) { /* ignore */ } }
    return { put, url, clear, cached: (id) => urls.get(id) };
  })();

  // ---------- formatting ----------
  const money = E.fmt;
  function left(ms) {
    if (ms <= 0) return 'now';
    const m = Math.floor(ms / 60e3), hh = Math.floor(m / 60), d = Math.floor(hh / 24);
    if (d >= 1) return `${d} d ${hh % 24} h`;
    if (hh >= 1) return `${hh} h ${m % 60} m`;
    if (m >= 10) return `${m} m`;
    const s = Math.floor(ms / 1000) % 60; return `${m} m ${String(s).padStart(2, '0')} s`;
  }
  function ago(ts, now) {
    const m = Math.floor((now - ts) / 60e3);
    if (m < 1) return 'just now'; if (m < 60) return `${m} m ago`;
    const hh = Math.floor(m / 60); if (hh < 24) return `${hh} h ago`;
    const d = Math.floor(hh / 24); return d === 1 ? 'yesterday' : `${d} d ago`;
  }
  const when = (ts) => new Date(ts).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const pctOff = (price, amount) => Math.round((1 - amount / price) * 100);
  async function copyText(text, toast, label) {
    try { await navigator.clipboard.writeText(text); if (toast) toast((label || 'Copied') + ' to clipboard'); return true; }
    catch (e) { try { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); if (toast) toast(ok ? (label || 'Copied') + ' to clipboard' : 'Copy isn’t available here — select and copy it manually.', !ok); return ok; } catch (x) { if (toast) toast('Copy isn’t available here — select and copy it manually.', true); return false; } }
  }
  const upiLink = (pa, pn, paise, note) => 'upi://pay?' + ['pa=' + encodeURIComponent(pa), 'pn=' + encodeURIComponent(pn || ''), 'am=' + (paise / 100).toFixed(2), 'cu=INR', 'tn=' + encodeURIComponent(note || '')].join('&');
  const sizeText = (l) => (/size/i.test(String(l)) ? String(l) : 'Size ' + l);
  const initial = (s) => (String(s || '?').trim()[0] || '?').toUpperCase();

  // ---------- icons (Lucide-style line icons) ----------
  const ICONS = {
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>',
    send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/>',
    user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    store: '<path d="M3 9 4.5 4h15L21 9"/><path d="M3 9h18v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0z"/><path d="M5 13v7h14v-7"/>',
    cart: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
    chart: '<path d="M3 3v18h18"/><path d="M7 16v-5M12 16V8M17 16v-9"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    volume: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/>',
    mute: '<path d="M11 5 6 9H2v6h4l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    play: '<path d="m6 3 14 9-14 9z"/>',
    pause: '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    video: '<path d="m16 13 5.2 3.1a.5.5 0 0 0 .8-.4V8.3a.5.5 0 0 0-.8-.4L16 11"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14 21 3"/>',
    clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
    repeat: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.7 9a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.7a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/>'
  };
  function Icon({ name, size = 22, fill = 'none', sw = 2, style }) {
    return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill, stroke: 'currentColor', strokeWidth: sw, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, style, dangerouslySetInnerHTML: { __html: ICONS[name] || '' } });
  }

  // ---------- seed visuals (clearly labelled sample artwork, not product photos) ----------
  const PALETTES = {
    indigo: { bg1: '#EFE5D2', bg2: '#D6C4A2', g: '#27357A', p: '#E9E4D8' }, clay: { bg1: '#F6E1CF', bg2: '#E4B48E', g: '#B5552B', p: '#F7E6D6' },
    rose: { bg1: '#F8E2E7', bg2: '#E6AFBD', g: '#B83B5E', p: '#F6D59A' }, sage: { bg1: '#E8EDE0', bg2: '#C4D0B2', g: '#5F7150', p: '#EEF1E6' },
    sand: { bg1: '#F2EADD', bg2: '#D8C7AB', g: '#FBF8F1', p: '#C2AE8E' }, teal: { bg1: '#DCEFEC', bg2: '#9FCFCA', g: '#0F6E6E', p: '#F2C14E' },
    plum: { bg1: '#ECE3F4', bg2: '#C6B1DE', g: '#A7ADB4', p: '#5B4B7A' }, maroon: { bg1: '#F4DEDA', bg2: '#D9A69F', g: '#7A1F2B', p: '#E6B85C' },
    tan: { bg1: '#F3E6D4', bg2: '#DCC09A', g: '#9A5B2E', p: '#E8C79A' }
  };
  const PALETTE_NAMES = Object.keys(PALETTES);
  const GARMENTS = {
    kurta: { body: ['M85 18 Q100 34 115 18 L140 28 L172 92 L150 102 L136 72 L146 226 L54 226 L64 72 L50 102 L28 92 L60 28 Z'], lines: ['M100 30 L100 82'], bands: ['M54 212 L146 212 L146 226 L54 226 Z'] },
    shirt: { body: ['M80 20 L100 36 L120 20 L144 30 L172 88 L152 98 L140 72 L142 204 L58 204 L60 72 L48 98 L28 88 L56 30 Z'], lines: ['M80 20 L92 46 L100 36 L108 46 L120 20', 'M100 46 L100 200'], dots: [[100, 70, 3], [100, 100, 3], [100, 130, 3], [100, 160, 3]] },
    coord: { body: ['M82 14 Q100 28 118 14 L142 24 L164 70 L146 78 L136 58 L138 106 L62 106 L64 58 L54 78 L36 70 L58 24 Z', 'M64 114 L136 114 L148 232 L110 232 L100 150 L90 232 L52 232 Z'], lines: ['M100 120 L100 150'] },
    saree: { body: ['M70 18 Q100 8 130 20 L150 70 Q160 130 152 232 L48 232 Q40 140 58 70 Z'], bands: ['M70 18 L152 118 L152 150 L60 38 Z', 'M48 216 L152 216 L152 232 L48 232 Z'] },
    dupatta: { body: ['M40 28 Q100 8 160 28 Q150 120 168 222 Q100 202 32 224 Q50 120 40 28 Z'], bands: ['M40 28 Q100 8 160 28 L159 40 Q100 20 41 40 Z', 'M34 210 Q100 190 166 208 L168 222 Q100 202 32 224 Z'] },
    jhumka: { body: ['M40 120 Q65 76 90 120 Z', 'M110 120 Q135 76 160 120 Z'], lines: ['M65 40 Q52 52 65 66 L65 80', 'M135 40 Q122 52 135 66 L135 80'], dots: [[65, 84, 9], [135, 84, 9], [44, 128, 5], [56, 132, 5], [65, 134, 5], [74, 132, 5], [86, 128, 5], [114, 128, 5], [126, 132, 5], [135, 134, 5], [144, 132, 5], [156, 128, 5]] },
    potli: { body: ['M60 92 Q100 72 140 92 Q172 170 140 222 Q100 238 60 222 Q28 170 60 92 Z'], lines: ['M66 96 Q100 112 134 96', 'M84 86 Q66 44 92 30', 'M116 86 Q134 44 108 30'], dots: [[100, 160, 10], [78, 150, 4], [122, 150, 4], [100, 190, 4]] },
    sandal: { body: ['M60 26 Q86 18 92 58 L92 196 Q88 226 62 226 Q36 226 34 196 L34 58 Q36 22 60 26 Z', 'M140 26 Q166 18 172 58 L172 196 Q168 226 142 226 Q116 226 114 196 L114 58 Q116 22 140 26 Z'], bands: ['M34 86 Q63 66 92 86 L92 104 Q63 84 34 104 Z', 'M114 86 Q143 66 172 86 L172 104 Q143 84 114 104 Z'], dots: [[63, 50, 6], [143, 50, 6]] }
  };
  const SCENE_FOR_CATEGORY = { 'Ethnic wear': 'kurta', 'Western wear': 'coord', Menswear: 'shirt', Accessories: 'potli', Footwear: 'sandal' };
  function Scene({ scene, palette, small }) {
    const P = PALETTES[palette] || PALETTES.indigo; const G = GARMENTS[scene] || GARMENTS.kurta;
    const id = 'g' + useId().replace(/[^a-zA-Z0-9]/g, '');
    return h('div', { className: 'scene' + (small ? ' small' : ''), style: { background: `radial-gradient(120% 90% at 30% 18%, ${P.bg1}, ${P.bg2})` } },
      h('svg', { className: 'garment drift', viewBox: '0 0 200 240', role: 'img', 'aria-label': 'Sample artwork' },
        h('defs', null,
          h('pattern', { id: id + 'p', width: 18, height: 18, patternUnits: 'userSpaceOnUse' }, h('circle', { cx: 9, cy: 9, r: 2.4, fill: P.p }), h('circle', { cx: 0, cy: 0, r: 1.3, fill: P.p }), h('circle', { cx: 18, cy: 18, r: 1.3, fill: P.p })),
          h('clipPath', { id: id + 'c' }, G.body.map((d) => h('path', { key: d, d })))),
        G.body.map((d) => h('path', { key: d, d, fill: P.g })),
        h('rect', { x: 0, y: 0, width: 200, height: 240, fill: `url(#${id}p)`, clipPath: `url(#${id}c)`, opacity: 0.5 }),
        (G.bands || []).map((d) => h('path', { key: d, d, fill: P.p, opacity: 0.9 })),
        (G.lines || []).map((d) => h('path', { key: d, d, fill: 'none', stroke: scene === 'jhumka' ? P.g : P.p, strokeWidth: 3, strokeLinecap: 'round', opacity: 0.85 })),
        (G.dots || []).map(([x, y, r], i) => h('circle', { key: i, cx: x, cy: y, r, fill: scene === 'jhumka' ? P.g : P.p }))));
  }

  function useMediaUrl(id) {
    const [u, setU] = useState(() => (id ? Media.cached(id) || null : null));
    const [missing, setMissing] = useState(false);
    useEffect(() => { let on = true; if (!id) return; Media.url(id).then((x) => { if (!on) return; if (x) setU(x); else setMissing(true); }); return () => { on = false; }; }, [id]);
    return { url: u, missing };
  }
  function MediaView({ m, active, muted = true, small, controls }) {
    if (!m) return h('div', { className: 'media-missing' }, 'No media');
    if (m.kind === 'seed') return h(Scene, { scene: m.scene, palette: m.palette, small });
    return h(StoredMedia, { m, active, muted, controls });
  }
  function StoredMedia({ m, active, muted, controls }) {
    const { url, missing } = useMediaUrl(m.mediaId); const ref = useRef(null);
    useEffect(() => { const v = ref.current; if (!v) return; if (active) { const p = v.play(); if (p && p.catch) p.catch(() => {}); } else v.pause(); }, [active, url]);
    useEffect(() => { if (ref.current) ref.current.muted = muted; }, [muted, url]);
    if (missing) return h('div', { className: 'media-missing' }, 'This media was uploaded in another browser. Prototype media stays on the device that uploaded it.');
    if (!url) return h('div', { className: 'media-missing' }, 'Loading…');
    if (m.kind === 'video') return h('video', { ref, className: 'media-fill', src: url, muted: true, loop: true, playsInline: true, preload: 'metadata', controls: !!controls });
    return h('img', { className: 'media-fill', src: url, alt: '' });
  }

  // ---------- small components ----------
  const AppCtx = createContext(null);
  const useApp = () => useContext(AppCtx);

  function Btn({ kind = 'primary', size, block, onClick, disabled, children, label, type }) {
    return h('button', { type: type || 'button', className: ['btn', kind, size, block ? 'block' : ''].join(' '), onClick, disabled, 'aria-label': label }, children);
  }
  function Field({ label, hint, error, children, id }) {
    return h('div', { className: 'field' }, label && h('label', { htmlFor: id }, label), children, error ? h('div', { className: 'error', role: 'alert' }, error) : hint ? h('div', { className: 'hint' }, hint) : null);
  }
  function Input(props) {
    const { invalid, ...rest } = props;
    return h(props.multiline ? 'textarea' : 'input', Object.assign({ className: 'input', 'aria-invalid': invalid ? 'true' : 'false' }, rest, { multiline: undefined }));
  }
  function Chip({ on, onClick, children, disabled, accent }) {
    return h('button', { type: 'button', className: 'chip' + (accent ? ' accent' : ''), 'aria-pressed': on ? 'true' : 'false', onClick, disabled }, children);
  }
  function Seg({ options, value, onChange, label }) {
    return h('div', { className: 'seg', role: 'group', 'aria-label': label }, options.map((o) => h('button', { key: o.value, type: 'button', 'aria-pressed': value === o.value ? 'true' : 'false', onClick: () => onChange(o.value) }, o.label)));
  }
  function Badge({ tone, children }) { return h('span', { className: 'badge ' + (tone || '') }, children); }
  function Empty({ icon = 'box', title, body, action }) {
    return h('div', { className: 'empty' }, h('div', { className: 'ic' }, h(Icon, { name: icon, size: 26 })), h('div', { className: 'h3' }, title), body && h('div', { className: 'muted small', style: { maxWidth: 260 } }, body), action && h('div', { style: { marginTop: 8 } }, action));
  }
  function AppBar({ title, onBack, right }) {
    return h('div', { className: 'appbar' }, onBack && h('button', { className: 'iconbtn', onClick: onBack, 'aria-label': 'Back' }, h(Icon, { name: 'back' })), h('h1', null, title), right);
  }
  function Page({ title, onBack, right, children, footer, bodyStyle }) {
    return h('div', { className: 'page' }, h(AppBar, { title, onBack, right }), h('div', { className: 'screen', style: bodyStyle }, children), footer && h('div', { className: 'actionbar' }, footer));
  }
  function Sheet({ title, onClose, children, footer }) {
    useEffect(() => { const k = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k); }, [onClose]);
    return h('div', { className: 'scrim', onClick: (e) => { if (e.target === e.currentTarget) onClose(); } },
      h('div', { className: 'sheet', role: 'dialog', 'aria-label': title },
        h('div', { className: 'grabber' }), h('div', { className: 'sheet-head' }, h('h2', null, title), h('button', { className: 'iconbtn plain', onClick: onClose, 'aria-label': 'Close' }, h(Icon, { name: 'x' }))),
        h('div', { className: 'sheet-body' }, children), footer && h('div', { className: 'actionbar' }, footer)));
  }
  function Confirm({ title, body, confirmLabel, cancelLabel = 'Cancel', danger, onConfirm, onCancel }) {
    return h('div', { className: 'dialog', role: 'dialog', 'aria-label': title }, h('div', null,
      h('div', { className: 'h3', style: { fontSize: 18 } }, title), body && h('div', { className: 'muted' }, body),
      h('div', { className: 'btn-row' }, h(Btn, { kind: 'outline', onClick: onCancel }, cancelLabel), h(Btn, { kind: danger ? 'danger' : 'primary', onClick: onConfirm }, confirmLabel))));
  }
  function Thumb({ m, lg }) { return h('div', { className: 'thumb' + (lg ? ' lg' : '') }, h(MediaView, { m, small: true })); }
  function Avatar({ name, lg }) { return h('div', { className: 'avatar' + (lg ? ' lg' : '') }, initial(name)); }
  function Kv({ k, v, strong, tone }) { return h('div', { className: 'kv' }, h('span', { className: strong ? 'strong' : 'muted' }, k), h('span', { className: strong ? 'strong' : '', style: tone ? { color: `var(--${tone})`, fontWeight: 700 } : null }, v)); }

  function useToast() {
    const [t, setT] = useState(null); const timer = useRef(null);
    const show = (text, isErr) => { clearTimeout(timer.current); setT({ text, isErr }); timer.current = setTimeout(() => setT(null), 3200); };
    const node = t ? h('div', { className: 'toast' + (t.isErr ? ' err' : ''), role: 'status' }, t.text) : null;
    return [show, node];
  }
  function useNav(firstTab) {
    const [nav, setNav] = useState({ tab: firstTab, stack: [] });
    const key = () => Math.random().toString(36).slice(2);
    return {
      tab: nav.tab, stack: nav.stack, top: nav.stack[nav.stack.length - 1] || null,
      go: (screen, params) => setNav((n) => ({ ...n, stack: n.stack.concat([{ screen, params: params || {}, key: key() }]) })),
      replace: (screen, params) => setNav((n) => ({ ...n, stack: n.stack.slice(0, -1).concat([{ screen, params: params || {}, key: key() }]) })),
      back: () => setNav((n) => ({ ...n, stack: n.stack.slice(0, -1) })),
      setTab: (tab) => setNav({ tab, stack: [] })
    };
  }

  // Amount input with ₹ / % modes (kept from the Haggle prototype)
  function AmountInput({ listPrice, value, onChange, mode, onMode, id, invalid, autoFocus, onEnter }) {
    const rupees = mode === 'pct' ? (value === '' ? null : Math.round((listPrice / 100) * (1 - Number(value) / 100))) : (value === '' ? null : Number(value));
    return h('div', { className: 'stack', style: { gap: 8 } },
      h(Seg, { label: 'Offer type', value: mode, onChange: onMode, options: [{ value: 'inr', label: 'My price (₹)' }, { value: 'pct', label: 'Discount (%)' }] }),
      h('div', { className: 'input-group' }, h('div', { className: 'prefix' }, mode === 'pct' ? '%' : '₹'),
        h(Input, { id, inputMode: 'numeric', placeholder: mode === 'pct' ? 'e.g. 12' : 'e.g. ' + Math.round(listPrice / 100 * 0.88), value, invalid, autoFocus, onChange: (e) => onChange(e.target.value.replace(/[^0-9]/g, '').slice(0, 8)), onKeyDown: (e) => { if (e.key === 'Enter' && onEnter) onEnter(); } })),
      mode === 'pct' && rupees != null && !isNaN(rupees) && h('div', { className: 'hint' }, `${value}% off = ${money(rupees * 100)}`));
  }
  const amountFrom = (mode, value, listPrice) => { if (value === '') return null; const n = Number(value); if (!Number.isFinite(n)) return null; return mode === 'pct' ? Math.round((listPrice / 100) * (1 - n / 100)) : n; };

  window.FaydaUI = { h, E, Seed, BRAND, Store, Media, money, left, ago, when, pctOff, initial, sizeText, copyText, upiLink, Icon, Scene, MediaView, PALETTE_NAMES, SCENE_FOR_CATEGORY, AppCtx, useApp, Btn, Field, Input, Chip, Seg, Badge, Empty, AppBar, Page, Sheet, Confirm, Thumb, Avatar, Kv, useToast, useNav, AmountInput, amountFrom };
})();
