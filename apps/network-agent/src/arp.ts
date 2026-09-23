import { assertValidIp, run } from "./shell";

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
