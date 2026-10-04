import { config } from "./config";
import { readLeases } from "./dnsmasq";
import { assertValidIp, assertValidMac, run } from "./shell";

/**
 * Whether a MAC is on the network right now. Clears the neighbor entry and
 * forces a fresh ARP lookup on each of its known IPs: every device answers
 * ARP (even phones that ignore ping), and a stale cached entry can't fake
 * presence. Used to decide whether a device slot can move to a new MAC.
 */
export async function isPresent(mac: string, ipAddress?: string | null): Promise<boolean> {
  const safeMac = assertValidMac(mac).toUpperCase();
  const ips = new Set<string>();
  if (ipAddress) ips.add(assertValidIp(ipAddress));
  for (const lease of await readLeases(config.routerVlans)) {
    if (lease.macAddress === safeMac) ips.add(lease.ipAddress);
  }

  for (const ip of ips) {
    for (const r of config.routerVlans) {
      await run("ip", ["neigh", "del", ip, "dev", r.vlanInterface]).catch(() => undefined);
    }
    await run("ping", ["-c", "2", "-W", "1", ip]).catch(() => undefined);
    const { stdout } = await run("ip", ["neigh", "show", ip]).catch(() => ({ stdout: "" }));
    const match = stdout.match(/lladdr\s+([0-9a-fA-F:]{17})/);
    if (match && match[1].toUpperCase() === safeMac && !/FAILED|INCOMPLETE/.test(stdout)) return true;
  }
  return false;
}

/**
 * Resolves a client's MAC address from their IP via this box's own kernel
 * neighbor (ARP) table. This is the authoritative, server-side way captive
 * portals identify devices — never trust a MAC address supplied by
 * client-side JS, since a browser has no API to read it and any value a
 * page "reports" is unverifiable.
 */
export async function resolveMacFromIp(ip: string): Promise<string | null> {
  const safeIp = assertValidIp(ip);

  const lookup = async (): Promise<string | null> => {
    const { stdout } = await run("ip", ["neigh", "show", safeIp]);
    const match = stdout.match(/lladdr\s+([0-9a-fA-F:]{17})/);
    return match ? match[1].toUpperCase() : null;
  };

  let mac = await lookup().catch(() => null);
  if (mac) return mac;

  // Not yet in the ARP cache (e.g. the client's first packet was the HTTP
  // request itself) — a single ping forces the kernel to resolve it.
  await run("ping", ["-c", "1", "-W", "1", safeIp]).catch(() => undefined);
  mac = await lookup().catch(() => null);
  return mac;
}
