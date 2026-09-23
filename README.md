# NetCam

Self-hosted WiFi hotspot billing, voucher generation, and captive-portal
platform. Runs entirely on one Linux PC that you own — your database, your
web app, your rules. Sell timed/data-capped WiFi packages, take Mobile Money
payments via Ssentezo, deliver vouchers by SMS via EGO SMS, and manage a
chain of downstream routers from one admin dashboard.

Read **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** first — it explains the
network topology this system assumes (VLAN-segmented router chaining) and
why, which matters before you wire up hardware.

## What you need

- A Linux PC/laptop (the "gateway box") with:
  - One WiFi adapter to receive internet (client mode).
  - One or more Ethernet ports/USB-Ethernet adapters to distribute it —
    one per downstream router in the chain, plus a VLAN-capable switch or
    VLAN-aware routers if you want the dashboard to attribute users to a
    specific router (otherwise everything shows as one flat network).
  - Docker, Node.js 22+, pnpm, nftables, dnsmasq, tcpdump (the installer
    handles this on Debian/Ubuntu).
- A [Ssentezo Wallet](https://wallet.ssentezo.com/documentation) account for
  mobile-money collection.
- An [EGO SMS / Pahappa](https://developers.pahappa.com/) account for
  voucher delivery by SMS.

## Quickstart

```bash
git clone <this-repo-url> netcam
cd netcam
sudo ./scripts/install.sh
```

This installs prerequisites, generates `.env` files with random secrets,
builds everything, starts Postgres + the API + the admin dashboard in
Docker, and installs `network-agent` (the firewall/DHCP controller) as a
systemd service running directly on the host.

Then:

1. Open the admin dashboard at `http://<box-ip>:8081` and log in with the
   seeded admin (`apps/api/prisma/seed.ts` — **change the password
   immediately**).
2. Add your Ssentezo and EGO SMS credentials to `apps/api/.env`, then
   `docker compose -f docker/docker-compose.yml up -d --build`.
3. Add your routers in the dashboard (Routers page), note their IDs, then
   set `ROUTER_VLANS` in `apps/network-agent/.env` (format:
   `parentIface:vlanId:routerId`, comma-separated) and
   `systemctl restart netcam-network-agent`.
4. Edit packages/pricing on the Packages page.
5. Pick your active output channel (which physical port is live) on the
   Output Channels page.

## Repo layout

```
apps/
  api/            NestJS backend — auth, billing, vouchers, payments, SMS
  web/             React admin dashboard
  portal/          Captive-portal page shown to WiFi clients (tiny bundle)
  network-agent/   Host-side controller: nftables, VLANs, dnsmasq, tc shaping
packages/shared/   Shared TS types/DTOs
docker/            docker-compose.yml for api + postgres + web
scripts/           install.sh, systemd unit template
docs/              Architecture and integration notes
```

## Updating

```bash
git pull
sudo ./scripts/install.sh   # idempotent — safe to re-run
```

## Customizing for your business

- **Pricing/packages**: dashboard → Packages. No code changes needed.
- **Portal branding**: dashboard → Settings, or edit `apps/portal/index.html`
  directly for a full redesign (it's deliberately a plain HTML/CSS/TS page,
  no build-tool lock-in) and `pnpm --filter @netcam/portal build`.
- **SMS wording**: `apps/api/src/payments/payments.service.ts` and
  `apps/api/src/portal/portal.service.ts`.
- **Anti-resharing sensitivity**: `RESHARE_SUSPICION_THRESHOLD` in
  `apps/api/src/sessions/sessions.service.ts`.

## Known limitations (by design, documented rather than hidden)

- Per-router user attribution requires VLAN-capable routers/switches (see
  ARCHITECTURE.md §1.1) — plain dumb NAT routers chained together can't be
  told apart on the network layer.
- The TTL-based re-share detector is a heuristic (flags for admin review,
  doesn't auto-kill a voucher) — it can false-positive on legitimate
  multi-OS devices.
- Ssentezo webhook callbacks need a public HTTPS URL, which most home-WiFi
  gateway boxes don't have; the system polls payment status on a timer
  either way, so this isn't required, just a faster path when available
  (e.g. via a Cloudflare Tunnel).
