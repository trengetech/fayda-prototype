#!/usr/bin/env bash
# One-time setup for the Fayda API host (Ubuntu 24.04, Oracle Always Free E2.1.Micro).
# Run on the VM as the `ubuntu` user. Safe to re-run.
set -euo pipefail

HOST="fayda.140-245-219-163.sslip.io"
NODE_MAJOR=24
API_PORT=3000
APP_DIR=/opt/fayda-api
ENV_DIR=/etc/fayda

export DEBIAN_FRONTEND=noninteractive

echo "== 1. Swap (2 GB): the VM has under 1 GB of RAM"
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi
echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-fayda-swap.conf >/dev/null
sudo sysctl -q --system

echo "== 2. Base packages and automatic security updates"
sudo apt-get update -q
sudo apt-get install -y -q ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https \
  unattended-upgrades iptables-persistent
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

echo "== 3. Firewall: allow 80 and 443 (22 is already open); Oracle's image blocks the rest with iptables"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null \
    || sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
sudo netfilter-persistent save

echo "== 4. Node.js ${NODE_MAJOR} (NodeSource apt repo, signed key)"
sudo install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | sudo gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
  | sudo tee /etc/apt/sources.list.d/nodesource.list >/dev/null
sudo apt-get update -q
sudo apt-get install -y -q nodejs
sudo corepack enable

echo "== 5. Caddy (official apt repo): automatic HTTPS and reverse proxy"
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
  | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
sudo apt-get update -q
sudo apt-get install -y -q caddy
sudo tee /etc/caddy/Caddyfile >/dev/null <<EOF
${HOST} {
	reverse_proxy 127.0.0.1:${API_PORT}
}
EOF
sudo systemctl enable caddy
sudo systemctl reload caddy || sudo systemctl restart caddy

echo "== 6. App directory, secrets directory and systemd unit (not started: no code deployed yet)"
sudo install -d -o ubuntu -g ubuntu -m 0755 "${APP_DIR}"
sudo install -d -o root -g ubuntu -m 0750 "${ENV_DIR}"
sudo tee /etc/systemd/system/fayda-api.service >/dev/null <<EOF
[Unit]
Description=Fayda API
After=network-online.target
Wants=network-online.target

[Service]
User=ubuntu
WorkingDirectory=${APP_DIR}/current
EnvironmentFile=${ENV_DIR}/api.env
Environment=NODE_ENV=production
Environment=PORT=${API_PORT}
Environment=NODE_OPTIONS=--max-old-space-size=384
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable fayda-api

echo "== Done"
node --version
caddy version
free -m | head -3
