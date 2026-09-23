import { config } from "./config";
import { createHttpServer } from "./http-server";
import { createPortalApp } from "./portal-proxy";
import { admitMac, applyBaseRuleset, revokeMac } from "./nft";
import { ensureAllVlanInterfaces } from "./vlan";
import { applyDnsmasqConfig } from "./dnsmasq";
import { applyShapingForMac, ensureShapingForRouter, readClassBytes, removeShapingForMac } from "./tc";
import { sampleTtls } from "./ttl-sampler";
import { fetchActiveSessions, sendHeartbeat, sendTrafficReport } from "./api-client";
import { admitted } from "./state";

const PORTAL_PORT = Number(process.env.PORTAL_PORT ?? 8080);

async function bootstrapNetworking() {
  if (config.routerVlans.length === 0) {
    console.warn(
      "ROUTER_VLANS is empty — network-agent will run its HTTP API only, with no nftables/dnsmasq/tc " +
        "setup. Configure routers in the admin dashboard, set ROUTER_VLANS in .env, and restart.",
    );
    return;
  }

  await ensureAllVlanInterfaces(config.routerVlans);
  await applyBaseRuleset(config.wanInterface, config.routerVlans, PORTAL_PORT, config.port);
  await applyDnsmasqConfig(config.routerVlans);
  for (const router of config.routerVlans) {
    await ensureShapingForRouter(router);
  }
  console.log(`network-agent: networking bootstrapped for ${config.routerVlans.length} router(s).`);
}

/**
 * Re-admits every session the API still considers active. Must run right
 * after bootstrapNetworking(), which just wiped the authorized_macs set by
 * recreating the nftables table — without this, every paying customer
 * would be silently disconnected on every agent restart/update/reboot.
 */
async function reconcileActiveSessions() {
  if (config.routerVlans.length === 0) return;

  const sessions = await fetchActiveSessions();
  let restored = 0;
  for (const session of sessions) {
    const router = config.routerVlans.find((r) => r.routerId === session.routerId);
    if (!router) continue; // not one of this box's configured routers

    const timeoutSeconds = Math.max(60, Math.ceil((new Date(session.sessionExpiresAt).getTime() - Date.now()) / 1000));
    await admitMac(session.macAddress, timeoutSeconds).catch(() => undefined);
    await applyShapingForMac(router, session.macAddress, session.downKbps, session.upKbps).catch(() => undefined);
    admitted.set(session.macAddress.toUpperCase(), {
      mac: session.macAddress.toUpperCase(),
      router,
      sessionExpiresAt: new Date(session.sessionExpiresAt).getTime(),
      lastDownBytes: 0,
      lastUpBytes: 0,
    });
    restored++;
  }
  console.log(`network-agent: reconciled ${restored}/${sessions.length} active session(s) from the API on startup.`);
}

function startHeartbeatLoop() {
  setInterval(() => {
    for (const router of config.routerVlans) {
      const macs = [...admitted.values()].filter((a) => a.router.routerId === router.routerId).map((a) => a.mac);
      void sendHeartbeat(router.routerId, router.vlanId, router.vlanInterface, macs);
    }
  }, 30_000);
}

function startExpirySweep() {
  setInterval(() => {
    const now = Date.now();
    for (const [mac, entry] of admitted) {
      if (entry.sessionExpiresAt <= now) {
        void revokeMac(mac).catch(() => undefined);
        void removeShapingForMac(entry.router, mac).catch(() => undefined);
        admitted.delete(mac);
      }
    }
  }, 15_000);
}

function startTrafficAndTtlLoop() {
  setInterval(async () => {
    const byRouter = new Map<string, Array<{ macAddress: string; bytesUp: number; bytesDown: number; observedTtls?: number[] }>>();

    for (const entry of admitted.values()) {
      const [downBytes, upBytes, ttls] = await Promise.all([
        readClassBytes(entry.router.vlanInterface, entry.mac),
        readClassBytes(entry.router.ifbInterface, entry.mac),
        sampleTtls(entry.router.vlanInterface, entry.mac, config.ttlSamplePacketCount).catch(() => []),
      ]);

      const bytesDown = downBytes !== null ? Math.max(0, downBytes - entry.lastDownBytes) : 0;
      const bytesUp = upBytes !== null ? Math.max(0, upBytes - entry.lastUpBytes) : 0;
      if (downBytes !== null) entry.lastDownBytes = downBytes;
      if (upBytes !== null) entry.lastUpBytes = upBytes;

      const list = byRouter.get(entry.router.routerId) ?? [];
      list.push({ macAddress: entry.mac, bytesUp, bytesDown, observedTtls: ttls.length ? ttls : undefined });
      byRouter.set(entry.router.routerId, list);
    }

    for (const [routerId, samples] of byRouter) {
      await sendTrafficReport(routerId, samples);
    }
  }, config.ttlSampleIntervalMs);
}

async function main() {
  await bootstrapNetworking().catch((err) => {
    console.error(`Networking bootstrap failed (will retry HTTP API anyway): ${(err as Error).message}`);
  });
  await reconcileActiveSessions().catch((err) => {
    console.error(`Session reconciliation failed: ${(err as Error).message}`);
  });

  // Bound to all interfaces (not just loopback) so a containerized NestJS
  // API reachable via host.docker.internal can call it — the nft base
  // ruleset explicitly drops this port from every router VLAN interface
  // (see nft.ts), and every request still requires the shared secret, so
  // this isn't actually open to captive-portal clients.
  const controlApp = createHttpServer();
  controlApp.listen(config.port, "0.0.0.0", () => {
    console.log(`network-agent control API listening on :${config.port} (shared-secret gated, blocked from LAN by nft)`);
  });

  const portalApp = createPortalApp();
  portalApp.listen(PORTAL_PORT, "0.0.0.0", () => {
    console.log(`network-agent captive portal listening on 0.0.0.0:${PORTAL_PORT} (open to LAN clients)`);
  });

  startHeartbeatLoop();
  startExpirySweep();
  startTrafficAndTtlLoop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
