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

| `socket.io` / `@nestjs/websockets` / `@nestjs/platform-socket.io` | 4.8.4 / 12.3.2 / 12.3.2 | Real-time negotiation updates (M3.3). Nest packages match the other Nest 12.3.2 packages; peers checked on 31 Oct 2026. |
| `socket.io-client` | 4.8.4 | In `packages/api-client` (both apps use it through the client) and in API tests. WebSocket transport only. |

**Not used:** `nestjs-zod` 5.5.0 supports Nest 10 and 11 only. A small `ZodPipe` replaces it.

## Mobile and client (verified, not installed — 3.0b)

| Item | Version | Source of the check |
|---|---|---|
| Expo SDK | `expo` 58.0.21 | npm latest |
| React Native / React | 0.88.1 / 19.3.0 | `bundledNativeModules.json` of expo 58.0.21 |
| Expo Router | 58.0.28 | same file |
| expo-video / expo-font / expo-constants / expo-secure-store | 58.0.13 / 58.0.11 / 58.0.14 / 58.0.2 | same file |
| jest-expo / jest | 58.0.13 / 30.5.2 | installed in both apps (3.0b) |
| `@testing-library/react-native` / `test-renderer` | 14.1.0 / 1.3.0 | **Outside the original stack table; approved by the founder 31 Oct 2026** ("add the automated screentests"). v14 renders with `test-renderer`, not `react-test-renderer`, and `render` is async. Also installed as jest-expo peers: `@react-native/jest-preset` 0.88.1, `react-server-dom-webpack` 19.3.0 |
| react-native-screens / safe-area-context / gesture-handler / reanimated | 4.30.0 / 5.10.1 / 3.3.0 / 4.7.1 | same file; Expo Router's peers, approved as a group in 3.0b |
| `jose` / `@fastify/rate-limit` | 6.2.14 / 11.2.1 | API sign-in tokens (HS256) and request limits. **Outside the original stack; approved by the founder 31 Oct 2026.** `@fastify/rate-limit` 11 supports Fastify 5 |
| `expo-image-picker` / `expo-file-system` (buyer app) | 58.0.10 / 58.0.13 | **M3.4, approved D18 and I-14.** Buyer app: review, request and chat photos. Same versions as the seller app. |
| expo-camera / expo-image-picker / expo-file-system / expo-video-thumbnails | 58.0.14 / 58.0.10 / 58.0.13 / 58.0.2 | **M3.2, approved I-12, D18, I-14.** Installed in the seller app with `expo install`. `expo-camera` is used only to decode a UPI QR from a picked image (`Camera.scanFromURLAsync`, checked on the emulator, needs no camera permission, and the CAMERA and RECORD_AUDIO permissions are removed from the manifest). `uploadAsync` is imported from `expo-file-system/legacy` in SDK 58. |
| expo-video (buyer app) / `@fayda/domain` (buyer app) | 58.0.13 / workspace | **M3.2.** `expo-video` was already approved (stack table); installed in the buyer app with `expo install` and added as a config plugin. The product page mounts one player, only after the buyer taps Play. `@fayda/domain` gives the buyer app `formatRupees`. |
| `@fayda/domain` in the seller app | workspace | The phone runs the same pure rules as the server (UPI QR payee check, upload limits, money formatting). No new third-party code. |
| `expo-secure-store` | 58.0.2 | Keeps the refresh token in the Android Keystore (the SDK's bundled version) |
| TanStack Query / Zustand | 5.105.0 / 5.0.16 | npm latest |
| React Hook Form / `@hookform/resolvers` | 7.91.0 / 6.0.2 | resolvers 6.0.2 accepts Zod `^3.25 \|\| ^4` and RHF `^7.55` |

`expo install --fix` decides final patch versions in 3.0b; this table is then updated.

## Hosting (decided, see DECISIONS I-1 to I-3)

Supabase Postgres 17.11, two projects in Mumbai (`fayda-dev`, `fayda-test`). API on an Oracle Always Free VM in Hyderabad (Ubuntu 24.04, Caddy 2.11.7 for HTTPS, systemd). Nothing is deployed yet.
