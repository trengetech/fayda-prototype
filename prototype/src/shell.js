/* Page shell: buyer and seller phones side by side, demo controls. */
(function () {
  'use strict';
  const U = window.FaydaUI; const { h, E, Store, Media, when, BRAND } = U;
  const { useState, useEffect } = React;

  const VIEWS = ['both', 'buyer', 'seller'];
  const readHash = () => { const x = (location.hash || '').replace('#', ''); return VIEWS.includes(x) ? x : null; };

  function useNarrow() {
    const q = () => window.matchMedia('(max-width: 899px)').matches;
    const [n, setN] = useState(q);
    useEffect(() => { const m = window.matchMedia('(max-width: 899px)'); const f = () => setN(m.matches); m.addEventListener ? m.addEventListener('change', f) : m.addListener(f); return () => (m.removeEventListener ? m.removeEventListener('change', f) : m.removeListener(f)); }, []);
    return n;
  }

  function Phone({ app }) {
    const App = app === 'buyer' ? window.FaydaBuyerApp : window.FaydaSellerApp;
    return h('div', { className: 'device' }, h('div', { className: 'device-label' }, app === 'buyer' ? 'Buyer app' : 'Seller app'),
      h('div', { className: 'phone', 'data-app': app },
        h('div', { className: 'envbar' }, h('span', null, 'Prototype · sign-in is simulated'), h('span', null, app === 'buyer' ? 'Buyer' : 'Seller')),
        h(App, null)));
  }

  function Guide({ onClose }) {
    const steps = [
      ['Seller app', 'Tap Indigo Threads under Demo accounts, send the code and enter 123456. Open Offers to see buyers waiting for a reply.'],
      ['Buyer app', 'Sign in as Aarav Sharma. Swipe the feed; like, save, follow a shop and post a comment — the seller sees it.'],
      ['Buyer app', 'On the hand-block printed kurta, tap Make offer and send ₹1,950. After a few seconds the seller counters ₹2,299 — set by the seller’s private rules.'],
      ['Buyer app', 'Counter ₹2,100. It’s still below the seller’s private minimum, so a few seconds later the seller counters ₹2,299 again.'],
      ['Buyer app', 'Counter ₹2,200 — at or above the private minimum, so it’s accepted straight away and one unit is reserved. Watch the stock line change in the seller app.'],
      ['Seller app', 'Answer an offer yourself: in Offers, open Priya’s public ₹4,200 offer on the Chanderi set and counter or accept it.'],
      ['Buyer app', 'Tap Continue, pick UPI or bank transfer and place the order. The seller’s payment details appear with the order number to use as the payment note.'],
      ['Seller app', 'Orders → New → Payment received. Optionally add the courier and tracking number, then Mark delivered. The buyer’s timeline updates each time.'],
      ['Website seller', 'In the buyer app open Offers: Aarav’s saree offer was auto-countered ₹6,199 by Loom & Co., who sell on their own website. Accept it to get the discount link and open the site. Then sign the seller app in as Loom & Co. and confirm the website order.'],
      ['Seller app', 'Tap New listing: add your own video or photos (or sample artwork), sizes, price, private bargaining rules, and choose Pay me directly or My website (with coupon codes). Publish — it appears in the buyer feed.'],
      ['Demo clock', 'Offer under ₹500 on the jhumkas: it’s declined automatically after 2 minutes (+1 h skips ahead). +12 h shows offers expiring, agreed prices lapsing, and unconfirmed orders expiring after 48 h.']
    ];
    return h('div', { className: 'guide', onClick: (e) => e.target === e.currentTarget && onClose() }, h('div', { role: 'dialog', 'aria-label': 'Demo guide' },
      h('div', { className: 'row between' }, h('div', { className: 'h2' }, 'Demo guide'), h('button', { className: 'iconbtn plain', onClick: onClose, 'aria-label': 'Close' }, h(U.Icon, { name: 'x' }))),
      h('p', { className: 'muted', style: { margin: '6px 0 0' } }, 'Both apps share one live store, so every action shows up on the other phone immediately. On a phone, switch apps with the Buyer / Seller buttons.'),
      h('ol', null, steps.map(([who, t], i) => h('li', { key: i }, h('b', null, who + ': '), t))),
      h('div', { className: 'h3', style: { marginTop: 14 } }, 'What’s real and what’s simulated'),
      h('ul', { className: 'small', style: { paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 } },
        h('li', null, h('b', null, 'Real rules: '), 'bargaining modes, private seller rules, turn-taking, converging counters, limits, expiry, stock reservations, coupon codes and discount links for website sellers, seller-confirmed orders with optional shipment details, order expiry and the public seller record — all enforced by the engine that will move to the backend.'),
        h('li', null, h('b', null, 'Outside ' + BRAND + ' by design: '), 'payments (buyers pay sellers by UPI, bank transfer or payment link), delivery and refunds. ' + BRAND + ' only records what the seller confirms.'),
        h('li', null, h('b', null, 'Simulated: '), 'sign-in codes (always 123456), seller verification, and the demo clock. Seller websites and payment links in the sample data are fictional and won’t load.'),
        h('li', null, h('b', null, 'Stored in this browser only: '), 'all data and uploaded media. Opening this page on another device starts from the seed data. Open #buyer and #seller in two tabs to use each app full-screen; they stay in sync.'),
        h('li', null, h('b', null, 'Provisional values: '), 'offer expiry, 6-offer limit, 3 offers per listing per day, 12-hour checkout window, 48-hour order confirmation window, 10% minimum offer and the 2-minute auto-decline delay are placeholders pending your approval.'))));
  }

  function App() {
    const [, force] = useState(0);
    useEffect(() => Store.subscribe(() => force((x) => x + 1)), []);
    const narrow = useNarrow();
    const [view, setView] = useState(readHash() || 'both');
    const [guide, setGuide] = useState(false); const [resetAsk, setResetAsk] = useState(false);
    useEffect(() => { const f = () => { const x = readHash(); if (x) setView(x); }; window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
    const choose = (v) => { setView(v); try { history.replaceState(null, '', '#' + v); } catch (e) { location.hash = v; } };
    const effective = narrow && view === 'both' ? 'buyer' : view;
    const skip = (hours) => Store.dispatch({ type: 'clock.advance', ms: hours * E.HOUR });
    const offset = Store.state.clockOffsetMs || 0;
    return h('div', { className: 'shell' },
      h('header', { className: 'topbar' },
        h('div', { className: 'brand' }, h('b', null, BRAND), h('span', { className: 'hide-narrow' }, 'Working prototype · buyer and seller apps')),
        h('div', { className: 'group', role: 'group', 'aria-label': 'Show' }, !narrow && h('button', { className: 'tbtn', 'aria-pressed': effective === 'both', onClick: () => choose('both') }, 'Both apps'), h('button', { className: 'tbtn', 'aria-pressed': effective === 'buyer', onClick: () => choose('buyer') }, 'Buyer'), h('button', { className: 'tbtn', 'aria-pressed': effective === 'seller', onClick: () => choose('seller') }, 'Seller')),
        h('div', { className: 'group' }, h('span', { className: 'clock hide-narrow', title: 'Simulated demo clock' }, (offset ? 'Demo time ' : '') + when(Store.now()) + (offset ? ` (+${Math.round(offset / E.HOUR)} h)` : '')), h('button', { className: 'tbtn', onClick: () => skip(1), title: 'Move the demo clock forward 1 hour' }, '+1 h'), h('button', { className: 'tbtn', onClick: () => skip(12), title: 'Move the demo clock forward 12 hours' }, '+12 h')),
        h('div', { className: 'group' }, h('button', { className: 'tbtn', onClick: () => setGuide(true) }, 'Guide'), h('button', { className: 'tbtn', onClick: () => setResetAsk(true) }, 'Reset'))),
      !Store.storageOk && h('div', { className: 'envbar', style: { justifyContent: 'center' } }, 'This browser is blocking storage, so changes will be lost when you reload.'),
      h('main', { className: 'stage' }, (effective === 'both' || effective === 'buyer') && h(Phone, { app: 'buyer' }), (effective === 'both' || effective === 'seller') && h(Phone, { app: 'seller' })),
      guide && h(Guide, { onClose: () => setGuide(false) }),
      resetAsk && h('div', { className: 'guide', onClick: (e) => e.target === e.currentTarget && setResetAsk(false) }, h('div', { role: 'dialog', 'aria-label': 'Reset demo', style: { maxWidth: 380 } },
        h('div', { className: 'h2' }, 'Reset the demo?'), h('p', { className: 'muted' }, 'This restores the seed data, signs both apps out, resets the demo clock and deletes media you uploaded in this browser.'),
        h('div', { className: 'btn-row' }, h(U.Btn, { kind: 'outline', onClick: () => setResetAsk(false) }, 'Cancel'), h(U.Btn, { kind: 'danger', onClick: () => { Media.clear(); Store.reset(); setResetAsk(false); } }, 'Reset demo')))));
  }

  class Boundary extends React.Component {
    constructor(p) { super(p); this.state = { error: null }; }
    static getDerivedStateFromError(error) { return { error }; }
    render() {
      if (!this.state.error) return this.props.children;
      return h('div', { className: 'guide' }, h('div', { role: 'alert', style: { maxWidth: 420 } },
        h('div', { className: 'h2' }, 'The prototype hit an error'),
        h('p', { className: 'muted' }, 'This usually means demo data saved by an older version. Resetting restores the sample data in this browser.'),
        h('pre', { className: 'tiny', style: { whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 10, borderRadius: 10 } }, String(this.state.error && this.state.error.message || this.state.error)),
        h(U.Btn, { kind: 'primary', block: true, onClick: () => { try { localStorage.removeItem('fayda-proto-state-v1'); } catch (e) { /* ignore */ } Media.clear().then(() => location.reload()); } }, 'Reset demo data')));
    }
  }
  ReactDOM.createRoot(document.getElementById('root')).render(h(Boundary, null, h(App)));
})();
