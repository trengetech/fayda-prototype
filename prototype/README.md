# Fayda prototype (reference implementation)

A single-page React prototype of both apps sharing one in-browser store. It is the **UX and business-rule reference** for the real apps. It is not production code.

## Run it

```bash
cd prototype
python3 -m http.server 8790
# open http://localhost:8790/dist/local.html   (works offline; uses vendor/ React 18.3.1)
# or     http://localhost:8790/fayda-prototype.html (loads React from jsDelivr)
```

- Sign in with any 10-digit number starting 6–9; the code is always `123456`. Demo accounts are listed on the sign-in screens.
- Tap **Guide** in the top bar for the 11-step demo.
- **+1 h** and **+12 h** move the demo clock forward.
- **Reset** restores the seed data.

## Files

| File | Contents |
|---|---|
| `src/engine.js` | **Business rules**: bargaining (R1–R17 + founder decisions), automation, orders, payment profiles, deal codes, sweeps, audience-scoped read models. Pure JS, runs in Node. |
| `src/seed.js` | Seed data (3 Hyderabad sellers, 9 listings, 2 buyers, live negotiations), built through engine commands. |
| `src/ui-core.js` | Store (localStorage), media (IndexedDB), formatting, icons, primitives. |
| `src/ui-shared.js` | Sign-in, address form, timeline, counter box, payment form, shipment fields, order steps. |
| `src/ui-social.js` | Stars, media picker/viewer, reviews, chat, contact buttons, seller links, user agreement. |
| `src/buyer-app.js` | Buyer app screens. |
| `src/seller-app.js` | Seller app screens. |
| `src/shell.js` | Two-phone page shell, guide, reset, error boundary. |
| `src/styles.css` | Design tokens (light/dark) and component styles → port to `packages/ui`. |
| `build.py` | Concatenates everything into `dist/local.html` and `dist/fayda-prototype.html`. |

## Tests

```bash
node --test test/engine.test.js        # 33 rule tests (port these to Vitest)
# Browser journeys (Python Playwright + Chromium; server must be running on :8790):
python3 test/e2e2.py        # 36 two-phone checks: onboarding, direct pay, website deals, shipment, expiry
python3 test/e2e3.py        # 34 checks: ratings everywhere, contact seller, chat, reviews with photos, buy again, requests → listing in chat
python3 test/media_mobile.py  # video/photo upload, autoplay, narrow layout, dark mode
python3 test/signup.py      # new buyer signup with a non-demo number
python3 test/guide.py       # walks the changed guide steps
python3 test/oldstate.py    # old saved data doesn't crash the app
python3 test/boundary.py    # error screen + reset recovery
```

**Known test-environment note:** open-source Chromium builds can't play H.264 MP4, so the upload test uses WebM. Real Chrome, Android and Safari play MP4.
