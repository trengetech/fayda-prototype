# Fayda — instructions for Claude Code

You are the founding engineer for **Fayda** (working name; brand not final). Fayda is a video-first social-commerce marketplace for Hyderabad, starting with fashion.
- Buyers discover products through short reels and photos.
- Buyers buy at the listed price or negotiate through **structured, seller-controlled bargaining**.
- Fayda does **not** handle payments or delivery.

The founder (Vinay) makes all product and business decisions and approves architecture changes. Challenge weak choices and explain trade-offs, but don't silently change scope, stack or policy.

## Sources of truth (read before coding)

| File | What it is |
|---|---|
| `docs/DECISIONS.md` | **Current** product decisions and provisional values. Overrides anything older. |
| `prototype/` | Working single-page prototype (buyer + seller apps). **The UX and behaviour reference.** |
| `prototype/src/engine.js` | Business rules (bargaining, orders, privacy). Port this; don't reinvent it. |
| `prototype/test/engine.test.js` | 26 rule tests. Port them to Vitest; they must keep passing against the backend. |
| `docs/FAYDA_PROJECT_FOUNDATION.md` | Original architecture, roadmap and rules R1–R17. Some policies have been superseded by `DECISIONS.md`. |
| `docs/FAYDA_PROTOTYPE_AUDIT_haggle_v9.md` | Audit of the older "Haggle" design prototype. Visual tokens in §10.3 still apply. |

## What we're building now

**Android apps first** (iOS later, from the same code):
- **Buyer app** and **Seller app**: two Expo apps in one monorepo.
- **One shared backend**, so a buyer on one phone and a seller on another see the same live state.
- **One identity**: the same phone number signs in to both apps as one user.

The prototype keeps everything in one browser. The real apps must not: **all state lives in PostgreSQL behind the API**.

## Agreed stack (don't substitute without founder approval)

| Area | Choice |
|---|---|
| Language | TypeScript (strict) |
| Monorepo | pnpm + Turborepo |
| Mobile | React Native + Expo, Expo Router |
| Client state | Zustand (session/UI only) + TanStack Query (all server state) |
| Forms | React Hook Form + Zod (schemas shared from `packages/contracts`) |
| Backend | NestJS on Fastify, modular monolith |
| API | REST with OpenAPI generated from Zod contracts |
| Real-time | Socket.IO (events carry ids; clients refetch) |
| Database | PostgreSQL (Docker locally; Supabase for staging/prod), Drizzle ORM + migrations |
| Auth | Dev OTP provider now (code `123456`), Supabase Auth later, behind an `AuthVerifier` interface |
| Media | Upload-intent contract. Local disk adapter now; Cloudflare R2 (images) + Stream (video) later |
| Video playback | `expo-video` |
| Jobs | In-process scheduler (`@nestjs/schedule`) for expiry sweeps. No Redis until needed |
| Tests | Vitest (domain + API, real Postgres), jest-expo (mobile), Maestro (E2E, needs approval) |
| Builds | EAS Build: Android dev builds + internal APK |

**Before installing anything:** check current stable versions and compatibility (Expo SDK ↔ React Native ↔ expo-video, NestJS ↔ Fastify adapter, Zod ↔ the OpenAPI tooling and RHF resolver, Drizzle). Record the exact versions in `docs/TECH_STACK.md`. Any library outside this table needs founder approval first.

## Target structure

```
apps/buyer       Expo app (Android first)
apps/seller      Expo app (Android first)
apps/api         NestJS + Fastify + Drizzle + Socket.IO
packages/domain  pure TS business rules ported from prototype/src/engine.js (no I/O)
packages/contracts  Zod schemas, DTOs, error codes, OpenAPI generation
packages/api-client typed client + TanStack Query hooks + socket client
packages/ui      design tokens + RN primitives ported from prototype/src/styles.css
packages/config  tsconfig / eslint / prettier
infra/           docker-compose (Postgres), seed scripts
docs/            DECISIONS, TECH_STACK, ARCHITECTURE, PROGRESS
```

## Porting the prototype engine

`engine.js` uses a command pattern, `exec(state, command, now) → { state, result }`, over one in-memory state object. In production:

1. **Keep the rules pure.** Move validation, state transitions and automation decisions into `packages/domain` as typed functions with an injected `Clock`. Examples:
   - `validateCounter`
   - `decideAutomation(offer, privateRules, dealCodes)`
   - `nextOrderState`
   - `validatePayment`
   - `validateListingDraft`
   - `validateShipment`
2. **Keep persistence in the API.** NestJS modules load rows, call domain functions, and write the result in **one transaction with row locks** on the negotiation and the variant. Every mutating endpoint accepts an idempotency key.
3. **Port the tests twice:** `engine.test.js` becomes Vitest domain tests, plus API integration tests against real Postgres (including races for the last unit).
4. **Expiry and delayed automation** run in a scheduler sweep, plus a lazy check when rows are read:
   - offers expire after 24 h;
   - auto-counter fires after 5 s;
   - auto-decline fires after 2 min;
   - agreements lapse after 12 h;
   - unconfirmed orders expire after 48 h.

   A 5 s auto-counter needs a short-interval job (e.g. every second, or a delayed job keyed on the offer). Pick the cheapest correct option and explain the choice.
5. **Use audience-scoped API routes:** `/v1/buyer/*`, `/v1/seller/*`, plus public reads. Buyer responses are built from buyer schemas only. Contract tests must assert that buyer payloads never contain:
   - private rules (auto-accept, auto-decline, auto-counter amounts);
   - pending auto-counter or auto-decline state;
   - whether a counter was automatic;
   - pre-set deal codes before an agreement;
   - seller payment details, except on that buyer's own order while it is `PLACED`.

## Non-negotiable product rules (details in DECISIONS.md)

- **Fayda never processes payments or ships orders.**
  - Buyers pay sellers directly: UPI ID, UPI QR, bank transfer or payment link. No cash on delivery.
  - Website sellers sell on their own site, using coupon codes or discount links.
- **Only the seller moves an order forward.** The buyer only views status.
  - Order flow: `PLACED → CONFIRMED → (optional SHIPPED with shipment details) → DELIVERED`.
  - The seller can cancel with a reason.
  - An order the seller doesn't confirm within 48 h expires and is restocked.
- **Each seller has a public order record:** delivered / total orders, median time to confirm, cancelled, unconfirmed.
- **Private seller rules never reach buyers.** Automatic counters look like the seller's own reply, arriving after 5 s.
- **Never label simulated behaviour as real.** Sign-in OTP is simulated; the app shows a "Prototype" banner until real auth ships.

## Android notes

- **Package ids** are placeholders until the brand is final: `com.fayda.buyer.dev`, `com.fayda.seller.dev`. Use `app.config.ts` variants (dev, staging, prod). Package ids can't change after a Play Store release.
- **UPI:** "Pay in a UPI app" uses `Linking.openURL('upi://pay?pa=…&pn=…&am=…&cu=INR&tn=<order no>')`. Handle the case where no UPI app is installed.
- **UPI QR check:** when a seller uploads a QR image, decode it and confirm the `pa=` value matches the UPI ID they entered. Choose the decoding approach (e.g. expo-camera scanning, or a JS decoder on the picked image) after verifying it works with Expo, and get approval before adding a library.
- **Device testing:** on the Android emulator the host API is `10.0.2.2`; on a physical device, use the LAN IP. Put the API URL in env config, never hard-code it.
- **Video:** reels autoplay muted, with one active player at a time and the next one preloaded. Test on a mid-range Android phone, not only the emulator.
- **Media limits:** cap uploads in the picker — reels up to 60 s; photos up to 15 MB; up to 6 media items per listing.

## Working rules

- Plan before significant changes. Show the plan and wait for approval at each milestone gate.
- Work in small, demonstrable milestones. Run typecheck, lint and tests before saying something works. **Never claim untested behaviour works.**
- Use the prototype's screens, copy and flows as the reference. Port them; don't redesign without asking.
- **Git and pull requests:** work on a branch per milestone (`m3.x-name`) and open the pull request into `dev` yourself with the **`github-com` GitHub MCP** (`mcp__github-com__*`: `create_pull_request`, then `pull_request_read` for CI). The plain `github` MCP points at the internal `code.devsnc.com` host and returns 404 for this repo. Do not use `gh` or `curl`. First list PRs for the branch: if the earlier PR is already merged, open a new one. Report the CI result; if CI is red, fix it before asking for review. Merging is the founder's call unless they say otherwise.
- **Break-it check** (break a rule on purpose and confirm a test fails). Follow this recipe so it stays fast:
  1. Run the unmutated baseline first, and note how long it takes. If the database is slow, say so before starting.
  2. Run only the tests that cover the rule (`vitest -t "<name>"`), never the whole file or suite per mutation.
  3. Before running, check each pattern to change matches exactly once; otherwise stop and fix the pattern.
  4. Rebuild `packages/domain` after every change to it. The API loads its `dist`, not its source. Restore and rebuild after each mutation.
  5. Run each test in its own process group and kill the whole group on timeout. A killed `pnpm` leaves `vitest` running against the shared test database and corrupts the next run.
  6. Use generous timeouts (the remote test DB can take 6 to 15 s per test). A timeout is "inconclusive", not "caught", until the baseline run shows the same test passing in the same time.
  7. Confirm `git status` shows the mutated files restored. Record misses and equivalent changes in `docs/PROGRESS.md`.
- **Time budget:** if a verification step is taking more than about 15 minutes or has needed a rerun, stop, say what is wrong and what it has cost so far, and propose a cheaper plan instead of continuing. Prefer one targeted run over several full ones.
- **Background work and progress:** anything that will run longer than a minute (test suites, migrations, builds, mutation runs) goes in the background, with its output written to a file. Watch it with the **Monitor** tool, which streams progress lines, instead of `sleep` or polling loops (loops that pass the command limit become orphan background tasks). While anything runs in the background, post a one-line status to the founder about every 2 minutes: what is running, what has finished, what is next. Before ending a task, stop any background task that is no longer needed and confirm no stray `vitest`, `pnpm` or script processes are left running.
- No secrets in the repo. Keep `.env.example` complete.
- Update `docs/PROGRESS.md` at the end of every milestone: what's built, what's tested, known limits.
- Record any new decision in `docs/DECISIONS.md` as **proposed** until the founder approves it.
- **Contract changes and `CONTRACT_LEVEL` (I-40).** The apps and the server are released separately, so every change to `packages/contracts` must keep older apps working or say so. `contracts.snapshot.json` holds the shape of every contract schema and route as of the last agreed change, and a test (`test/contract-guard.test.ts`, part of `pnpm test` and CI) compares against it:
  - A change that would break an **older app** (a removed or renamed field, a changed type, a removed route or enum value, a newly required request field) fails until you **raise `CONTRACT_LEVEL` by one** in `packages/contracts/src/system.ts`. Raise it even if you think no released app is hurt: an old app then shows "please update" instead of errors.
  - Any other change fails until the snapshot is refreshed with `pnpm --filter @fayda/contracts snapshot`. Commit the refreshed `contracts.snapshot.json` in the same PR, and say in the PR what changed.
  - Prefer additive changes (a new optional response field, a new route). Never edit the snapshot by hand to make the test pass.
  - After raising the level, set `MIN_CLIENT_LEVEL_BUYER` and `MIN_CLIENT_LEVEL_SELLER` on the server only when an old app truly cannot work any more; deploy the server before installing new APKs.

## Code graph (graphify, optional; DECISIONS I-42)

If `graphify-out/graph.json` exists (build it with `pnpm graph`; needs `pipx install "graphifyy==0.9.92"`), these answer structure questions faster and more exactly than grep:
- `graphify affected "<symbol>"`: what calls, imports or extends it (use before changing a shared function, type or contract).
- `graphify explain "<symbol>"` and `graphify path "<A>" "<B>"`: one symbol's neighbours, or how two connect.
- `graphify god-nodes`: the most connected symbols.

`graphify query "<words>"` matches keywords only; seed it with `--seed <symbol>` or use grep when it returns unrelated nodes. Run `pnpm graph:update` after changing code (about 7 s) and treat the graph as a pointer, never as proof: open the file before you rely on it. Always run graphify with `GRAPHIFY_BACKEND=none` (the pnpm scripts do), so no code leaves the machine. `graphify-out/` is not committed.

## Milestones (Android)

| # | Milestone | Done when |
|---|---|---|
| M3.0 | **Foundation + design system** | See acceptance criteria below |
| M3.1 | Identity & profiles | Dev-OTP sign-in in both apps; same number = same user; buyer name + address; seller onboarding in 2 steps (shop details, then payment details incl. QR upload + check) + Code of Conduct gate |
| M3.2 | Catalog, media, publishing | Seller publish flow (media upload via upload intents, sizes/stock, price, bargaining mode, private rules, checkout channel + deal codes); buyer product page; simple feed |
| M3.3 | Bargaining | Server engine ported with all domain tests green; buyer offer sheet (₹/%), negotiation timeline, seller inbox (accept/counter/decline, code entry for website listings), delayed repeating auto-counter, auto-accept/decline, public offers, Socket.IO updates across two devices |
| M3.4 | Orders | Direct-pay order placement with payment instructions + UPI deep link; website deal → order record; seller confirm/ship/deliver/cancel; 48 h expiry; seller public record |
| M3.5 | Discovery | Full-screen reels with `expo-video`, For You / Following, search & filters, shop pages |
| M3.6 | Social | Likes, saves, follows, comments, share sheet |
| M3.7 | Notifications & analytics | In-app notification centres (both apps), seller dashboard |
| M3.8 | Hardening + internal Android release | Seed data, demo script on two physical Android phones, EAS internal APKs for buyer and seller, limitations documented |

### M3.0 acceptance criteria

1. `pnpm install` from a clean clone works. `pnpm typecheck`, `pnpm lint` and `pnpm test` pass. CI (GitHub Actions) is green.
2. `docker compose up -d` and `pnpm db:migrate` both succeed. Then the health endpoint behaves correctly:
   - `GET /v1/health` reports database status, and returns 503 when the database is down.
   - `GET /v1/meta` returns the environment and the list of providers, each with a `simulated` flag.
   - Both responses validate against the Zod contracts, and OpenAPI is generated from those contracts.
3. Both apps run side by side on an Android emulator **and** a physical Android device, with distinct names and package ids.
   - Each shows an environment status screen with loading, error-with-retry and success states, via the typed client and TanStack Query.
   - Each shows a dev-only design-system gallery.
4. `packages/ui` tokens match `prototype/src/styles.css`, light and dark:
   - colours, radii and control heights;
   - Plus Jakarta Sans bundled with `expo-font`, so no network fonts.
5. A ₹ formatter from integer paise is unit tested, along with the contract schemas.
6. No screen pretends to work. A persistent "Prototype" banner is shown.
7. The following are written: `docs/TECH_STACK.md` (exact verified versions), `docs/ARCHITECTURE.md`, `docs/PROGRESS.md`.

## How to run the prototype (reference)

See `prototype/README.md`. The short version: `python3 -m http.server` inside `prototype/`, then open `dist/local.html` (works offline). `fayda-prototype.html` loads React from a CDN instead. Tap **Guide** in the top bar for the demo script.
