# infra

- `oracle-vm-setup.sh`: one-time setup of the API host (swap, firewall rules, Node 24, Caddy HTTPS, systemd unit). Already run on `140.245.219.163`. Safe to re-run.

## Deploy (not yet done; needs approval each time)

1. On the laptop: `pnpm build`.
2. Copy `apps/api/dist`, `apps/api/drizzle`, `apps/api/package.json` and the built `packages/*/dist` to `/opt/fayda-api/current` on the VM, and install production dependencies there.
3. Put the production env values in `/etc/fayda/api.env` (root:ubuntu, 0750 directory). Never commit them.
4. Run migrations with the session-pooler URL, then `sudo systemctl start fayda-api`.
5. Check `https://fayda.140-245-219-163.sslip.io/v1/health`.
