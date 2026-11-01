# Fayda: architecture, hosts and deployment

*Written 1 Nov 2026. This is the "where is everything and how does it fit" document. `ARCHITECTURE.md` goes deeper on the API and domain internals; `DECISIONS.md` is the source of truth for product and infrastructure decisions; `PROGRESS.md` says what is built and tested. **No secret values are in this file or anywhere in the repo**: only their names and where they live.*

## 1. The system in one picture

```
 Buyer app (Expo, Android)        Seller app (Expo, Android)
 com.fayda.buyer.dev              com.fayda.seller.dev
        |   REST (HTTPS) + Socket.IO (wss)   |
        +-------------------+----------------+
                            v
        https://fayda.140-245-219-163.sslip.io      (Caddy: HTTPS, reverse proxy)
                            v
        API: NestJS on Fastify  (systemd service "fayda-api", port 3000, Node 24)
          - REST /v1/{buyer,seller}/*  + public reads        - Socket.IO rooms per person per app
          - 1-second sweep (offers, auto-counter, expiry, notifications + push)
          - local-disk media on the VM
              |                     |                          |
              v                     v                          v
   Supabase Postgres 17       /var/lib/fayda/uploads     Expo push service ---> Google FCM ---> phone
   (project fayda-dev)        (photos, videos, QR)       (exp.host)
```

Fayda **never handles payments or delivery**. Buyers pay sellers directly (UPI, bank transfer, payment link) and sellers ship themselves. Only the seller moves an order forward.

## 2. Hosts and accounts

| What | Where | Details |
|---|---|---|
| API server | Oracle Cloud Always Free VM, Hyderabad, `140.245.219.163` | Ubuntu 24.04, E2.1.Micro (under 1 GB RAM, 2 GB swap), Node 24, Caddy 2.x, systemd unit `fayda-api`. Login: `ssh -i ~/.ssh/fayda_oracle ubuntu@140.245.219.163`. |
| API address | `https://fayda.140-245-219-163.sslip.io` | No real domain yet (sslip.io name, certificate by Caddy). Ports 80 and 443 open in the VM's iptables; 22 for SSH. |
| Database (running API) | Supabase project **`fayda-dev`**, Mumbai | Postgres 17. The API uses the **transaction pooler (6543)** with `prepare: false` and no pipelining. |
| Database (migrations) | same project, **session pooler (5432)** | Used by `pnpm db:migrate` from the laptop. The VM has no migration URL. |
| Database (tests) | Supabase project **`fayda-test`**, Mumbai | Used by API tests on the laptop; the tests refuse to run if `.env.test` points at the same project as `.env`. CI uses a throwaway Postgres 17 container instead. |
| Source and CI | GitHub `trengetech/fayda-prototype` (private) | Default branch `dev`, release line `main`. One branch per milestone, PR into `dev`, merge by the founder. GitHub Actions workflow `CI` (typecheck, lint, test) runs on every PR. |
| Expo (EAS) | account `trengetech` | Projects `@trengetech/fayda-buyer` (88bbc327-72fb-4de0-a4e6-52f73fc1233a) and `@trengetech/fayda-seller` (1341685c-b1c4-4c90-8269-eb170e423622). Hold the FCM key used to send push. No EAS cloud builds yet; APKs are built on the laptop. |
| Firebase | project **`trenge-fayda`** | Two Android apps: `com.fayda.buyer.dev`, `com.fayda.seller.dev`. Provides FCM, which Expo's push service uses. |
| Phone push path | API -> Expo push service (`exp.host`) -> FCM -> phone | iOS would use Apple's APNs through the same Expo path (not set up). |

## 3. Environments

| Environment | API | Database | Push | Status |
|---|---|---|---|---|
| **Local (laptop)** | `node dist/main.js` on `127.0.0.1:3000` (emulator reaches it at `10.0.2.2:3000` or via `adb reverse tcp:3000 tcp:3000`) | `fayda-dev` | `PUSH_PROVIDER=expo` for tests, otherwise `off` | Used for all emulator testing. |
| **Deployed "dev"** | the Oracle VM above, `APP_ENV=development` | `fayda-dev` (shared with local) | `expo` (set 1 Nov 2026; `/v1/meta` shows push as not simulated) | Running release `20261101072946` = `dev` at merge of PR #14 (M3.7 plus push setup). Migrations 0009 and 0010 are applied to `fayda-dev`. |
| Staging / production | not created | not created | | App variants (`dev`, `staging`, `prod`) exist in `app.config.ts`; their package ids, Firebase apps and servers do not. |

Because local and deployed share one database, people created while testing locally also exist on the deployed server. It is development data, not customer data.

## 4. Repository layout

```
apps/api            NestJS 12 + Fastify + Drizzle + Socket.IO (modular monolith)
apps/buyer          Expo app (Android first; iOS later from the same code)
apps/seller         Expo app
packages/domain     pure TypeScript business rules (no I/O); ported from prototype/src/engine.js
packages/contracts  Zod schemas, error codes, OpenAPI generation (the contract between apps and API)
packages/api-client typed client, TanStack Query hooks, session, Socket.IO client
packages/ui         design tokens, components, report/block sheet, fonts (Plus Jakarta Sans, bundled)
packages/config     tsconfig and ESLint base
infra/              VM setup, API deploy, APK build scripts
docs/               DECISIONS, PROGRESS, TECH_STACK, ARCHITECTURE, this file
prototype/          the original single-page prototype (UX and behaviour reference)
```

pnpm workspaces plus Turborepo; TypeScript strict. Exact library versions are in `TECH_STACK.md`.

## 5. How the pieces behave

- **Identity.** One phone number is one user across both apps. Sign-in is a **simulated OTP** (`123456`, no SMS) behind an `AuthVerifier` interface; the apps show a "Prototype" banner and `/v1/meta` reports it as simulated. Access tokens are short JWTs (15 min), refresh tokens last 90 days, sessions are stored and revocable.
- **Audience-scoped API.** `/v1/buyer/*`, `/v1/seller/*` and public reads. A token is for one app; using it on the other app's routes is refused. Buyer responses are built from buyer schemas only, so private seller rules (auto-accept, decline, counter) never reach a buyer.
- **State.** All state lives in Postgres. Clients keep only session and UI state; server state is fetched and cached with TanStack Query. Mutating endpoints take idempotency keys; negotiations and stock use row locks inside one transaction.
- **Real time.** Socket.IO, one room per person per app. Events carry **ids only**; the app refetches through the normal API, so the socket can never show something HTTP would not.
- **Sweep.** One in-process task runner ticks every second (row claims use `FOR UPDATE SKIP LOCKED`): offer expiry (24 h), the 5-second automatic counter, 2-minute auto-decline, 12-hour agreement lapse, 48-hour order expiry, request expiry, and **notification delivery** (live event plus push). No Redis or external job system.
- **Notifications.** Services write a row per notice; the sweep tells open apps (`notification.created`) and sends push once per notification; the server writes the text per app. Push is at most once, retried for 2 minutes after a temporary failure. A phone's token is removed on sign-out or when Expo says the phone is gone.
- **Media.** An upload-intent contract (ask, upload, complete). Today a **local-disk adapter** writes to `/var/lib/fayda/uploads` on the VM (outside the release folders). Planned: Cloudflare R2 (images) and Stream (video). Chat photos are private to the two people in the chat.
- **Safety.** Report (comments, chat messages and photos) and block, by person across both apps. Reports go to the `reports` table (status OPEN); there is no review screen yet.
- **Limits and protection.** Helmet, per-address rate limits (auth routes 20 a minute, others 20 times that), CORS closed unless `CORS_ORIGINS` is set, Zod validation on every body, problem+json errors with stable codes.

## 6. Configuration and secrets (names and homes only)

| Name | Home | Purpose |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_DIRECT`, `JWT_SECRET` | `apps/api/.env` (laptop); `/etc/fayda/api.env` (VM, owner root, group ubuntu, mode 640) | Database and token signing. `DATABASE_URL_DIRECT` exists only on the laptop. |
| `APP_ENV`, `UPLOADS_DIR` | same files | Label shown by `/v1/meta`; media folder. |
| `PUSH_PROVIDER` (`off` or `expo`), `EXPO_ACCESS_TOKEN` (optional) | same files | Push switch; token only if Expo's enhanced push security is enabled. |
| Other optional settings | `apps/api/.env.example` | `PORT`, `HOST`, `CORS_ORIGINS`, `SWEEP_ENABLED`, token lifetimes, rate limit. |
| `apps/api/.env.test` | laptop only | Test database (`fayda-test`). |
| `EXPO_PUBLIC_API_URL` | build time, baked into the app | Which API the app talks to. Default is the emulator address; the build script defaults to the deployed address. |
| `GOOGLE_SERVICES_JSON` | build time, path to the app's Firebase file | `~/fayda-secrets/google-services-{buyer,seller}-dev.json` on the founder's laptop (outside git, mode 600). |
| Firebase service-account key | uploaded to both Expo projects; **a copy still sits in the founder's OneDrive Downloads and should be moved or deleted** | Lets Expo send push through FCM. Can be regenerated. |
| SSH key `~/.ssh/fayda_oracle` | laptop | Access to the VM. |

`.gitignore` blocks `.env*`, `google-services*.json` and `*adminsdk*.json`. If a secret is ever committed, rotate it.

## 7. How to build, test and deploy

**Checks (laptop):** `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`. API tests need `apps/api/.env.test` and are slow against the remote test database (about 6 to 15 seconds a test); run only the files you changed. CI runs everything on every PR.

**Database change:** edit `apps/api/src/db/schema.ts`, `pnpm exec drizzle-kit generate` (in `apps/api`), then `pnpm db:migrate` **from the laptop before deploying** (it targets `fayda-dev`, which the deployed server also uses). Migrations are additive so the previous release keeps working while you deploy.

**Deploy the API:** `infra/deploy-api.sh` from the laptop. It builds, uploads a timestamped release to `/opt/fayda-api/releases/`, moves the `current` symlink, restarts `fayda-api`, checks `/v1/health` and **rolls back automatically** if it is not healthy. Keeps the last 3 releases. To change settings, edit `/etc/fayda/api.env` over SSH with `sudo` and restart: `sudo systemctl restart fayda-api`.

**Useful commands:**
- logs: `ssh -i ~/.ssh/fayda_oracle ubuntu@140.245.219.163 'sudo journalctl -u fayda-api -n 50 --no-pager'`
- health: `curl https://fayda.140-245-219-163.sslip.io/v1/health` and `/v1/meta` (shows each provider and whether it is simulated)
- first-time VM setup (already done, safe to re-run): `infra/oracle-vm-setup.sh`

**Build an APK (laptop, needs Android Studio's SDK and JDK 17+):** `infra/build-apk.sh buyer|seller [api-url]`. For push, also set `GOOGLE_SERVICES_JSON` to that app's file and run `npx expo prebuild --platform android --no-install` first. The release APK is signed with the debug key (fine for your own phones, **not for the Play Store**). Package ids are placeholders until the brand is final and cannot change after a Play release.
**Gotcha:** Gradle does not rebuild the JavaScript when only a shared package changed or an environment variable changed. Force it with `./gradlew :app:createBundleReleaseJsAndAssets --rerun` before `assembleRelease` (the build script uses `--rerun-tasks`). Check the APK's file date.

**Emulator testing:** the emulator reaches the laptop API at `10.0.2.2:3000`; `adb reverse tcp:3000 tcp:3000` also works. The emulator disk fills easily; a physical phone is the better test for push, video and performance.

## 8. State of things on 1 Nov 2026 (read this before relying on it)

- **The deployed server is current** (release `20261101072946`, dev at PR #14) and has `PUSH_PROVIDER=expo`. Deployed with `infra/deploy-api.sh` (health check passed); the setting was appended to `/etc/fayda/api.env` and the service restarted. It was verified through `/v1/health` (200) and `/v1/meta`.
- Push is proven end to end only on the **Android emulator with the API running on the laptop** (both apps, app backgrounded and process killed, tap opens the right screen, sign-out stops it). **Not yet proven through the deployed server** (that needs APKs built with `EXPO_PUBLIC_API_URL` set to the deployed address, which `infra/build-apk.sh` does by default) **and not on a physical phone.**
- **iOS is not built or tested** (decision I-32: later; keep every library cross-platform).
- **No admin console** (DECISIONS L1): reports can only be read in the database.
- A deploy needs a Bash permission rule for `infra/deploy-api.sh` in Claude Code; the founder added it on 1 Nov 2026.

## 9. Known risks and gaps

- **One small VM, one process.** No redundancy; the in-process sweep assumes a single instance (the claims are safe for two, but nothing is set up for it).
- **Free tiers can be reclaimed or paused** (Supabase idle pause, Oracle idle reclaim): a keep-alive is proposed, not built (I-8).
- **Uploads live on the VM's disk with no backup.** A lost VM loses photos and videos. R2/Stream or at least a backup job is needed before real users.
- **Database backups** rely on Supabase's plan; no restore has been tested.
- **No monitoring or alerting**; logs are in journald only.
- **Dev OTP and debug-signed APKs** are prototype-only. Real SMS auth (Supabase Auth behind `AuthVerifier`), a real domain, store signing and a privacy policy are needed before a public launch, along with the admin console for reports.
- Shared dev database between laptop and deployed server: do not point real users at it.

## 10. Where to find what

| Question | File |
|---|---|
| What did the founder decide, and what is only proposed? | `DECISIONS.md` |
| What is built, tested, checked on a device, and not done? | `PROGRESS.md` |
| Exact library versions | `TECH_STACK.md` |
| API and domain internals, the pooler finding, sweep design | `ARCHITECTURE.md` |
| Original plan and rules R1 to R17 | `FAYDA_PROJECT_FOUNDATION.md` |
| Deploy and VM scripts | `infra/` |

## 11. Secrets: how each is created and set (and the go-live procedure)

**Rules for every secret:** created by a random generator, never typed by hand; created and kept only on the machine that needs it (or in the provider's dashboard); never committed, never pasted into chat, tickets or email; a **different value per environment** (laptop, test, staging, production); a recovery copy only in a password manager. If one is ever exposed, replace it and restart.

| Secret | What it is | How it is created | Where it is set | If it changes or leaks |
|---|---|---|---|---|
| **`JWT_SECRET`** | The one password the API uses to sign and check sign-in tokens (access tokens last 15 minutes). The apps never hold it. Minimum 32 characters; the API refuses to start with less. | Random, 48 bytes: `openssl rand -base64 48` (about 64 characters). Or `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`. | One line, `JWT_SECRET=...`, in `/etc/fayda/api.env` on the server (`apps/api/.env` on the laptop, `apps/api/.env.test` for tests). Restart `fayda-api` after changing it. | **Leak:** anyone who has it can forge a token for any user, including a seller: replace at once. **Change:** every signed-in person is signed out and signs in again; accounts and data are not affected. There is no overlap period (only one secret is read), so rotation is a global sign-out. |
| `DATABASE_URL` | Connection string the running API uses (Supabase transaction pooler, port 6543). Contains the database password. | The password is set in the Supabase dashboard (project settings, database). Copy the pooler connection string from there. | `/etc/fayda/api.env` (server), `apps/api/.env` (laptop). | Resetting the database password in Supabase breaks every service using the old string until each file is updated and the service restarted. |
| `DATABASE_URL_DIRECT` | Session pooler (port 5432), for migrations. | Same Supabase page. | **Laptop only** (`apps/api/.env`); never on the server. | Same as above. |
| `EXPO_ACCESS_TOKEN` (optional) | Only if the Expo project requires an access token to send push. | expo.dev, account settings, access tokens. | `/etc/fayda/api.env`. | Revoke at expo.dev and create a new one. |
| Firebase `google-services.json` (per app) | Identifies the app to Firebase. Not very sensitive, but not for git. | Firebase console, project settings, the Android app, download. | Laptop, `~/fayda-secrets/`; passed at build time with `GOOGLE_SERVICES_JSON`. | Re-download; rebuild the app. |
| Firebase service-account key | Lets Expo send push through Google's FCM. Sensitive. | Firebase console, project settings, service accounts, generate new private key. | Uploaded to each Expo project with `eas credentials`; **do not keep a copy in a synced folder**. | Generate a new key, upload it to both Expo projects, delete the old key in Firebase. |
| SSH key `fayda_oracle` | Access to the server. | `ssh-keygen`; the public half is on the VM. | Laptop `~/.ssh/`. | Remove the public key from the VM, create a new pair. |

### How `JWT_SECRET` was set today (honest record)
The development values (laptop, test, and the dev server) were created in an earlier session and **the method was not written down**. From their shape (about 62 characters of base64-style random text) they look machine-generated, and the laptop, test and server values differ from each other. Treat all three as **development-only**: do not reuse any of them for production.

### Go-live procedure for the production `JWT_SECRET`
1. Create the production server and its `/etc/fayda` folder (`infra/oracle-vm-setup.sh` does the folder; the file is made by hand).
2. Create the file with the right permissions (owner root, group ubuntu, mode 640) from the template `api.env.example`:
   `sudo install -m 640 -o root -g ubuntu /dev/null /etc/fayda/api.env`
3. **Generate the secret on the production server itself**, so it never exists on a laptop or in a chat, and append it in one step:
   `echo "JWT_SECRET=$(openssl rand -base64 48 | tr -d '\n')" | sudo tee -a /etc/fayda/api.env >/dev/null`
4. Add the other lines from `api.env.example` (`DATABASE_URL` for the **production** database, `APP_ENV=production`, `UPLOADS_DIR`, `PUSH_PROVIDER=expo`) with `sudo nano /etc/fayda/api.env`.
5. Check without printing it: `sudo awk -F= '/^JWT_SECRET=/{print length(substr($0,12))}' /etc/fayda/api.env` should print about 64 (never below 32).
6. Start the service and check `/v1/health` and `/v1/meta` (`environment` should say `production`).
7. Recovery: decide now, before launch, whether to keep a copy in the password manager (then losing the server does not sign everyone out) or accept that losing the server means a new secret and everyone signs in again. Write the decision in `DECISIONS.md`.
8. Never copy the development `JWT_SECRET` to production, and do not log or echo it in any script or CI job.

**Also before going live (secrets-related):** replace the dev OTP with real SMS sign-in (the signing secret protects tokens, not the sign-in step), move the Firebase service-account key out of the OneDrive Downloads folder, and use a Play Store signing key (the current APKs are debug-signed).

