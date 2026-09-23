#!/usr/bin/env bash
# NetCam installer for the gateway box.
#
# What this does:
#   1. Installs system prerequisites (Docker, Node.js/pnpm, nftables,
#      dnsmasq, iproute2, tcpdump) via apt — Debian/Ubuntu only.
#   2. Creates .env files from .env.example (generating random secrets) if
#      they don't already exist — it never overwrites an existing .env.
#   3. Installs workspace dependencies and builds the portal + network-agent.
#   4. Starts the API + Postgres + admin dashboard via Docker Compose.
#   5. Installs and enables the network-agent as a systemd service running
#      directly on the host (it needs real NIC/root access — see
#      docs/ARCHITECTURE.md).
#
# This modifies system packages, systemd units, and firewall rules. Read it
# before running it. Re-run anytime after `git pull` to apply updates —
# steps are idempotent.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

log() { echo -e "\033[1;32m==>\033[0m $1"; }
warn() { echo -e "\033[1;33m!!\033[0m $1"; }

if [ "$(id -u)" -ne 0 ]; then
  echo "This script installs system packages and a systemd service — please run it with sudo." >&2
  exit 1
fi

if ! command -v apt-get >/dev/null 2>&1; then
  warn "This installer only automates Debian/Ubuntu (apt) setups."
  warn "On another distro, install the equivalent of: docker, nodejs>=20, nftables, dnsmasq, iproute2, tcpdump — then re-run this script, which will skip package installation and continue from there."
fi

random_secret() { head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 40; }

### 1. System prerequisites ###################################################
if command -v apt-get >/dev/null 2>&1; then
  log "Installing system prerequisites (apt)…"
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg nftables dnsmasq iproute2 tcpdump

  if ! command -v docker >/dev/null 2>&1; then
    log "Installing Docker…"
    curl -fsSL https://get.docker.com | sh
  fi

  if ! command -v node >/dev/null 2>&1; then
    log "Installing Node.js 22…"
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y nodejs
  fi

  corepack enable || true
  corepack prepare pnpm@10 --activate || npm install -g pnpm

  # dnsmasq's own default config can conflict with per-router configs we
  # drop in /etc/dnsmasq.d — the systemd unit is what network-agent restarts.
  systemctl disable --now dnsmasq 2>/dev/null || true
  systemctl enable dnsmasq

  # 802.1Q VLAN sub-interfaces and IP forwarding.
  modprobe 8021q || true
  echo "8021q" > /etc/modules-load.d/netcam-8021q.conf
  sysctl -w net.ipv4.ip_forward=1
  echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-netcam.conf
fi

### 2. .env files ##############################################################
log "Setting up environment files…"

if [ ! -f apps/api/.env ]; then
  cp apps/api/.env.example apps/api/.env
  SHARED_SECRET="$(random_secret)"
  sed -i "s#^JWT_SECRET=.*#JWT_SECRET=$(random_secret)#" apps/api/.env
  sed -i "s#^NETWORK_AGENT_SHARED_SECRET=.*#NETWORK_AGENT_SHARED_SECRET=${SHARED_SECRET}#" apps/api/.env
  warn "Created apps/api/.env — edit it to add your Ssentezo and EGO SMS credentials before going live."
else
  SHARED_SECRET="$(grep '^NETWORK_AGENT_SHARED_SECRET=' apps/api/.env | cut -d= -f2-)"
fi

if [ ! -f docker/.env ]; then
  cp docker/.env.example docker/.env
  sed -i "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$(random_secret)#" docker/.env
fi

if [ ! -f apps/network-agent/.env ]; then
  cp apps/network-agent/.env.example apps/network-agent/.env
  sed -i "s#^NETWORK_AGENT_SHARED_SECRET=.*#NETWORK_AGENT_SHARED_SECRET=${SHARED_SECRET}#" apps/network-agent/.env
  warn "Created apps/network-agent/.env — set WAN_INTERFACE and ROUTER_VLANS for your hardware (see docs/ARCHITECTURE.md §1.1). Routers must exist in the admin dashboard first to get their IDs."
fi

### 3. Build workspace apps ####################################################
log "Installing dependencies…"
pnpm install --frozen-lockfile

log "Building portal and network-agent…"
pnpm --filter @netcam/portal build
pnpm --filter @netcam/network-agent build

### 4. Start API + Postgres + admin dashboard via Docker #####################
log "Starting API, Postgres, and admin dashboard (Docker Compose)…"
docker compose -f docker/docker-compose.yml up -d --build

### 5. Install network-agent as a systemd service #############################
log "Installing network-agent systemd service…"
sed "s#__REPO_ROOT__#${REPO_ROOT}#g" scripts/netcam-network-agent.service.template \
  > /etc/systemd/system/netcam-network-agent.service
systemctl daemon-reload
systemctl enable --now netcam-network-agent

log "Done."
echo ""
echo "Next steps:"
echo "  1. Admin dashboard: http://<this-box-ip>:8081 (default login is seeded — see apps/api/prisma/seed.ts, change the password immediately)"
echo "  2. Edit apps/api/.env with your Ssentezo and EGO SMS credentials, then: docker compose -f docker/docker-compose.yml up -d --build"
echo "  3. Add your routers in the dashboard, note their IDs, then set ROUTER_VLANS in apps/network-agent/.env and: systemctl restart netcam-network-agent"
echo "  4. Edit packages/pricing from the dashboard's Packages page."
