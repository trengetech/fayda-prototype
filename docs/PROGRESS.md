# Progress

**Where we are:** M3.0a done. M3.0b built and tested on an Android emulator; waiting for the founder to try the APKs on a real phone. M3.1 (identity) not started.

## M3.0a — Backend foundation (31 Oct 2026): built, awaiting your review

M3.0 is split (DECISIONS I-4). This is the first half. **M3.0 as a whole is not done:** 3.0b (UI tokens, fonts, api-client, both Expo apps, emulator run) has not started.

### Acceptance criteria for 3.0a

| # | Criterion | Result |
|---|---|---|
| 1 | `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test` pass | **Pass** locally (5 tasks each). CI is deferred (I-3). Not tested from a clean clone, because there is no remote. |
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
- No remote git, no CI. A local repository exists with nothing committed.
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
