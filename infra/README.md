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
