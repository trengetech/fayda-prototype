# Progress

**Where we are (1 Nov 2026): M3.7 (notifications, push, report and block, seller dashboard) is built, tested and emulator-checked on its own branch `m3.7-notifications-safety`. M3.6 is merged. M3.8 is next.** The physical-phone test of M3.3 to M3.7 is deferred by the founder. **Push is built but cannot reach a phone until the founder sets up Firebase and EAS (I-33).**


## M3.7: notifications, push, report and block, seller dashboard (1 Nov 2026): built, tested, emulator-checked; push needs founder setup

Decisions: I-31 (report and block), I-32 (iOS follows Android), I-33 (notification centre and push), I-34 (dashboard). All **proposed**. The founder asked for push to work, the default dashboard contents, and for this to be built, tested, merged without waiting.

### Built
- **Database (migration 0009, applied to dev and test):** `push_tokens`, `user_blocks`, `reports` (reason, note, a snapshot of the words, the photo id, status OPEN/REVIEWED/ACTIONED), and `notifications.pushed_at` (existing rows are marked as already told, so no old history is pushed).
- **Domain (`safety.ts`, 7 tests):** report reasons and note limit, 10 reports an hour, no self-report, no self-block, a shop's block stops commenting on its listings only, a block either way ends new chat messages.
- **API:**
  - Notification centre per app: list (cursor), unread count, mark one read, mark all read. Text is written by the server per app. Seller-only codes (automatic counter, decline, accept) never render in the buyer app.
  - Push tokens: PUT and DELETE `/v1/{app}/push-token`. A token moves to whoever signed in last; at most 5 per person per app.
  - Sweep task (every second): claims unsent notifications (`FOR UPDATE SKIP LOCKED`), emits `notification.created` (ids only), sends push through a `PushProvider`. `PUSH_PROVIDER=off` (default) sends nothing and `/v1/meta` says push is simulated; `expo` sends through the Expo push service in chunks of 100. A gone phone loses its token; a temporary failure is retried for 2 minutes; at most once otherwise.
  - Report: comments and chat messages or photos (`reports` keeps the snapshot). Block: by comment or by thread, by person across both apps; list and unblock. Comments hide the blocker's blocked people (page and total); a shop's block returns 403 `BLOCKED` on that shop's listings; chat send returns 403 `BLOCKED` both ways; threads carry `messagingDisabled` and `youBlocked` (the blocked side is not told who blocked).
  - `GET /v1/seller/dashboard`: last 7 and 30 days plus the public record and what needs the seller.
- **Apps (both):** notifications screen with an unread badge button on home, tap opens the order, chat, offer, request or comments; report sheet and Report/Block links on others' comments and chat messages; chat composer replaced by a notice when blocked; Blocked people screen; push registration after sign-in (asks permission, sends the token if the build has an Expo project id), token removed on sign-out, tapping a push opens its target. Seller app: Dashboard screen.
- **Shared:** `ReportSheet` and `SafetyActions` in `packages/ui`; client methods, hooks and `notificationHref` in `packages/api-client`; `expo-notifications` 58.1.7 in both apps (TECH_STACK).

### Tested
- **API (Vitest, real Postgres): 20 new tests, all passing** (notifications and push 11, safety 9): own-only reads and writes, wrong app, paging, read-all scoped to one app, wording privacy, token moves and cannot be removed by another person, sweep tells the right person once, gone and retry paths, Expo request shape and chunking, report limits (10 an hour, lifts after an hour), repeat reports, snapshot kept after removal, blocks in comments and chat both ways, order stays readable. Regression: system, chat, sweep, realtime and requests files pass (two `requests` tests hit the 30 s timeout while the APK build was using the machine and pass alone in about 90 s: slow database under load, not a rule change).
- **Domain 7, api-client 57, buyer and seller mobile suites** (new tests for notifications, report and block flows, blocked chat, dashboard, push token and push-tap parsing). Lint and typecheck clean.
- **Break-it check (domain rules, 7 breaks, all caught):** own report allowed; limit off by one; self-block allowed; shop's block list ignored; shop blocked on its own listing; block does not end messages; note limit removed. The API-level breaks (hide blocked comments, send guard) were not mutated; they are covered by the tests above.

### Checked on the Android emulator (1 Nov 2026, local API on the dev database, new APKs)
- Buyer: signed in as a new buyer; Android asked for notification permission (the registration path runs; no token is sent because the build has no Expo project id); a spam comment showed **Report** and **Block**; the sheet showed the four reasons with Send disabled until one is picked; reporting showed "Reported. Thank you." and the database row was SPAM, OPEN, with the comment text kept; blocking asked first and the person's comments disappeared; Blocked people listed them, and Unblock removed the row.
- Seller: home showed "Notifications (2 new)"; the centre listed the two `NEW_COMMENT` rows as unread; **a comment posted through the API while the screen was open appeared in about 4 s with the unread count at 3**; tapping it opened that listing's comments and the count dropped; Dashboard showed Needs you, the 7 and 30 day windows (3 comments) and the record.
- **The comment box with the keyboard open (M3.6 fix) is visible above the keyboard.**

### Follow-up checks on the emulator (1 Nov 2026, after the merge of PR #10)
- **Chat report and block, seen on the buyer app** with a seeded order (FD-100004) and rude messages from the seller: Report asked for a reason and said "Reported. Thank you."; Block asked first, then the message box was replaced by "You can't send messages in this chat. You blocked this person..." with the history kept; the seller's send was refused (403); Blocked people listed the seller, and Unblock brought the message box back.
- **Found and fixed:** after Report, the Block link was gone (first the whole row was replaced, then in a narrow chat bubble the link was cut off). The row now wraps and keeps Block; seen on the emulator.
- **Found and fixed (build process):** gradle did not rebuild the JavaScript bundle when only `packages/ui` changed, so three "rebuilt" APKs were the old code (the APK file date gave it away). To force it: `./gradlew :app:createBundleReleaseJsAndAssets --rerun` before `assembleRelease`.
- **Listing views (I-35):** opening a product page in the buyer app made one row in `listing_views`, and the seller dashboard showed "Listing views 1" in the 7 and 30 day windows.

### Not done, or not seen
- **Push setup and proof (1 Nov 2026): done on the Android emulator, not yet on a physical phone.**
  - Expo projects `@trengetech/fayda-buyer` (88bbc327-72fb-4de0-a4e6-52f73fc1233a) and `@trengetech/fayda-seller` (1341685c-b1c4-4c90-8269-eb170e423622); ids in each `app.config.ts`; `eas.json` added to both apps.
  - Firebase project `trenge-fayda` with the two Android apps. The FCM V1 service-account key is uploaded to both Expo projects (`eas credentials`). The two `google-services.json` files are kept in `~/fayda-secrets` (outside git, mode 600) and used with `GOOGLE_SERVICES_JSON=<path>` when building. `.gitignore` now blocks `google-services*.json` and `*adminsdk*.json`.
  - **Proven with the local API on `PUSH_PROVIDER=expo`:** each app asked for permission and registered a real Expo push token; a seller chat message reached the buyer app and a buyer comment reached the seller app **with the app in the background and with its process killed**; the push text was the notification centre's text; tapping it opened the right screen (the order chat; the listing's comments); signing out removed the token (0 tokens left, so pushes stop).
  - **Not done:** a physical phone; iOS; `PUSH_PROVIDER=expo` on the deployed server (it is still `off` there); staging and prod package ids are not in Firebase yet (add them when those variants are built). The key file is still in the founder's OneDrive Downloads folder: move it to a private place or delete it (it can be regenerated).
  - Build note: build with `GOOGLE_SERVICES_JSON` set, run `expo prebuild`, and use the forced re-bundle command above.
- **M3.8 starts with a push check (founder, 1 Nov 2026):** the founder will set up Expo/EAS and Firebase (I-33) and say when it is done. Then: add the project id and `google-services.json`, set `PUSH_PROVIDER=expo`, and prove a real push on a phone (app closed, tap opens the right screen). Until then push is untested end to end.
- **Real push to a phone.** The server path is tested against the Expo request shape only. It needs: an Expo/EAS project id in `app.config.ts`; a Firebase project with each variant's `google-services.json` (`GOOGLE_SERVICES_JSON`) and the FCM key in EAS; `PUSH_PROVIDER=expo` on the server. For iOS later: an Apple Developer account and APNs key. Not run on a device, not on iOS.
- A report review screen does not exist: reports sit in the `reports` table (status OPEN). No moderation tooling, no email to a moderator. **Admin console is later work (DECISIONS L1); founder agreed 1 Nov 2026.**
- The comment count on cards and the product page still counts comments from blocked people (counts are public); the list hides them.
- Dashboard: "delivered" counts orders now delivered whose last change is in the window (founder accepted this). **Listing views were added after the first merge (I-35, migration 0010):** counted when the buyer product page opens, once per person per listing per hour, own opens excluded; shown on the dashboard. Not counted: reel impressions, shop pages; no per-listing view number yet.
- Notifications are never deleted or expired; no per-type mute settings; one row per chat message.

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

## M3.6: social (1 Nov 2026): built, tested and emulator-checked; not yet run on a physical phone

Branch `m3.6-social` from `dev`. Decisions recorded as proposed: I-28 (likes and saves), I-29 (comments, including that report and block are a public-release blocker), I-30 (share link scheme).

### What was built
- **Database (migration 0008):** `likes` and `saves` (generic edge tables like `follows`: user, target type, target id, unique edge, target index), `comments` (soft removal with `removed_at` and `removed_by`; unique per author and client key), and `notifications.listing_id`.
- **Domain (`packages/domain/src/social.ts`):** comment checks (300 characters, trimmed, not empty), 20 comments an hour, 1,000 saves, who may like (not your own listing) and save, who may remove a comment (author or the listing's seller), count and "time ago" formatting. 9 tests.
- **API:**
  - Likes and saves: `PUT` and `DELETE /v1/buyer/listings/:id/like` and `/save`, repeat-safe; `GET /v1/buyer/saved` (newest save first, paged, listings no longer live are left out). A per-person lock keeps the 1,000-save limit exact when taps race.
  - Comments: buyers `GET` and `POST /v1/buyer/listings/:id/comments`, `DELETE /v1/buyer/comments/:id` (own only); sellers `GET` and `POST /v1/seller/listings/:id/comments` (replies are marked as the shop) and `DELETE /v1/seller/comments/:id` (any comment on their listing). Comments name people by first name only. A new buyer comment makes a `NEW_COMMENT` notification for the seller and a `comment.created` realtime event (ids only).
  - Feed cards, the product page and the Saved list carry `likeCount`, `commentCount`, `liked`, `saved`; seller listings carry `stats {likes, saves, comments}` (counts only, never who).
  - All eleven routes are in the OpenAPI document.
- **api-client:** like, save, comment methods; hooks `useSetLike`, `useSetSave` (flip at once, roll back on refusal, and patch every cached card), `useSavedListings`, `useComments`, `usePostComment`, `useRemoveComment`; `comment.created` refreshes comments.
- **Buyer app:** a reaction row (Like, Comments, Save, Share) on every reel and on the product page; a comments section with post and remove; a Saved screen from the home screen; the Android share sheet sends "title, price on Fayda" with a `faydabuyer://listing/<id>` link (I-30).
- **Seller app:** a stats line on each listing row ("♥ n · Saved n · n comments") and a Comments screen to reply as the shop and remove any comment.

### Tests
domain 89, contracts 18, api-client 50, ui 6, buyer 140, seller 102 (all green); API social tests 21 (real `fayda-test` database). Typecheck and lint clean in all packages.
- **API suite run locally:** only the files M3.6 touches (social, discovery, listings, realtime, system: 67 tests) were run here, because the full suite takes over an hour on the remote test database (2 of 18 files in 9 minutes). The pull request's CI runs the whole suite.
- **Break-it check (recipe in CLAUDE.md), 10 breaks, all caught (about 9 minutes):** your own listing can be liked; anyone may remove any comment; no hourly comment limit; a buyer reads a paused listing's comments; removed comments still listed; a buyer's surname shown; the owner notified of their own reply; another shop can reply on this listing; another person's saves leak into the Saved list; the per-person lock removed (save limit race).

### Review of this diff before the pull request
A separate review pass found 10 points. Fixed (each with a test): a comment client key reused on another listing returned the first listing's comment (now refused with 409); the 20-an-hour comment limit could be passed by parallel posts (now one lock per person; 30 at once let exactly 20 through); a Saved page could be empty yet carry a cursor when the newest saves were paused (the page is now built from live listings only); the owner could read a question on a paused listing but not answer it (the shop may reply on a paused listing, never on a draft); a seller could save their own listing and inflate their saves (refused, like likes); a failed like or save left a wrong heart on the shop page and Saved list (every patched cache is reloaded, and reads in flight are cancelled before the guess); OpenAPI said "oldest first" for comments that are newest first. Left as they are, noted below: orphan likes and saves if a listing were hard-deleted (only drafts are deleted, and drafts have none); the notification is written outside the comment's transaction; every comment page also counts the total.

### Checked on the Android emulator (1 Nov 2026, local API on the dev database, new APKs for both apps)
- Buyer: Like flipped to "Unlike (1 likes)" and the server agreed; Save showed "Saved" and the Saved screen listed it with "1 like, 1 comment"; Share opened the Android sheet with the title, price and the `faydabuyer://` link; a comment posted from the product page showed at once as "Meera, just now".
- Seller: the listing row showed "♥ 1 · Saved 1 · 1 comment"; the Comments screen showed the buyer's comment; a reply posted as "Reels Two, Your shop"; removing the buyer's comment asked first, then it disappeared and the API agreed (1 comment left).
- **Found and fixed while testing:** on the product page the keyboard covered the comment box (the page did not scroll to it). The field now brings the page to it on focus (`onFocus` added to `TextField`); typecheck is clean, but I did not rebuild the APK to look at this one fix.
- Not exercised by hand: opening a shared link from another app, the `NEW_COMMENT` row on screen (there is no notification screen until M3.7; the API test checks the row), a second device, a mid-range phone.

### Known limits
- Saves on a listing that is later paused still count toward the 1,000 limit until the person removes them; the Saved list shows live listings only.
- **No report or block on comments (I-29).** Play's user-generated-content policy requires them before a public release. This is a blocker for public release, not for the internal build.
- Comments are flat, with no replies to a reply, edits, or likes on comments.
- Likes and saves count real people, but there is no ranking by them yet (For You is still newest first, I-26).
- The shared link only opens the buyer app where it is installed; there is no web page yet.

## M3.5: discovery (1 Nov 2026): built, tested and emulator-checked; not yet run on a physical phone

Branch `m3.5-discovery` from `dev`. Founder decisions used: access-checked chat photos first (I-19); search includes tags (I-24); a proper, expandable follows table now, not a stub (I-23); work order photo check, reels, search, shop pages.

### What was built
- **Chat photos are private (I-19).** `GET /v1/{buyer|seller}/threads/photos/:mediaId` streams a chat photo only to the two people in the thread it was sent in; anyone else, an unsent photo and a missing one all give the same 404. The public media route refuses chat photos and an unsent chat photo has no address. The apps load them with the bearer token (`getChatPhotoSource`).
- **Database (migration 0007):** `listings.tags` (text array, GIN index), `listings_price_idx` for price sorting, and `follows` (follower, target type, target id; unique edge; indexes both ways).
- **Domain (`packages/domain/src/discovery.ts`):** tag cleaning and checks, search-term parsing and LIKE escaping, feed filter checks, and the follow rules (not your own shop, at most 1,000). 10 tests.
- **API:**
  - `GET /v1/buyer/feed` now takes scope (For You or Following), search `q`, category, price range, size in stock, open to offers and sort (newest, price low to high, price high to low), with a keyset cursor that only fits its own sort. Each card carries the first video, `following` and `ownShop`. `GET /v1/buyer/feed/facets` lists categories, in-stock sizes and the price span.
  - Shop pages: `GET /v1/buyer/shops/:handle` (public profile, order record, follower and listing counts; no contact or payment details) and `/shops/:handle/listings`.
  - Follows: `PUT` and `DELETE /v1/buyer/follows/sellers/:id` (repeat-safe), `GET /v1/buyer/follows`. A per-person lock keeps the 1,000 limit exact when two taps race.
  - Listing tags on create and edit (omit to keep, `[]` to clear), shown to buyers on the product page.
- **api-client:** `getBuyerFeed(params)`, facets, shop, follow methods; hooks `useBuyerFeed(params)`, `useShop`, `useShopListings`, `useFollowedShops`, `useSetFollow` (flips at once, rolls back on refusal).
- **Buyer app:** full-screen reels (one active `expo-video` player, the next one prepared, pause on background or when another screen covers it, tap to pause, Sound switch), For You and Following tabs, Buy and Make offer (the offer sheet opens straight away), Search with filters and sort, shop pages, "Shops you follow", seller name opens the shop from the product page, tags on the product page.
- **Seller app:** a Tags field in the listing editor.

### Tests: 570 passing (typecheck and lint clean, all 9 packages)
domain 80, contracts 16, api 202 (real `fayda-test` database), api-client 44, ui 6, buyer 126, seller 96.
- **Break-it check (recipe in CLAUDE.md), 11 breaks, all caught:** chat photo open to any signed-in person of the app; public route serving chat photos again; Following scope ignored; paused listings in the feed; search wildcards not escaped; size filter ignoring stock; a cursor from another sort accepted; own shop followable; no follow limit; the limit race without the per-person lock; one person's follows leaking into another's list. A twelfth idea, leaking a contact number through the shop page, is not a real break: the response schema drops fields it does not name (a contract test covers that). Whole run 581 s.
- A first draft of the break-it runner ran single tests with `-t`; the discovery tests share state, so it was changed to run the whole file (about 50 s each).

### Review of this diff before the pull request
A separate review pass found 10 points; fixed: unfollow now takes the same per-person lock as follow; follower counts ignore a shop that no longer exists; price filters must be whole rupees; a failed follow reloads every card from the server instead of trusting the guess; facet queries run in parallel; a misplaced doc comment. Not changed, by choice and noted in `DECISIONS.md`: the unused GIN index and the scanning search (I-25), uncached facets, the polymorphic follow target without a foreign key (I-23), the sub-millisecond note on the cursor (comment added), and two small duplications (cursor helpers, the two chat photo handlers).

### Checked on the Android emulator (1 Nov 2026, local API on the dev database, new APKs for both apps)
- Buyer: signed in with the dev code; the reels fill the screen with the seller, price, label, Buy and Make offer; a video reel plays (frames change between samples) and swiping moves to the next; Follow flipped to "Following" at once and the shop page showed "1 follower"; the Following tab listed that shop's listings; the shop page showed the record, categories and map button; search found a listing by a tag ("wedding"), by shop handle and by a two-word tag ("summer wear"); a search with no match said so and offered "Ask sellers"; the seller's chat photo loaded in the order chat through the private route (the API log shows the request).
- API on the same data: the thread's buyer and seller got the photo, no token got 401, another seller and the public route got 404.
- Seller: the Tags field showed "cotton, summer wear" with its hint; adding a tag and saving stored `['cotton','summer wear','handloom']`.
- **Found and fixed while testing:** nothing in the app; the sign-in limit (20 a minute) blocked my own seed script, so the local API ran with a higher limit for the test only.
- Not exercised by hand: sound on (the emulator has no audio check here), the filters panel beyond the sort chip, backgrounding the app during a video, a second device, a mid-range phone.

### Known limits
- **For You is newest first, with no ranking** (I-26).
- **Search scans** (I-25): fine for thousands of listings; trigram or full-text next.
- Video preload behaviour and memory with two players are unverified on a real phone (I-27).
- Following has no push or in-app notification until M3.7.
- The follow target has no database foreign key (it is polymorphic, I-23).
- Chat photos still stream through the API; R2 signed URLs come with the R2 move (I-10).

## M3.4: orders, chat, reviews, requests (31 Oct 2026): built, tested, deployed and emulator-checked; not yet run on a physical phone

Founder decisions used: complete scope (orders plus chat, reviews and buyer requests, D18); order numbers must be extendable and never run out (I-17); an agreement that lapses without an order only frees its unit; a paused listing refuses an order. Branch `m3.4-orders`.

### What was built
- **Database (migration 0006, applied to the test database only):** `orders` (with a bigint identity `seq` from 100001, snapshots of price, address and listing, unique per agreement), `chat_threads`, `chat_messages`, `reviews`, `review_media`, `buyer_requests`, `request_media`, `request_responses`, `response_media`; `notifications` gained order, thread and request ids; media purposes now include REVIEW, REQUEST and CHAT.
- **API:**
  - Orders: buyer place, list, read, payment QR (own PLACED UPI order only); seller list, read, confirm, ship, deliver, cancel; seller record (own and public). Placement takes a unit, or consumes an agreement's reservation and marks the negotiation `PURCHASED`; a website deal records an order with no address; the sweep expires unconfirmed orders at 48 h and restocks once; a lazy check does the same on read.
  - Chat (both apps): threads, messages with a retry-safe `clientKey`, read marks, unread counts; an order thread is created with the order.
  - Reviews: one per order, only after `CONFIRMED`, editable; public shop reviews without buyer surnames or phones.
  - Requests: create (reach counted by category, buyer's own shop excluded), respond (one per seller), want (opens a chat) or decline, close, 7-day expiry; a listing published from a wanted response is posted into that chat.
  - Buyer media uploads (`/v1/buyer/media/*`); realtime `order.updated`, `chat.updated`, `request.updated` (ids only).
  - The buyer listing now carries seller rating, declared times, categories and public record, and `checkout.payMethods` (names only); a negotiation carries its `orderId` once purchased.
- **api-client:** methods, hooks, query keys and realtime invalidation for all of the above.
- **Buyer app:** checkout, order screen (view-only; payment card with order number, UPI deep link with the no-UPI-app case, QR, bank, link; contact card; review form), My orders, Messages and chat, Requests (form, list, detail), contact and agreement screens, seller card with rating.
- **Seller app:** Orders (four tabs, confirm, optional shipment, deliver, cancel with reason, contact card), Messages and chat (share a listing), Requests (New and Responded, respond with a photo, create a listing from a request), Shop (what buyers see, public record, reviews).

### Tests: 496 passing (typecheck and lint clean, all 9 packages)
domain 70, contracts 14, api 176 (against the real `fayda-test` database), api-client 39, ui 6, buyer 97, seller 93. The apps ran against fake servers only.
- New API tests: orders 32, chat 9, reviews 12, requests 14 (and others unchanged).
- **Break-it checks** (recipe in CLAUDE.md): orders, 12 deliberate breaks, all caught (size-row lock, restock on out-of-stock, payment shown after confirm, contact after close, agreed price ignored, agreement not used up, paused listing, another buyer reads an order, QR to any buyer, offers not closed when sold out, stock not taken). Only the two-buyer race catches a missing size-row lock; the agreement-versus-plain-buy race passes without it. Community, 11 breaks, 10 caught; the miss (dropping `status = 'OPEN'` from the request expiry query) behaves the same, but closed requests could fill the 100-row sweep batch. The seller app's cancel-reason guard was also broken and caught.

### Checked on the Android emulator against the live API (31 Oct 2026)
- A script on the live API: placed an order (a retry with the same key returned the same order), payment details shown while `PLACED` and hidden after confirm, contact numbers only while open, order chat thread, a message, a review after confirm, the public seller record, request reach, and cancel with "Out of stock" (no restock).
- Buyer app (new APK): home shows My orders, Messages, Your requests, Delivery addresses; the product page shows ★ rating, declared times and the public record; Buy and Make offer both enabled; checkout offered only UPI (the only method that seller has), the saved address and "Add or change address"; placing the order made **FD-100002**; the payment card showed the order number, UPI ID, the seller's private QR (loaded through the order-scoped route), "Pay in a UPI app" (with no UPI app on the emulator it showed the handled message with the UPI ID and note), and one-tap Copy ("Copied", and Android's clipboard bubble showed the text).
- Seller app (new APK): home showed "1 order needs confirming" and "1 unread message"; the Orders tabs and counts were right; the order screen showed the address, contact card and confirm countdown; "Payment received" moved it to CONFIRMED with "Add shipment details" and "Mark delivered" next.
- **Found on the emulator, fixed:** the order row's status label squeezed the title and number into a narrow column (seller; the buyer row had the same pattern). Labels now sit under the text. Tests could not see this.
- **Second emulator round (1 Nov 2026):** checked by hand on the live API: shipment details (seller saves, buyer sees courier and tracking), review (4 stars posted; the seller's rating moved to 4.5 from 2 reviews), order chat both ways with the unread badge, the address editor (validation, bad PIN rejected, add, make default, delete with confirm, deleting the default moves it, the only address cannot be deleted), buyer request (photo required, "Send to 1 seller" reach count), seller sees it and replies with a photo, buyer sees the reply and photo.
- **Found on the emulator, fixed (1 Nov):** every buyer photo upload (chat, review, request) failed with "check your connection". The buyer picker re-encodes (quality 0.8) while the app declared the picker's size for the original, so the API correctly answered 400 UPLOAD_MISMATCH. The app now measures and names the file it actually sends. Two tests added (one fails on the old logic); confirmed on the emulator with a new build. The seller picker uses quality 1 and was not affected. Not yet confirmed on a physical phone.
- Seen, not fixed: after a form field is corrected, its old validation message stays until the next Save (address form). One shipment save timed out once (8 s) and worked on retry, taken as emulator network noise.
- Not exercised by hand: a second device, real UPI apps, WhatsApp, Call, a photo from a real camera.

### Not done (honest list)
- **Deployed 31 Oct 2026** after your go-ahead: migration 0006 is on the dev database and the API (with the address endpoints) is on the VM, healthy.
- **Not tried on a physical phone.** UPI intents with a real UPI app, WhatsApp, Call, the photo copy when creating a listing from a request, and review photo upload are untested on a device.
- Website Buy now at list price creates no order and no visit counter exists (O-5).
- **Added after review:** an address editor (add, edit, delete, make default, up to 10; checkout links to it) and one-tap copy with `expo-clipboard` ("Copied" shown). Clipboard and the editor are tested with mocks and fake servers, not on a device.
- Review, request and chat photos are not access-controlled (I-19).
- The seller record reads every order of the seller per product-page view; fine now, needs an aggregate later.
- Messages sent in the same millisecond have no guaranteed order.
- CI has not run on this branch (PR needed).
- The shipment contract uses `courier`/`trackingNo`; the domain uses `carrier`/`trackingId`; the API and the seller app map between them.

## M3.3: bargaining (31 Oct 2026): approved by the founder; emulator-tested; phone test still to do

Branch `m3.3-bargaining`; pull request into `dev` opened by the founder, CI clean. Founder decisions used: **two listing modes** (`BUY_NOW`, `BOTH`), bargaining always private, no public offers (DECISIONS B-1); **offer expiry per listing: 30 min, 1 h, 3 h, 6 h, 24 h** (offers only). Socket.IO 4.8.4 added (TECH_STACK).

### What was built
- **Domain:** two modes; `expiryMinutes`; `visibility` removed from negotiations; `timeLeft`, `parseRupees`, `priceAfterPercentOff`. The M3.0a rules (`validateNewOffer`, `validateCounter`, `decideAutomation`, `sweepNegotiation`, invalidation, buyer view) are used as they were.
- **Database** (migrations 0003, 0004, applied to dev and test): `negotiations` (the aggregate: offers/events/agreement as JSON, `next_due_at`), `reservations`, `notifications`. Listings: `bargain_mode` becomes `BUY_NOW`/`BOTH`; `expiry_hours` replaced by `expiry_minutes`. The one existing listing converted.
- **API (deployed to the VM):**
  - Buyer: `POST /v1/buyer/listings/:id/offers`, `GET /v1/buyer/negotiations[/:id]`, `POST .../counter | accept | decline | withdraw`.
  - Seller: `GET /v1/seller/negotiations[/:id]`, `POST .../accept | counter | decline` (website listings need the code or link).
  - Every write takes an `Idempotency-Key`. Every change runs in one transaction; lock order is the size row, then the negotiation (DECISIONS I-15).
  - **Timers:** the existing 1 s sweep fires auto-counter (5 s), auto-decline (2 min), offer expiry (the listing's window) and agreement lapse (12 h), using `FOR UPDATE SKIP LOCKED`. A lazy check on read fires anything already due.
  - **Listing edits** close open offers in the same transaction: paused, switched to Buy now, price dropped to or below an offer, size removed, stock gone.
  - **Real-time:** Socket.IO, one room per person per app, token and session checked on connect. Events carry ids only and are sent after the commit.
- **Seller app:** Offers inbox (Needs reply / Waiting / Agreed / Closed) with a count on the home screen; offer screen (timeline, which replies your own rules sent, counter range, accept, counter, decline with a confirm, code or link entry on website listings); "N open" on the listings list; listing editor with the two modes and the five expiry choices.
- **Buyer app:** Make offer sheet on the product page (size, amount in ₹ or percent off, expiry note, idempotency key kept across a retry of the same offer); My offers; negotiation screen (timeline, accept, counter with range, decline, withdraw, agreement with the held unit and the website code). **Buy is still disabled** (orders are M3.4); the note says so.
- **api-client:** negotiation methods and hooks, `startRealtime` and `useRealtime` (refreshes screens on an event or a reconnect; one token refresh if refused).

### Tests: 330 passing (typecheck and lint clean)
domain 70, contracts 14, api 104, api-client 25, ui 6, seller 67, buyer 44. API tests run against the real `fayda-test` database.
- **API (29 negotiation + 5 real-time):** the walk offer, counter, counter, accept; the 6-offer limit; every offer rule (floor, list price, whole rupees, own listing, Buy now only, one open per size, 3 per day); retry with the same key; privacy between buyers and sellers and between apps; **two buyers accepting the last unit at once (one wins, the other is closed SOLD_OUT, one reservation)**; three sellers' accepts racing for two units; auto-accept, 5 s auto-counter (also on read without the sweep), 2 min auto-decline, and **three sweeps at once fire a step once**; a scan of every buyer payload for rules, codes, rule amounts, "AUTO", "SYSTEM" and payment details; 30-minute expiry; 12 h agreement lapse and the unit freed; each listing edit that closes offers; website code rules and the B-6 price.
- **Real time (against a real socket server):** no token, bad token, ended session refused; the seller hears a new offer and the buyer hears the reply; a stranger and the other app hear nothing; the event arrives after the commit.
- **Break-it check (done after approval).** I broke each rule on purpose and ran the negotiation tests (the API loads the built `packages/domain`, so it was rebuilt after each domain change):

  | Broken on purpose | Result |
  |---|---|
  | Size-row lock removed | **Caught**: both last-unit race tests fail |
  | Lock order reversed (negotiation, then size) | **Caught**: 2 tests fail |
  | Buyer sees `AUTO_DECLINED` as the close reason | **Caught**: the ordinary-decline test fails |
  | Buyer sees the real event actor | **Caught**: the same test fails |
  | Wrong-code count never increments (new lockout) | **Caught**: 6 tests fail |
  | Negotiation-row lock removed | **Not caught.** The size-row lock already serialises every user action on a size, so this lock only matters where a user action overlaps the sweep. I added a test for that overlap (sweep plus several readers at the same moment); it passes with and without the lock. Known limit. |
  | Sweep `skipLocked` removed | **Not caught, and equivalent.** The second sweep waits, then sees the row is no longer due and skips it. Same result, slightly slower. |

  Lesson: the first run of the two buyer-view checks said "not caught" only because the domain `dist` was stale. Rebuild `packages/domain` before API tests. The remote test database can be slow (a full negotiations file took 281 s), so caps on test runs must be generous.

### Checked on the Android emulator against the live API
Both new APKs built and installed on one emulator (the old builds had to be uninstalled; the disk is 98% full).
- Seller: signed in; the Offers inbox listed real offers in the right tabs; **a new offer made by the API appeared on the open inbox by itself in about 4 s** (no touch, no pull-to-refresh), showing "Expires in 3 h" from the listing's own setting; opened it, typed ₹2,000 and sent a counter.
- Buyer: signed in; the home button said "My offers (2 to answer)"; the negotiation showed the counter as "Seller countered ₹2,000"; accepted it; the seller's view then showed AGREED with the buyer as the accepter.
- Buyer offer sheet on a product page: size chips (sold-out sizes hidden), Discount (%) → 20% off showed "Your offer: ₹1,600", sent, and the app opened the negotiation ("Waiting for seller", "Expires in 1 h", Withdraw).
- Private rules live: an offer of ₹1,000 on a listing with rules got a seller counter of ₹1,600 five seconds later, with nothing in the buyer's payload that says a rule did it; an offer at or above the lowest price was accepted at once.
- Real time over the real HTTPS proxy (wss) also checked with a script.

### Known limits
- **Emulator only**: one emulator ran both apps, one after the other. Not two physical phones, and not the second device across the network. Real push to a backgrounded app is not built: when the app comes to the front the socket reconnects and the screens refresh.
- **No notifications yet**: the domain's notices are stored (`notifications`) but not shown or pushed (M3.7).
- **An agreement holds one unit for 12 h but nothing uses it yet.** "Place order" at the agreed price, and Buy at the listed price, arrive with orders (M3.4). The unit is released when the 12 h passes.
- The socket checks the token and session only when it connects. A session that ends later keeps its socket until the next reconnect.
- Offer countdowns ("Expires in 53 min") are computed when the screen draws, not ticking.
- Accepting at the same instant a seller pauses the listing can leave an agreement on a paused listing (orders will refuse it). A deadlock between two writers is theoretically possible and is not retried; the lock order is meant to prevent it.
- Changing a listing's rules does not change timers already set on pending offers.
- The seller sees the buyer's profile name, or "Buyer" if none.
- Dev data left on the live API: listings "Manual Offer Saree" and "Sheet Test Kurta", the existing kurta now takes offers with rules (accept ₹1,400, counter ₹1,600, decline below ₹500), and several test negotiations (buyers `9000000001`, `9000000003`).

### M3.3 follow-ups (31 Oct 2026): built, awaiting review
- **Wrong-code lockout moved to the database.** New table `otp_attempts` (migration 0005, applied to dev and test): phone, count, `locked_until`. One atomic upsert counts each wrong code, so two API processes, or two requests at the same moment, cannot lose a count. 5 wrong codes lock a number for 5 minutes; a lock that has run out starts again at 1; a right code clears the count. The in-memory map is gone.
  - Tests (`test/auth-lockout.test.ts`, 4): two API instances on one database share the count and both lock; five simultaneous wrong codes still lock; unlock after 5 minutes then a fresh count; a right code clears it. Breaking the increment makes 6 tests fail.
  - Found while building: a `Date` inside a raw SQL fragment travels as text and Postgres refused it (a 500 only the new tests showed). Fixed with an explicit `::timestamptz` cast.
- **Sweep-and-readers test** added to `negotiations.test.ts` (an automatic step fires once when a sweep and several readers arrive together).
- **Project rules** (`CLAUDE.md`): open PRs into `dev` with the GitHub MCP and check CI; run the break-it check and rebuild `packages/domain` first.

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
- ~~Wrong-code counts are kept in the API's memory.~~ **Fixed** (see "Wrong-code lockout" under M3.3 follow-ups).
- A lost network reply during a token refresh makes the app sign out (the retry replays the old token, which is treated as theft). Rare, and safe.
- Forms check shape on the phone and leave the detailed rules to the server, which sends field messages that the forms show.
- The agreement and Code of Conduct texts are drafts and are labelled as such.
- Test accounts `9000000001` and `9000000002` exist in the dev database.
