import { findRouter } from "./config";
import * as nft from "./nft";
import * as tc from "./tc";
import { admitted } from "./state";
import { fetchActiveSessions } from "./api-client";

// Re-admitting means deleting and re-adding the firewall element, so skip it
// unless the expiry actually moved by more than this.
const EXPIRY_TOLERANCE_MS = 5 * 60_000;

export interface AdmitRequest {
  macAddress: string;
  routerId?: string | null;
  ipAddress?: string | null;
  downKbps: number;
  upKbps: number;
  sessionExpiresAt: string;
}

/**
 * Admits a device, or refreshes it if its expiry/speed changed. `force`
 * rewrites the firewall entry even when nothing changed. Returns false when
 * the device can't be placed on any configured segment.
 */
export async function admitDevice(req: AdmitRequest, force = false): Promise<boolean> {
  const router = findRouter(req.routerId, req.ipAddress);
  if (!router) return false;

  const mac = req.macAddress.toUpperCase();
  const expiresAt = new Date(req.sessionExpiresAt).getTime();
  const existing = admitted.get(mac);
  const sameRouter = existing?.router.routerId === router.routerId;

  const unchanged =
    existing &&
    sameRouter &&
    existing.downKbps === req.downKbps &&
    existing.upKbps === req.upKbps &&
    Math.abs(existing.sessionExpiresAt - expiresAt) < EXPIRY_TOLERANCE_MS;
  if (unchanged && !force) return true;

  const timeoutSeconds = Math.max(60, Math.ceil((expiresAt - Date.now()) / 1000));
  await nft.admitMac(mac, timeoutSeconds);

  if (existing && !sameRouter) await tc.removeShapingForMac(existing.router, mac).catch(() => undefined);
  const countersKept = await tc.applyShapingForMac(router, mac, req.downKbps, req.upKbps);

  admitted.set(mac, {
    mac,
    router,
    sessionExpiresAt: expiresAt,
    downKbps: req.downKbps,
    upKbps: req.upKbps,
    admittedAt: existing && sameRouter ? existing.admittedAt : Date.now(),
    lastDownBytes: countersKept && existing ? existing.lastDownBytes : 0,
    lastUpBytes: countersKept && existing ? existing.lastUpBytes : 0,
  });
  return true;
}

export async function revokeDevice(macAddress: string): Promise<void> {
  const mac = macAddress.toUpperCase();
  const entry = admitted.get(mac);
  await nft.revokeMac(mac).catch(() => undefined);
  if (entry) await tc.removeShapingForMac(entry.router, mac).catch(() => undefined);
  admitted.delete(mac);
}

/**
 * Makes the firewall match what the API says is entitled: admits anything
 * missing (e.g. everyone, right after a reboot), refreshes changed entries,
 * and revokes devices the API no longer lists. Throws if the API is
 * unreachable, so callers retry rather than treating that as "nobody paid".
 */
export async function syncWithApi(): Promise<{ restored: number; total: number }> {
  const startedAt = Date.now();
  const sessions = await fetchActiveSessions();
  const inFirewall = new Set((await nft.listAuthorizedMacs().catch(() => [] as string[])).map((m) => m.toUpperCase()));

  const entitled = new Set<string>();
  let restored = 0;
  for (const session of sessions) {
    const mac = session.macAddress.toUpperCase();
    entitled.add(mac);
    const missing = !inFirewall.has(mac);
    const ok = await admitDevice(session, missing).catch((err) => {
      console.warn(`re-admitting ${mac} failed: ${(err as Error).message}`);
      return false;
    });
    if (ok && missing) restored++;
  }

  // Only revoke entries older than this sync: a device admitted while the
  // session list was being fetched simply isn't in that list yet.
  for (const [mac, entry] of admitted) {
    if (!entitled.has(mac) && entry.admittedAt < startedAt) await revokeDevice(mac);
  }

  return { restored, total: sessions.length };
}
