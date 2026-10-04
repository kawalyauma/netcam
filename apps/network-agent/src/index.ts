import { readFile } from "fs/promises";
import { config } from "./config";
import { createHttpServer } from "./http-server";
import { createPortalApp } from "./portal-proxy";
import { applyBaseRuleset } from "./nft";
import { ensureAllVlanInterfaces } from "./vlan";
import { applyDnsmasqConfig } from "./dnsmasq";
import { ensureShapingForRouter, readClassBytes } from "./tc";
import { sampleTtls } from "./ttl-sampler";
import { sendHeartbeat, sendTrafficReport, type TrafficSample } from "./api-client";
import { revokeDevice, syncWithApi } from "./admission";
import { startLeaseWatcher } from "./lease-watcher";
import { drainAppUsage, startUsageCollector } from "./usage";
import { admitted } from "./state";

const PORTAL_PORT = Number(process.env.PORTAL_PORT ?? 8080);
const BOOTSTRAP_RETRY_MS = 15_000;
const SYNC_RETRY_MS = 5_000; // until the API answers for the first time
const SYNC_INTERVAL_MS = 60_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function bootstrapNetworking() {
  await ensureAllVlanInterfaces(config.routerVlans);
  await applyBaseRuleset(config.wanInterface, config.routerVlans, PORTAL_PORT, config.port);
  await applyDnsmasqConfig(config.routerVlans, PORTAL_PORT);
  for (const router of config.routerVlans) {
    await ensureShapingForRouter(router);
  }
  // The ruleset and shaping were just recreated empty.
  admitted.clear();
  console.log(`network-agent: networking bootstrapped for ${config.routerVlans.length} router(s).`);
}

/** Retries until it works: after a power cut, USB NICs and the WAN link can come up late. */
async function bootstrapUntilReady() {
  for (let attempt = 1; ; attempt++) {
    try {
      await bootstrapNetworking();
      return;
    } catch (err) {
      console.error(`Networking bootstrap failed (attempt ${attempt}), retrying in ${BOOTSTRAP_RETRY_MS / 1000}s: ${(err as Error).message}`);
      await sleep(BOOTSTRAP_RETRY_MS);
    }
  }
}

/**
 * Re-admits everyone the API says is entitled. On a reboot the API container
 * usually starts after this agent, so the first sync retries quickly until
 * the API answers; after that it re-syncs every minute to self-heal any
 * admit/revoke call that was missed.
 */
async function runSyncLoop() {
  let synced = false;
  for (;;) {
    try {
      const { restored, total } = await syncWithApi();
      if (!synced || restored > 0) {
        console.log(`network-agent: synced with API — ${total} active session(s), ${restored} (re)admitted.`);
      }
      synced = true;
    } catch (err) {
      console.warn(`sync with API failed${synced ? "" : " (API not up yet?)"}: ${(err as Error).message}`);
    }
    await sleep(synced ? SYNC_INTERVAL_MS : SYNC_RETRY_MS);
  }
}

/** Whether the router's port has a physical link (cable plugged in, router powered). */
async function hasCarrier(iface: string): Promise<boolean> {
  const value = await readFile(`/sys/class/net/${iface}/carrier`, "utf8").catch(() => "0");
  return value.trim() === "1";
}

function startHeartbeatLoop() {
  setInterval(async () => {
    for (const router of config.routerVlans) {
      // A heartbeat is what marks the router online in the dashboard, so it
      // must reflect the link, not just that this agent is running.
      if (!(await hasCarrier(router.parentInterface))) continue;
      const macs = [...admitted.values()].filter((a) => a.router.routerId === router.routerId).map((a) => a.mac);
      void sendHeartbeat(router.routerId, router.vlanId ?? 0, router.vlanInterface, macs);
    }
  }, 30_000);
}

function startExpirySweep() {
  setInterval(() => {
    const now = Date.now();
    for (const [mac, entry] of admitted) {
      if (entry.sessionExpiresAt <= now) void revokeDevice(mac);
    }
  }, 15_000);
}

function startTrafficAndTtlLoop() {
  setInterval(async () => {
    const byRouter = new Map<string, TrafficSample[]>();

    for (const entry of admitted.values()) {
      const [downBytes, upBytes, ttls] = await Promise.all([
        readClassBytes(entry.router.vlanInterface, entry.mac).catch(() => null),
        readClassBytes(entry.router.ifbInterface, entry.mac).catch(() => null),
        sampleTtls(entry.router.vlanInterface, entry.mac, config.ttlSamplePacketCount).catch(() => []),
      ]);

      const bytesDown = downBytes !== null ? Math.max(0, downBytes - entry.lastDownBytes) : 0;
      const bytesUp = upBytes !== null ? Math.max(0, upBytes - entry.lastUpBytes) : 0;
      if (downBytes !== null) entry.lastDownBytes = downBytes;
      if (upBytes !== null) entry.lastUpBytes = upBytes;

      const list = byRouter.get(entry.router.routerId) ?? [];
      list.push({
        macAddress: entry.mac,
        bytesUp,
        bytesDown,
        observedTtls: ttls.length ? ttls : undefined,
        ...drainAppUsage(entry.mac),
      });
      byRouter.set(entry.router.routerId, list);
    }

    for (const [routerId, samples] of byRouter) {
      await sendTrafficReport(routerId, samples);
    }
  }, config.ttlSampleIntervalMs);
}

async function main() {
  // Bound to all interfaces (not just loopback) so a containerized NestJS
  // API reachable via host.docker.internal can call it — the nft base
  // ruleset explicitly drops this port from every router interface (see
  // nft.ts), and every request still requires the shared secret.
  const controlApp = createHttpServer();
  controlApp.listen(config.port, "0.0.0.0", () => {
    console.log(`network-agent control API listening on :${config.port} (shared-secret gated, blocked from LAN by nft)`);
  });

  if (config.routerVlans.length === 0) {
    console.warn(
      "ROUTER_VLANS and ROUTER_LANS are empty — network-agent will run its HTTP API only, with no " +
        "nftables/dnsmasq/tc setup. Configure a router segment in .env and restart.",
    );
    return;
  }

  await bootstrapUntilReady();

  const portalApp = createPortalApp();
  portalApp.listen(PORTAL_PORT, "0.0.0.0", () => {
    console.log(`network-agent captive portal listening on 0.0.0.0:${PORTAL_PORT} (open to LAN clients)`);
  });

  void runSyncLoop();
  startLeaseWatcher();
  startUsageCollector();
  startHeartbeatLoop();
  startExpirySweep();
  startTrafficAndTtlLoop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
