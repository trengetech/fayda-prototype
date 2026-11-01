# infra

- `oracle-vm-setup.sh`: one-time setup of the API host (swap, firewall rules, Node 24, Caddy HTTPS, systemd unit). Already run on `140.245.219.163`. Safe to re-run.

## Deploy

`infra/deploy-api.sh` builds, uploads a timestamped release to `/opt/fayda-api/releases/`, switches the `current` symlink, restarts the service and checks `/v1/health`. If the new release is not healthy it switches back to the previous one and exits non-zero. It keeps the last 3 releases. Tested, including the rollback path.

One-time setup done by hand (not in the script, so secrets never travel through it):
- A template with every variable name (no values) is `api.env.example` in the repo root.
- `/etc/fayda/api.env` on the VM (owner root, group ubuntu, mode 640) holds `DATABASE_URL` (the dev transaction-pooler URL) and `APP_ENV=development` (the label `/v1/meta` reports). Edit it over SSH with `sudo`; never commit it.

Database migrations run from the laptop (`pnpm db:migrate`, which reads `apps/api/.env`) before deploying a schema change. The VM has no migration URL.

Useful commands (from the laptop):
- logs: `ssh -i ~/.ssh/fayda_oracle ubuntu@140.245.219.163 'sudo journalctl -u fayda-api -n 50 --no-pager'`
- restart: `... 'sudo systemctl restart fayda-api'`

## Release runbook (copy and paste, from the laptop)

Needs: Android Studio's SDK and JDK 17+ (APKs), the SSH key `~/.ssh/fayda_oracle` (API), and `~/personal/fayda-secrets/` (Firebase files for push, never in git). More background: `docs/SYSTEM_OVERVIEW.md` section 7.

### 1. Ship the API
1. If `apps/api/src/db/schema.ts` changed: `pnpm --filter @fayda/api db:generate`, then `pnpm db:migrate` first. It targets `fayda-dev`, which the deployed server also uses, so migrations must be additive.
2. `infra/deploy-api.sh`. It builds, uploads, switches the `current` release, restarts, checks `/v1/health`, and rolls back by itself if unhealthy.
3. Check: `curl https://fayda.140-245-219-163.sslip.io/v1/health` and `/v1/meta` (`apiLevel` and each provider's `simulated` flag).
4. Contract changes: raise `CONTRACT_LEVEL` when `CLAUDE.md` says so, and deploy the server before installing new APKs.

### 2. Build the phone APKs
Rebuild the **buyer** after any change in `apps/buyer` or in a shared package (`domain`, `contracts`, `api-client`, `ui`), the **seller** likewise. Check the file's date afterwards: Gradle can reuse an old bundle.
```
GOOGLE_SERVICES_JSON=$HOME/personal/fayda-secrets/google-services-buyer-dev.json ARCHS=arm64-v8a APK_SUFFIX=-phone infra/build-apk.sh buyer
GOOGLE_SERVICES_JSON=$HOME/personal/fayda-secrets/google-services-seller-dev.json ARCHS=arm64-v8a APK_SUFFIX=-phone infra/build-apk.sh seller
```
Result: `apks/fayda-<app>-dev-<version>-phone.apk` (about 33 MB buyer, 38 MB seller; 64-bit ARM phones only). The Android emulator on Apple Silicon is also arm64, so the same file installs there. Drop `ARCHS` and `APK_SUFFIX` for a universal build (about 55 and 67 MB). The API address is baked in at build time (default: the deployed server; pass another URL as the second argument). Each build took about 2 to 2.5 minutes on 1 Nov 2026. APKs are signed with the debug key: fine for testers, not for the Play Store.

### 3. Give the APKs to QE
The QE test-plan site (https://trengetech.github.io/fayda-qe-testplan/, repo `trengetech/fayda-qe-testplan`, public) serves the files in its `downloads/` folder, and its first test case links to them. Copy the two phone APKs there under the same names, commit, push to `main`; GitHub Pages updates in about a minute. This needs push access to that repo. The APKs are public once pushed: they talk to the dev server, use simulated sign-in, and carry only public client settings (the Firebase app file is a public client config), but treat the dev server's data as visible to anyone with the link.

### 4. Demo data and sign-in
The demo shops, listings, buyers and orders already exist on the dev server. Reset or re-seed only when asked: `node infra/seed/seed-demo.mjs https://fayda.140-245-219-163.sslip.io --yes` and `cd apps/api && node --env-file=.env ../../infra/seed/unseed-demo.mjs --delete`. Sign-in code for every number is `123456`. People and numbers: `docs/DEMO_SCRIPT.md`.

**After any re-seed, run the media refresh.** `seed-demo.mjs` makes plain gradient pictures and no videos. The illustrated pictures and the 60-second reels come from a second step, which changes only the demo listings' media (orders, offers, likes and comments stay):
```
node infra/seed/refresh-demo-media.mjs https://fayda.140-245-219-163.sslip.io --yes
```
It needs `rsvg-convert` (`brew install librsvg`) and `swiftc` (Xcode command line tools) on a Mac. Add `--force` to redo listings that already have the new media. The pictures and reels are illustrations, not photographs.
