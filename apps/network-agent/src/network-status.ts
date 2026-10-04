import { readFile } from "fs/promises";
import { config } from "./config";
import { listAuthorizedMacs } from "./nft";
import { assertValidIp, run } from "./shell";

export interface RouterProbe {
  id: string;
  ipAddress?: string | null;
  macAddress?: string | null;
}

interface Lease {
  mac: string;
  ip: string;
  hostname: string | null;
  expiresAt: string | null;
}

interface Neighbor {
  ip: string;
  mac: string;
  dev: string;
  state: string;
}

const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;

async function readLeases(): Promise<Lease[]> {
  const raw = await readFile(config.dnsmasqLeasesFile, "utf8").catch(() => "");
  return raw
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((f) => f.length >= 4 && IPV4_REGEX.test(f[2]))
    .map(([expiry, mac, ip, hostname]) => ({
      mac: mac.toUpperCase(),
      ip,
      hostname: hostname && hostname !== "*" ? hostname : null,
      expiresAt: Number(expiry) > 0 ? new Date(Number(expiry) * 1000).toISOString() : null,
    }));
}

async function readNeighbors(): Promise<Neighbor[]> {
  const { stdout } = await run("ip", ["-j", "-4", "neigh", "show"]).catch(() => ({ stdout: "[]" }));
  const entries = JSON.parse(stdout || "[]") as Array<{ dst: string; dev: string; lladdr?: string; state?: string[] }>;
  const lanInterfaces = new Set(config.routerVlans.map((r) => r.vlanInterface));
  return entries
    .filter((e) => e.lladdr && lanInterfaces.has(e.dev))
    .map((e) => ({ ip: e.dst, mac: e.lladdr!.toUpperCase(), dev: e.dev, state: e.state?.[0] ?? "UNKNOWN" }));
}

async function ping(ip: string): Promise<number | null> {
  try {
    const { stdout } = await run("ping", ["-c", "1", "-W", "1", assertValidIp(ip)]);
    const match = stdout.match(/time=([\d.]+)/);
    return match ? Number(match[1]) : 0;
  } catch {
    return null;
  }
}

/**
 * Live view of the client LAN(s) for the admin dashboard. Chained routers
 * (repeaters/APs behind the root router) all sit on the same flat segment, so
 * nothing ever heartbeats them — they're only knowable by probing their
 * management IP (or spotting their MAC in the neighbor table).
 *
 * Every leased/known IP is pinged first so the neighbor table reflects who is
 * actually present right now rather than stale ARP cache entries.
 */
export async function collectNetworkStatus(routers: RouterProbe[]) {
  const [leases, authorizedList] = await Promise.all([readLeases(), listAuthorizedMacs().catch(() => [])]);
  const authorized = new Set(authorizedList.map((m) => m.toUpperCase()));

  const probeIps = new Set<string>(leases.map((l) => l.ip));
  for (const r of routers) if (r.ipAddress && IPV4_REGEX.test(r.ipAddress)) probeIps.add(r.ipAddress);
  for (const n of await readNeighbors()) probeIps.add(n.ip);

  const rtt = new Map<string, number | null>();
  await Promise.all([...probeIps].map(async (ip) => rtt.set(ip, await ping(ip))));

  const neighbors = await readNeighbors();
  const neighborByMac = new Map(neighbors.map((n) => [n.mac, n]));
  const leaseByMac = new Map(leases.map((l) => [l.mac, l]));

  const macs = new Set<string>([...leaseByMac.keys(), ...neighborByMac.keys()]);
  const devices = [...macs].map((mac) => {
    const lease = leaseByMac.get(mac);
    const neighbor = neighborByMac.get(mac);
    const ip = neighbor?.ip ?? lease?.ip ?? null;
    const pingMs = ip ? (rtt.get(ip) ?? null) : null;
    // Phones often ignore ICMP while asleep but still answer ARP, so a kernel-
    // confirmed (REACHABLE) neighbor entry counts as online too; STALE/DELAY do not.
    const online = pingMs !== null || neighbor?.state === "REACHABLE";
    return {
      macAddress: mac,
      ipAddress: ip,
      hostname: lease?.hostname ?? null,
      interfaceName: neighbor?.dev ?? null,
      leaseExpiresAt: lease?.expiresAt ?? null,
      neighborState: neighbor?.state ?? null,
      pingMs,
      online,
      authorized: authorized.has(mac),
    };
  });

  const routerStatus = routers.map((r) => {
    const mac = r.macAddress?.toUpperCase() ?? null;
    const ip = r.ipAddress ?? (mac ? (neighborByMac.get(mac)?.ip ?? leaseByMac.get(mac)?.ip) : undefined) ?? null;
    const pingMs = ip ? (rtt.get(ip) ?? null) : null;
    const neighborState = mac ? (neighborByMac.get(mac)?.state ?? null) : null;
    return {
      id: r.id,
      ipAddress: ip,
      pingMs,
      reachable: pingMs !== null || neighborState === "REACHABLE",
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    interfaces: config.routerVlans.map((r) => ({ routerId: r.routerId, interfaceName: r.vlanInterface, subnetCidr: r.subnetCidr, gatewayIp: r.gatewayIp })),
    devices,
    routers: routerStatus,
  };
}
