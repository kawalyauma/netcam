# NetCam — WiFi Billing & Voucher Platform

Self-hosted WiFi hotspot billing, voucher generation, and captive-portal
enforcement system. Designed to run entirely on a single Linux PC (the
"gateway box") that a vendor clones from this repo, configures, and rents
out or resells hotspot access from.

## 1. Physical / network topology

```
 Internet (vendor's WiFi, e.g. phone hotspot or home router)
        │  (wlan0, client mode)
        ▼
 ┌─────────────────────────────────────────────┐
 │              GATEWAY BOX (this repo)          │
 │  wlan0: WAN — receives internet over WiFi     │
 │  eth0 / usb-eth1 / usb-eth2 ...: LAN uplinks  │  ← "output channels"
 │  (one physical port per downstream router)    │
 └─────────────────────────────────────────────┘
        │ eth0            │ usb-eth1
        ▼                 ▼
   Router A (AP)      Router C (AP)
        │
        ▼ (cable, chained)
   Router B (AP)
        │
        ▼
   Router B2 (AP)  ...chain continues
```

- The gateway box is the **only** router/firewall/DHCP server on the
  network. Every downstream device (TP-Link/whatever) is configured in
  **bridge / access-point mode**, NOT as a NAT router. They just extend
  WiFi + switch ports; they do not hand out their own DHCP leases.
- Chaining ("router A supplies router B") means A's LAN port feeds B's WAN
  port, but B is still bridging, not NATing — so all clients, regardless
  of how many hops away, are on the gateway box's own L2/L3 network.
- **Output channels** are the gateway box's own physical/logical LAN
  interfaces (`eth0`, a USB ethernet adapter, or a second WiFi radio in AP
  mode). The admin dashboard lets the operator pick which one is currently
  "live" — useful when the box has multiple ports and the operator wants
  to move which physical run of cable is actively serving customers
  without touching hardware.

### 1.1 Per-router user mapping (why VLANs are required)

Because every router in a chain just bridges Ethernet, the gateway can't
tell "which router is this client behind" from IP/MAC alone — a flat
bridged network gives no such signal. To let the dashboard show
"see active routers, map users per router" **honestly** (not just as a
cosmetic label), each router gets its own **VLAN**:

- Each output channel/port on the gateway is assigned a distinct 802.1Q
  VLAN ID and its own DHCP pool (e.g. `10.50.<routerId>.0/24`).
- Downstream routers must be VLAN-aware (most OpenWrt-flashable routers,
  and many stock ones, support a single untagged access VLAN per port at
  minimum) OR sit behind a cheap managed/VLAN switch feeding the gateway.
- A device's DHCP lease subnet tells the network-agent (and therefore the
  API/dashboard) exactly which router segment it's on — this is what
  populates "active routers" and "users per router."
- **If a vendor's routers can't do VLANs**, the system still works as a
  single flat network — the dashboard will show one "Unassigned segment"
  bucket for all users instead of per-router breakdown. This is called
  out explicitly in the setup script/README so it's not a silent gap.

### 1.2 Software stack on the box

| Concern | Tool |
|---|---|
| WAN WiFi client | `wpa_supplicant` (wlan0) |
| LAN switching/VLANs | Linux bridge + `iproute2` VLAN sub-interfaces per port |
| DHCP + DNS + captive redirect | `dnsmasq` (one instance, per-VLAN `dhcp-range`s) |
| Walled garden / MAC admission control | `nftables` (a `netcam_authorized` set of MAC/IP pairs, managed live) |
| Bandwidth shaping per package | `tc` (HTB) driven by the network-agent |
| App runtime | Docker Compose for API + Postgres + web; network-agent runs on the **host** (needs `NET_ADMIN`/root, real interfaces) |

## 2. Repo layout

```
apps/
  api/            NestJS backend — REST API, auth, billing, webhooks
  web/            React admin dashboard
  portal/         Lightweight captive-portal page (vanilla TS, no framework — must load fast on 2G/3G)
  network-agent/  Node service with root/NET_ADMIN: owns nftables, dnsmasq config, tc, VLAN interfaces
packages/
  shared/         Shared TypeScript types/DTOs between api/web/portal/network-agent
docker/           docker-compose.yml + Dockerfiles for api/web/postgres
scripts/          install.sh (bare-metal network-agent + systemd units), dev bootstrap
docs/             this file, integration notes, hardware setup guide
```

## 3. Core domain model

See `apps/api/prisma/schema.prisma` for the source of truth. Summary:

- **OutputChannel** — the gateway's own LAN interfaces (selectable "active" uplink).
- **Router** — a physical AP in the chain; self-referencing `parentRouterId` encodes the chain; `vlanId`/`subnetCidr` encode its segment.
- **Package** — a sellable plan (price, duration or data cap, speed limits, **device limit** = max concurrent MACs per voucher).
- **Voucher** — a code tied to a Package; becomes `ACTIVE` on first redemption; carries `deviceLimit` enforcement state.
- **Device** — a MAC address bound to a voucher (enforces phone-limit / anti-resharing).
- **Session** — a live/historical connection: device + router + traffic counters + TTL-anomaly flags (reshare detection).
- **Customer** — phone number identity, used for "lost my voucher" recovery.
- **Payment** — a Ssentezo mobile-money transaction, optionally linked to an auto-issued Voucher.
- **SmsLog** — outbound EGO SMS messages (voucher delivery, receipts).
- **AuditLog** — admin actions.
- **Setting** — key/value app config (active output channel id, portal branding, etc).

## 4. Anti-sharing / phone-limit enforcement

1. **Device cap per voucher**: `Package.deviceLimit` (default 1–3). The
   network-agent only admits a new MAC to the `netcod_authorized` nftables
   set for a voucher if `Device` count for that voucher is below the cap.
2. **NAT/hotspot-sharing detection**: the network-agent samples IP TTL on
   authorized clients' traffic. A dropping/varying TTL pattern from a
   single MAC (indicative of that "device" itself being a phone hotspot
   re-sharing to other devices) is flagged on `Session.ttlAnomalyScore`;
   above a threshold the admin dashboard surfaces it and can auto-suspend
   the voucher. This is a heuristic, not perfect — documented as such.
3. **Lost token recovery**: portal has a "I lost my code" flow — customer
   enters their phone number, API looks up their `Customer` → active
   `Voucher`, and (if within a cool-down) re-sends it via SMS and/or
   re-displays it after a phone-number verification step (OTP via SMS),
   rather than a fresh purchase.
4. **Fast captive portal**: `apps/portal` is a small hand-rolled TS/HTML
   bundle (no heavy framework, target < 30KB gzipped, inlined critical
   CSS) so it loads over poor captive-portal-associated networks quickly;
   API calls are minimal JSON POSTs.

## 5. Payment & SMS integration

Both are implemented behind clean interfaces in `apps/api/src/payments`
and `apps/api/src/sms` so the concrete provider client is swappable:

- `PaymentGateway` interface: `initiate()`, `getStatus()`, `handleWebhook()`.
  `SsentezoGateway` implements it — **stubbed pending exact API docs**
  (network egress to `wallet.ssentezo.com` is blocked in this dev
  environment; endpoints/payload shapes are marked `TODO` with the
  general mobile-money request/webhook shape assumed, to be corrected
  from the real docs).
- `SmsProvider` interface: `send()`. `EgoSmsProvider` implements it —
  same caveat for `developers.pahappa.com`.

## 6. Deployment

- `docker compose -f docker/docker-compose.yml up -d` runs Postgres + API
  + web admin dashboard + portal (all container-friendly, no host network
  needs).
- `scripts/install-network-agent.sh` is run **once, directly on the host**
  (not in Docker) because it needs real NIC access, VLAN creation,
  nftables, and dnsmasq — installs dependencies and a systemd unit for
  `network-agent`.
- Vendors clone the repo, run `scripts/install.sh` (orchestrates both of
  the above), edit `.env` and `packages.seed.json` to set their own plans
  and pricing, and `git pull` to update later.
