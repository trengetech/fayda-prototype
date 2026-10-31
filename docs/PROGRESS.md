# Progress

**Where we are (31 Oct 2026): M3.2 (catalog, media, publishing) is built and emulator-tested, awaiting your review and a physical-phone test. M3.1 (identity and profiles) is also still awaiting your review.** The sign-in and onboarding parts of the chat/reviews/requests update are inside it; the chat, review and request screens and API wait for M3.4. Earlier note: the chat/contact/reviews/requests update (`docs/updates/`) has its pure rules built and tested in `packages/domain` (see "Update 2026-10-31" below); the API, database and app parts wait for M3.1 to M3.4. Before that: M3.0a done. M3.0b built and tested on an Android emulator; waiting for the founder to try the APKs on a real phone. M3.1 (identity) not started.

## M3.0a — Backend foundation (31 Oct 2026): built, awaiting your review

M3.0 is split (DECISIONS I-4). This is the first half. **M3.0 as a whole is not done:** 3.0b (UI tokens, fonts, api-client, both Expo apps, emulator run) has not started.

### Acceptance criteria for 3.0a

| # | Criterion | Result |
|---|---|---|
| 1 | `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test` pass | **Pass** locally (5 tasks each). **CI added 31 Oct 2026** (GitHub Actions, I-3): green on its first PR, which also confirms a clean-clone install. |
| 2 | Migrations apply; `/v1/health` reports the database and returns 503 when it is down; `/v1/meta` lists providers with `simulated`; both validate against the Zod contracts; OpenAPI is generated from them | **Pass.** `pnpm db:migrate` applied to `fayda-dev`; the built API served 200 on health and meta against it. The 503 case is covered by a test that fails the ping. Compose is replaced by cloud Supabase (I-1). |
| 5 | ₹ formatter from paise, unit tested, plus contract schemas | **Pass** (5 + 7 tests) |
| 7 | TECH_STACK, ARCHITECTURE, PROGRESS written | **Pass** |
| 3, 4, 6 | Apps, design tokens and fonts, Prototype banner | **Not started** (3.0b) |

### What was built

- Monorepo (pnpm + Turborepo, ESM, TypeScript 6.0.3).
- `packages/domain`: the prototype engine's rules as pure typed functions with an injected clock, plus buyer-safe views.
- `packages/contracts`: Zod schemas, stable error codes, OpenAPI 3.1 generation.
- `apps/api`: NestJS 12 + Fastify, problem+json errors, health/meta/openapi, idempotency service, sweep runner, Drizzle migration for `idempotency_keys`.
- `infra/oracle-vm-setup.sh`: the script already run on the VM.

### Tests: 57 passing

| Package | Tests | Notes |
|---|---|---|
| domain | 33 | 25 of 26 prototype scenarios ported (the seed-data test does not apply). Checked by breaking two rules on purpose: 4 tests failed, then passed again once restored. |
| contracts | 7 | |
| api | 17 | Real `fayda-test` database: health, meta, OpenAPI, 404 shape, 24 concurrent requests, idempotency including 8 concurrent first attempts, sweep runner. |

### Found and fixed

Supabase's transaction pooler hangs on concurrent queries with postgres.js's default pipelining. Fixed with `max_pipeline: 1` and covered by a regression test. Details in ARCHITECTURE.

### Known limits

- Negotiation and order flows are verified at the domain level, not yet over HTTP or in Postgres (M3.1 to M3.4).
- No sweep task is registered; no mutating endpoint uses idempotency yet.
- The API runs on the Oracle VM against `fayda-dev` (see below). Its `/v1/meta` reports `environment: development` (set with `APP_ENV` on the VM; `NODE_ENV` stays `production`).
- The database password was pasted in chat several times. Founder decision (31 Oct 2026): not resetting it for now. Dev and test hold no real data.
- Git remote and CI are now in place (private repo `trengetech/fayda-prototype`, default branch `dev`; I-3). CI runs typecheck, lint and test only: no deploys and no APK builds.
- Free-tier risks (Supabase pause, Oracle idle reclaim) are unverified (I-8).

### Decisions

B-7 approved: buyers get no information that any reply was automatic.

## Deployment (31 Oct 2026)

API live at `https://fayda.140-245-219-163.sslip.io` (Caddy HTTPS, systemd, Node 24.22.2). `/v1/health` returns 200 with the database up; database round trip is about 27 ms from the VM. `infra/deploy-api.sh` deploys with automatic rollback (both paths tested). Memory use about 490 MB of 954 MB with 2 GB swap.

## M3.0b: mobile foundation (31 Oct 2026): built, emulator-tested, awaiting phone test

APKs (not committed, rebuilt with `infra/build-apk.sh buyer|seller`): `apks/fayda-buyer-dev-0.0.1.apk` and `apks/fayda-seller-dev-0.0.1.apk`, about 53 MB each, package ids `com.fayda.buyer.dev` and `com.fayda.seller.dev`, arm64 and x86_64. Both talk to the API on the VM over HTTPS.

| # | Criterion | Result |
|---|---|---|
| 3 | Both apps run side by side with distinct names and ids | **Pass on the Android emulator.** Not yet on a physical phone. |
| 3 | Status screen: loading, error with retry, success, via the typed client and TanStack Query | Success **pass**. Error with retry **pass** (airplane mode, then network back and Retry). **Loading state not visually confirmed**: the API answers in about 100 ms and the emulator slowdown did not apply. |
| 3 | Dev-only design-system gallery | **Pass** (both themes) |
| 4 | Tokens match `styles.css`, light and dark; fonts bundled | **Pass.** 6 automated tests compare the app's tokens with the CSS (colours, radii, control heights) and check text contrast. All 5 font files are inside the APK. |
| 6 | Persistent Prototype banner | **Pass** (visible on every screen, light and dark) |

Also built: `packages/ui` (tokens, fonts, components, gallery), `packages/api-client` (typed client with typed errors, query hooks; 6 tests), both Expo apps (SDK 58, Expo Router).

### Found by testing on the emulator and fixed
- The error hint told users to check "the same Wi-Fi as the laptop", wrong once the API moved to the VM.
- The gallery header had a doubled top inset; it now draws its own header.
- The first Gradle build hung for 31 minutes: its automatic NDK installer never unpacked a finished download. Fixed by installing the NDK with `sdkmanager`. If a build seems stuck at "Install NDK", check CPU use and do the same.

### Automated screen tests (31 Oct 2026)

Jest (jest-expo) with `@testing-library/react-native`, in both apps (`pnpm test`; 5 tests each, about 1 s). They render the real status screen against a mocked `fetch`, so the typed client, contract validation and TanStack Query are all exercised:
- loading state (the API never answers). This was the state I could not see on the emulator;
- success: Online, database latency, environment and version, both providers marked Simulated;
- a 503 health body shows "Database down";
- network failure shows "Can't connect" with the Internet hint, and Retry recovers;
- a malformed response shows the different hint.

Checked by breaking the screen on purpose (loading state removed, old Wi-Fi hint restored): 2 tests failed, then passed again once restored. Whole repo: typecheck, lint and 82 tests pass.

Notes: `forceExit` is set in `jest.config.mjs` because `ApiProvider` owns its `QueryClient`, whose 5-minute garbage-collection timers otherwise keep Jest alive after the run. Not covered: real device rendering, fonts, and navigation to the gallery.

### Known limits
- **Automated screen tests cover the status screen only** (see below). The gallery and the root layout (fonts, splash, banner) are still verified by hand on the emulator.
- Release APKs are signed with the debug key: fine for your own phone, not for the Play Store.
- `dev` builds allow plain-HTTP API addresses; `prod` builds will not.
- Android only; iOS not attempted.
- Builds need this Mac (Android SDK, JDK 17). EAS cloud builds are not set up.

## Update 2026-10-31 (chat, contact, reviews, requests): domain rules done, rest pending

Decisions D11 to D18 are merged into `docs/DECISIONS.md`. Founder choices: reviews only for orders that reached `CONFIRMED`; no separate M3.4b (the work goes into M3.1 and M3.4); `expo-image-picker` approved; the auth answers (dev OTP, sessions, `jose`, `@fastify/rate-limit`) come later.

**Built (packages/domain, pure, no I/O):** `profiles.ts` (Maps, Google profile and social link checks; contact; buyer onboarding; seller reach: categories, links, contact, declared times; `missingBuyerFields` and `missingSellerFields` for the "complete your profile, don't lock out" rule; `publicSellerProfile` allow-list that cannot carry phone numbers), `chat.ts` (who may write, listing cards by the seller only, unread counts, contact visible only on open orders), `reviews.ts` (CONFIRMED rule, stars, low-rating reason, average rating), `requests.ts` (validation, reach, one response per seller, want or decline, close, 7-day expiry, listing shared from a wanted response), `buyAgain` and `sellerStats` rating in `orders.ts`.

**Tests:** domain 56 pass (23 new, in `test/community.test.ts`, covering the brief's 7 new prototype tests; they test the pure functions, not a persistence harness). Checked by breaking the CONFIRMED rule and the open-order contact rule: 2 tests failed, then passed once restored.

**Not built yet:** database tables and migrations, API endpoints, Socket.IO, the app screens, and contract tests that scan real HTTP payloads (criterion 8). The brief's acceptance criteria 1 to 7 need two physical phones and so cannot be checked until those exist.

| Brief criterion | Status |
|---|---|
| 9: domain tests ported and passing | **Pass** (as pure-function tests; the older 26 prototype tests still pass) |
| 1 to 8, 10 | **Not started** (need M3.1 to M3.4) |

Next, when you are ready: M3.1 needs your answers on dev OTP, separate sessions per app, and `jose` plus `@fastify/rate-limit`.

## M3.2: catalog, media, publishing (31 Oct 2026): built, emulator-tested, awaiting review and a phone test

Founder decisions used: I-9 to I-14 (disk media now, R2 and Stream later; 80 MB video cap; `expo-camera` QR decoding; `expo-file-system`, `expo-video-thumbnails`).

### What was built
- **API (live on the VM):**
  - Media upload in 3 steps (intent, `PUT` of the bytes, complete). Size and `Content-Type` are checked on upload, the real file type by its first bytes on complete. Public `GET /v1/media/:id` serves listing files only, with Range support and long caching; UPI QR images are private. A sweep removes abandoned uploads (1 h) and unattached files (24 h).
  - Seller listings: create, edit, list, pause, resume, delete a draft. Drafts get the full validation; publish adds the stock rule. Saves take an `Idempotency-Key`, so a retry cannot make a duplicate.
  - Buyer `GET /v1/buyer/feed` (cursor paging) and `GET /v1/buyer/listings/:id`, built from buyer schemas only. A contract test scans them for private rules, deal codes and payment details.
  - Seller payment accepts a UPI QR: the phone sends the decoded text, and the server checks the QR's payee against the UPI ID.
  - Tables `media`, `listings`, `listing_media`, `listing_variants`; migration 0002, applied to dev and test.
- **Seller app:** My listings (filters, cover, stock, Pause/Resume); the listing editor (photos and videos with the caps, a cover made on the phone for each video, sizes and stock, price, bargaining modes and private rules, website checkout with deal codes; Save draft, Publish, Pause, Delete draft); the UPI QR picker on the payment step with the on-phone decode and payee check.
- **Buyer app:** a "Browse listings" button on the home screen opens a simple scrolling feed (cover, price, seller and area, Open to offers, Video and Sold out badges, more pages as you scroll, pull to refresh). A product page has a swipeable media carousel (a video shows its cover, then plays in one `expo-video` player after you tap Play), price, seller, description, sizes (Sold out, Few left; never a stock number) and a bargaining label (Open to offers / Fixed price). **Buy and Make offer are shown disabled with the line "Buying and offers are not available yet."** They arrive in M3.3 and M3.4.

### Tests: 263 passing (typecheck and lint clean)
domain 67, contracts 12, api 70, api-client 22, ui 6, seller 56, buyer 30. API tests run against the real `fayda-test` database. After writing tests I broke rules on purpose and confirmed failures: removing the ownership filter and the file-content check (API), the fixed-price no-rules rule, the save-key content hash and the on-phone QR payee check (seller), and enabling Buy, a fixed-price listing labelled as offers, and never loading the next feed page (buyer).

### Found and fixed
- **A saved QR made the seller's payment look "missing" forever** (found only on the emulator: the profile re-check needed the decoded QR text, which is not stored). Fixed with a `skipQrCheck` option, plus regression tests that fail without it. Deployed.

### Checked on the emulator against the live API
- Seller: QR decode, check and upload (a good QR accepted; an image with no QR refused with the old QR kept; a changed UPI ID warns); two photos uploaded; a listing with a private ₹1,200 auto-accept rule published; photos served publicly with caching and Range.
- Buyer (signed in as `9000000001`): the feed shows the live listing with price, seller, area and "Open to offers"; the product page shows the carousel (swiped from 1/2 to 2/2), sizes, bargaining label, and disabled Buy and Make offer with the honest note. The feed payload carries no private rules or payment details.

### Known limits
- **Not done on a physical phone**: the seller flow, the buyer screens, the QR decode and video were run on the emulator only. The emulator's disk is nearly full (97%), which once blocked an APK install; `adb shell pm trim-caches` freed enough.
- **Video was checked on the emulator only, not on a real phone.** A real 4 s H.264 clip (made with macOS AVFoundation) went through the whole path: picked in the seller app, a cover frame made on the phone with `expo-video-thumbnails`, uploaded, published Live; the server's copy is byte-identical to the picked file (`cmp`), a mid-file Range request is identical and answers 206; the buyer feed card shows the cover with the Video badge; on the product page, Play started the clip (frame counter moved, and a second Play restarted it). Not covered: a long video near the 80 MB cap, a slow network, and a mid-range phone's decoder.
- The test photos are plain dark images, so cover images look empty on screen. That is the data, not a display fault.
- The feed is a plain list, newest first (full-screen reels, search, filters and Following are M3.5).
- Offer invalidation when a price drops, stock runs out or a listing is paused is left to M3.3.
- The disk adapter is for dev and demo only: no backup, no transcoding (I-11). The 60 s reel length is enforced on the phone only; the server enforces size.
- No screen edits payment details or the QR after onboarding; resuming at step 3 drops an existing QR from the form.
- CI runs typecheck, lint and test only. The `m3.2-catalog` branch is pushed; a pull request into `dev` is needed to run CI on it.
- Dev data: shop "Kiran Studio" (`9000000002`) with one live listing; buyer "Asha Buyer" (`9000000001`) now has a profile.

## M3.1: identity and profiles (31 Oct 2026): built, tested on an emulator, awaiting review

Founder decisions used: dev OTP now; a separate session per app; `jose` and `@fastify/rate-limit` approved (D18, TECH_STACK).

### What was built
- **API (live on the VM):** `POST /v1/auth/otp/request`, `/auth/otp/verify`, `/auth/refresh`, `/auth/logout`, `GET /v1/me`; buyer `GET/PUT /v1/buyer/profile`, `PATCH /v1/buyer/profile/contact`; seller `GET/PUT /v1/seller/profile`, `PUT /v1/seller/payment`. Tables: `users` (unique phone), `sessions`, `buyer_profiles`, `buyer_addresses`, `sellers`, `seller_payment_profiles` (migration 0001, applied to dev and test).
- **Sign-in:** the dev code `123456` behind an `AuthVerifier` interface; `/v1/meta` reports it as simulated and both apps say so on the code screen and in the banner. One user per phone number in both apps; one session per app per sign-in. Access token 15 minutes (HS256, `jose`); refresh token 90 days, stored hashed, rotating; replaying an old refresh token revokes the session. Logout ends the session at once. The API checks the session on every call. `/v1/buyer/*` and `/v1/seller/*` reject the other app's token (403 `WRONG_APP`).
- **Limits:** 20 requests a minute per client address on `/v1/auth/*` (400 for everything else), and 5 wrong codes lock a number for 5 minutes.
- **Profiles:** buyer name, address, contact phone or WhatsApp, and the user agreement (version `draft-2026-10`); seller step 1 and 2 (shop, categories, Maps link, optional Google and social links, contact, declared confirm and ship times) and step 3 (payment details and the Code of Conduct). Missing fields are reported as `profile.missing`, so an older account is asked for them rather than locked out.
- **Apps:** sign-in, session restore from the Android Keystore, route gate (signed out, finish profile, home), buyer onboarding with the agreement dialog, seller 3-step onboarding with the Code of Conduct dialog, account card with Sign out. Offline at start shows "Can't reach the server" with Try again, not a sign-out.

### Tests: 143 passing (typecheck and lint clean)
domain 58, contracts 8, api 38, api-client 14, ui 6, buyer 14, seller 15. API tests run against the real `fayda-test` database. Checked by breaking the audience check and the session check on purpose: 3 tests failed, then passed once restored.

### Acceptance (brief criteria 1 and 2, 10; M3.1 done-when)
| # | Criterion | Result |
|---|---|---|
| 1 | A new buyer cannot finish sign-up without the agreement and a phone or WhatsApp number | **Pass** (API test, app test; on the emulator the form submitted only with the agreement ticked) |
| 2 | A new seller cannot finish onboarding without a category, a valid Maps link, a contact number and both declared times; invalid Google, Instagram or Facebook links are rejected | **Pass** (API and app tests). Not clicked through end to end on a device |
| 10 | Older accounts are asked for the new fields, not locked out | **Pass** (API test: a profile row without the new fields signs in and reports what is missing) |
| M3.1 | Same number is the same user in both apps | **Pass** (API test; on the emulator the seller app accepted the buyer's number and showed seller onboarding) |
| M3.1 | Dev-OTP sign-in in both apps | **Pass** on the emulator against the VM (buyer fully; seller to the start of onboarding) |
| M3.1 | Session survives closing the app | **Pass** (buyer: force-stopped, reopened, signed in with no code) |
| M3.1 | Seller payment step includes a **UPI QR upload and check** | **Built in M3.2** (see below) |

### Known limits
- **Not done on a physical phone**; emulator only, driven with scripted taps. The seller's steps 2 and 3 were not clicked through on the device (covered by app tests that use a fake server).
- Wrong-code counts are kept in the API's memory. That is fine for one process; before running two, move them to the database.
- A lost network reply during a token refresh makes the app sign out (the retry replays the old token, which is treated as theft). Rare, and safe.
- Forms check shape on the phone and leave the detailed rules to the server, which sends field messages that the forms show.
- The agreement and Code of Conduct texts are drafts and are labelled as such.
- Test accounts `9000000001` and `9000000002` exist in the dev database.
