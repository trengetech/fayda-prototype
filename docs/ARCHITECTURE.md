# Architecture (as built in M3.0a)

## Layout

```
packages/config     tsconfig + ESLint base (ESM)
packages/domain     pure TypeScript rules ported from prototype/src/engine.js. No I/O, no clock of its own.
packages/contracts  Zod schemas, error codes, OpenAPI builder
apps/api            NestJS 12 on Fastify, Drizzle + postgres.js, sweep runner
infra/              VM setup script
```
`apps/buyer`, `apps/seller`, `packages/ui` and `packages/api-client` arrive in 3.0b.

## Domain (`packages/domain`)

`engine.js` mutates one in-memory state object. The domain package keeps only the **decisions** as pure functions over plain data, with all time passed in:

| Area | Functions |
|---|---|
| Money | `formatRupees`, `rupeesToPaise`, `isWholeRupees`. All money is integer paise. |
| Validation | `validateListingDraft`, `validatePayment`, `validateShipment`, `validateAddress`, `validateDealAccess`, `validateCheckout`, `normalizePhone` |
| Negotiation | `validateNewOffer`, `validateCounter`, `appendOffer`, `acceptLatest`, `declineLatest`, `withdraw`, `decideAutomation`, `scheduleAutomation`, `sweepNegotiation`, `invalidationsForListingChange` |
| Orders | `validatePlacement`, `newOrder`, `confirmOrder`, `shipOrder`, `deliverOrder`, `cancelOrder`, `expireOrderIfDue`, `sellerStats`, `buyerMaySeePayment` |
| Views | `buyerNegotiationView`, `buyerListingView`. Built from an allow-list, so private rules cannot be copied in. |

Functions return new values plus **effects** the API must perform: `reserveUntil`, `restock`, `releaseReservation`, and `Notice` records (who, code, params). The API renders notification text.

B-7 (approved): buyers get no signal that any reply was automatic. Buyer notices use the same codes whether the seller or a rule acted, rule actors are shown as the seller, and `AUTO_DECLINED` is reported to buyers as `DECLINED`.

## API (`apps/api`)

- `GET /v1/health`: 200 `{status:"ok"}` when `select 1` answers within 3 s; **503** `{status:"down"}` otherwise. Never includes error text.
- `GET /v1/meta`: environment, version, providers each with `simulated`.
- `GET /v1/openapi.json`: generated from the contracts.
- Every failure is `application/problem+json` with a stable `code` (`ERROR_CODES` in contracts).
- `IdempotencyService`: `begin` / `complete` / `abandon` over the `idempotency_keys` table. First writer wins atomically (insert with conflict-ignore). Not yet wired to an endpoint, because no mutating endpoint exists yet.
- `SweepRunner`: ticks every second, runs registered `SweepTask`s, isolates failures, skips overlapping ticks. **No tasks are registered yet.**
- Config is parsed once from the environment by Zod; errors name the variable, never the value.

## Time-driven rules (design, implemented in M3.3 / M3.4)

The 5 s auto-counter, 2 min auto-decline, offer expiry, 12 h agreement lapse, reservation expiry and 48 h order expiry are **due-timestamp columns** with partial indexes. A 1 s `SweepTask` claims due rows with `FOR UPDATE SKIP LOCKED`, one transaction per row, calling `sweepNegotiation` / `expireOrderIfDue`. Reads also apply anything already due to the rows they touch. Lock order: listing, then variant, then negotiations by id.

## Database access: a finding that matters

Supabase's **transaction pooler (port 6543)** hangs if postgres.js pipelines queries. Measured on `fayda-test`: 8 concurrent `select`s timed out with `max: 1` and with `max: 5`; the session pooler (5432) answered in about 350 ms. `max_pipeline: 1` fixes it, along with `prepare: false`. Both are set in `DbService`, and `system.test.ts` has a regression test that fails without the fix.

| Use | URL | Port |
|---|---|---|
| Running API | `DATABASE_URL` | 6543 (transaction pooler) |
| Migrations, tests' setup | `DATABASE_URL_DIRECT` | 5432 (session pooler) |

## Testing

- **Domain:** 32 tests with a fake clock. 25 of the prototype's 26 scenarios are ported; the 26th checked the prototype's seed data. They run through `test/harness.ts`, an in-memory stand-in for the persistence layer built only from the domain functions.
- **Contracts:** schema, error-code and OpenAPI tests.
- **API:** 17 tests on the real `fayda-test` database. `test/env.ts` refuses to run if `.env.test` points at the same project as `.env`.

## Known limits (3.0a)

- The negotiation and order scenarios are verified against the domain rules and the in-memory harness. They are **not yet exercised over HTTP or against Postgres**, because those endpoints and tables arrive in M3.1 to M3.4. Row locking, the last-unit race and HTTP-level privacy contract tests belong to those milestones.
- Only `idempotency_keys` exists in the database.
- Nothing is deployed to the Oracle VM.
