# Progress

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
- Nothing is deployed to the Oracle VM.
- The database password was pasted in chat several times. Founder decision (31 Oct 2026): not resetting it for now. Dev and test hold no real data.
- No remote git, no CI. A local repository exists with nothing committed.
- Free-tier risks (Supabase pause, Oracle idle reclaim) are unverified (I-8).

### Decisions

B-7 approved: buyers get no information that any reply was automatic.
