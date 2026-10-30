#!/usr/bin/env bash
# Deploys the API to the Oracle VM from the laptop. Usage: infra/deploy-api.sh
#
# Builds, uploads a new release directory, switches the `current` symlink, restarts the service and checks
# /v1/health. If the new release is not healthy it switches back to the previous one and exits non-zero.
# Secrets are NOT handled here: /etc/fayda/api.env on the VM is set up once by hand.
# Database migrations are run separately from the laptop (`pnpm db:migrate`) before deploying a schema change.
set -euo pipefail

HOST="${FAYDA_HOST:-ubuntu@140.245.219.163}"
KEY="${FAYDA_SSH_KEY:-$HOME/.ssh/fayda_oracle}"
URL="${FAYDA_URL:-https://fayda.140-245-219-163.sslip.io}"
APP=/opt/fayda-api
KEEP=3

SSHO=(-i "$KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
remote() { ssh -n "${SSHO[@]}" "$HOST" "$@"; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REL="$(date -u +%Y%m%d%H%M%S)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$ROOT"
echo "== build"
pnpm --filter @fayda/domain --filter @fayda/contracts --filter @fayda/api build >/dev/null
# --legacy: pnpm 10 otherwise requires inject-workspace-packages. Runtime dependencies are pure JavaScript, so a
# bundle built on macOS runs on the VM.
pnpm --filter @fayda/api deploy --prod --legacy "$WORK/release" >/dev/null

echo "== upload release $REL"
remote "mkdir -p $APP/releases/$REL"
rsync -az -e "ssh ${SSHO[*]}" "$WORK/release/dist" "$WORK/release/drizzle" "$WORK/release/package.json" "$WORK/release/node_modules" "$HOST:$APP/releases/$REL/"

echo "== switch and restart"
PREVIOUS="$(remote "readlink $APP/current || true")"
remote "ln -sfn $APP/releases/$REL $APP/current && sudo systemctl restart fayda-api"

echo "== health check"
for _ in $(seq 1 30); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "$URL/v1/health" || true)"
  if [ "$code" = "200" ]; then
    echo "healthy: $URL/v1/health -> 200"
    remote "ls -1dt $APP/releases/* | tail -n +$((KEEP + 1)) | xargs -r rm -rf"
    exit 0
  fi
  sleep 2
done

echo "NOT healthy (last status: ${code:-none}). Rolling back to ${PREVIOUS:-nothing}." >&2
if [ -n "$PREVIOUS" ]; then
  remote "ln -sfn $PREVIOUS $APP/current && sudo systemctl restart fayda-api"
fi
remote "sudo journalctl -u fayda-api -n 20 --no-pager -o cat" >&2 || true
exit 1
