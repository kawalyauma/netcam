import { watch } from "fs";
import path from "path";
import { config } from "./config";
import { readLeases } from "./dnsmasq";
import { admitted } from "./state";
import { requestAutoLogin, requestFreeConnect } from "./api-client";

const POLL_MS = 5_000;
// A device that isn't entitled is only asked about again when it takes a new
// lease, or after this long (in case it paid without opening the portal).
const RECHECK_MS = 5 * 60_000;
const RETRY_AFTER_ERROR_MS = 10_000;

const lastChecked = new Map<string, { lease: string; at: number }>();
let scanning = false;
let rescan = false;

/**
 * Logs paying customers in the moment their phone joins the WiFi, before the
 * OS even probes for a captive portal: every DHCP lease from a device that
 * isn't admitted yet is offered to the API, which admits it if it's entitled.
 */
async function scan(): Promise<void> {
  if (scanning) {
    rescan = true;
    return;
  }
  scanning = true;
  try {
    const now = Date.now();
    for (const lease of await readLeases(config.routerVlans)) {
      if (!lease.routerId || admitted.has(lease.macAddress)) continue;

      const leaseKey = `${lease.ipAddress}|${lease.expiry}`;
      const prev = lastChecked.get(lease.macAddress);
      if (prev && prev.lease === leaseKey && now - prev.at < RECHECK_MS) continue;

      lastChecked.set(lease.macAddress, { lease: leaseKey, at: now });
      // Launch promo: admit everyone free on join. Otherwise only entitled
      // (paid) devices get logged in automatically.
      const admit = config.freeLaunch ? requestFreeConnect : requestAutoLogin;
      await admit(lease.macAddress, lease.ipAddress, lease.routerId, lease.hostname).catch((err) => {
        console.warn(`auto-login check for ${lease.macAddress} failed: ${(err as Error).message}`);
        lastChecked.set(lease.macAddress, { lease: leaseKey, at: now - RECHECK_MS + RETRY_AFTER_ERROR_MS });
      });
    }
  } finally {
    scanning = false;
    if (rescan) {
      rescan = false;
      void scan();
    }
  }
}

export function startLeaseWatcher(): void {
  if (config.routerVlans.length === 0) return;
  setInterval(() => void scan(), POLL_MS);
  // dnsmasq rewrites the lease file on every lease, so watching its directory
  // reacts within milliseconds; the poll above is the fallback.
  const leaseFile = path.basename(config.dnsmasqLeasesFile);
  try {
    watch(path.dirname(config.dnsmasqLeasesFile), (_event, file) => {
      if (!file || file.toString() === leaseFile) void scan();
    });
  } catch (err) {
    console.warn(`watching ${config.dnsmasqLeasesFile} failed, polling only: ${(err as Error).message}`);
  }
  void scan();
}
