# Tech stack — exact versions

Checked against the npm registry on 31 Oct 2026. **Installed** means it is in the lockfile and the repo's typecheck, lint and tests ran against it. **Verified, not installed** means its peer ranges and the Expo SDK 58 pin list were checked, but it arrives in 3.0b.

## Runtime and tooling (installed)

| Item | Version | Notes |
|---|---|---|
| Node.js | 24 (laptop 24.21.0, VM 24.22.2) | React Native 0.88 needs ≥ 24.3 or ≥ 22.13; Vitest 5 needs ≥ 24.0. Laptop 24.21 satisfies both. |
| pnpm | 10.34.6 | Pinned by `packageManager`. 12.x exists; we stay on the installed 10.x. |
| Turborepo | 2.11.10 | |
| TypeScript | 6.0.3 | **Not 7.** typescript-eslint 8.72.1 supports only TypeScript below 6.1, and the Nest CLI wants `~6.0.2`. |
| ESLint / typescript-eslint / @eslint/js | 10.14.0 / 8.72.1 / 10.0.1 | Flat config in `packages/config`. |
| Prettier | 3.9.10 | |
| Vitest | 5.0.5 | |
| @types/node | 24.4.0 | |

## Backend (installed)

| Item | Version | Notes |
|---|---|---|
| NestJS (`common`, `core`, `platform-fastify`, `testing`) | 12.3.2 | **ESM-only**, so the whole workspace is ESM. Uses legacy parameter decorators, so `experimentalDecorators` is on and every injection uses an explicit `@Inject(token)`. |
| `@nestjs/schedule` | 12.0.2 | 1 s sweep interval. |
| Fastify | 5.12.7 | `@fastify/helmet` 13.2.0, `@fastify/cors` 11.3.1. |
| Drizzle ORM / drizzle-kit | 0.45.4 / 0.31.11 | Migrations are SQL files in `apps/api/drizzle`, applied by `drizzle-orm`'s migrator. |
| `postgres` (postgres.js) | 4.0.0 | Driver. **Must run with `prepare: false` and `max_pipeline: 1` on Supabase's transaction pooler.** See ARCHITECTURE. |
| Zod | 4.6.7 | |
| `@asteasolutions/zod-to-openapi` | 9.1.0 | Needs Zod 4. Generates OpenAPI 3.1 from the same schemas the API validates with. |
| reflect-metadata / rxjs | 0.2.2 / 7.8.2 | Nest peers. |

**Not used:** `nestjs-zod` 5.5.0 supports Nest 10 and 11 only. A small `ZodPipe` replaces it.

## Mobile and client (verified, not installed — 3.0b)

| Item | Version | Source of the check |
|---|---|---|
| Expo SDK | `expo` 58.0.21 | npm latest |
| React Native / React | 0.88.1 / 19.3.0 | `bundledNativeModules.json` of expo 58.0.21 |
| Expo Router | 58.0.28 | same file |
| expo-video / expo-font / expo-constants / expo-secure-store | 58.0.13 / 58.0.11 / 58.0.14 / 58.0.2 | same file |
| jest-expo | 58.0.13 | same file |
| react-native-screens / safe-area-context / gesture-handler / reanimated | 4.30.0 / 5.10.1 / 3.3.0 / 4.7.1 | same file; Expo Router's peers, approved as a group in 3.0b |
| TanStack Query / Zustand | 5.105.0 / 5.0.16 | npm latest |
| React Hook Form / `@hookform/resolvers` | 7.91.0 / 6.0.2 | resolvers 6.0.2 accepts Zod `^3.25 \|\| ^4` and RHF `^7.55` |

`expo install --fix` decides final patch versions in 3.0b; this table is then updated.

## Hosting (decided, see DECISIONS I-1 to I-3)

Supabase Postgres 17.11, two projects in Mumbai (`fayda-dev`, `fayda-test`). API on an Oracle Always Free VM in Hyderabad (Ubuntu 24.04, Caddy 2.11.7 for HTTPS, systemd). Nothing is deployed yet.
