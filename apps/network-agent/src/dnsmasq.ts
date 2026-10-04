import { readFile, writeFile } from "fs/promises";
import path from "path";
import type { RouterVlanConfig } from "./config";
import { config } from "./config";
import { run } from "./shell";
import { DNS_LOG_FILE, prepareDnsLog } from "./dns-log";

function subnetPrefix(cidr: string): string {
  // "10.50.10.0/24" -> "10.50.10."
  return cidr.split("/")[0].split(".").slice(0, 3).join(".") + ".";
}

export function generateDnsmasqConf(routerVlans: RouterVlanConfig[], portalPort: number): string {
  const lines: string[] = [
    "# Managed by @netcam/network-agent — do not edit by hand.",
    "",
    // The default 150-entry cache is far too small for a shared hotspot;
    // cache hits answer instantly instead of a round trip upstream.
    "cache-size=10000",
    // Feeds per-app usage tracking (dns-log.ts). The agent reads and empties
    // this file continuously; nothing is kept long-term.
    "log-queries=extra",
    `log-facility=${DNS_LOG_FILE}`,
    "log-async=50",
    "",
  ];
  for (const r of routerVlans) {
    const prefix = subnetPrefix(r.subnetCidr);
    lines.push(`interface=${r.vlanInterface}`);
    lines.push(`dhcp-range=set:router-${r.routerId},${prefix}10,${prefix}250,255.255.255.0,12h`);
    lines.push(`dhcp-option=tag:router-${r.routerId},option:router,${r.gatewayIp}`);
    lines.push(`dhcp-option=tag:router-${r.routerId},option:dns-server,${r.gatewayIp}`);
    // RFC 8910: explicitly advertise the captive-portal API. Modern Android,
    // iOS, macOS, and Windows clients can use this to show their "Sign in to
    // network" UI without relying only on intercepted HTTP probe traffic.
    lines.push(`dhcp-option=tag:router-${r.routerId},114,http://${r.gatewayIp}:${portalPort}/`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function applyDnsmasqConfig(routerVlans: RouterVlanConfig[], portalPort: number): Promise<void> {
  if (routerVlans.length === 0) return;
  await prepareDnsLog();
  const confPath = path.join(config.dnsmasqConfDir, "netcam-routers.conf");
  await writeFile(confPath, generateDnsmasqConf(routerVlans, portalPort), "utf8");
  await run("systemctl", ["restart", "dnsmasq"]);
}

export interface DhcpLease {
  macAddress: string;
  ipAddress: string;
  hostname?: string;
  routerId?: string;
  /** dnsmasq's lease expiry (epoch seconds) — changes on every new lease or renewal. */
  expiry: string;
}

/** Parses dnsmasq's lease file and attributes each lease to a router by which /24 the IP falls in. */
export async function readLeases(routerVlans: RouterVlanConfig[]): Promise<DhcpLease[]> {
  let content: string;
  try {
    content = await readFile(config.dnsmasqLeasesFile, "utf8");
  } catch {
    return [];
  }

  const prefixToRouter = new Map(routerVlans.map((r) => [subnetPrefix(r.subnetCidr), r.routerId]));

  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [expiry, mac, ip, hostname] = line.split(/\s+/);
      const prefix = ip ? ip.split(".").slice(0, 3).join(".") + "." : "";
      return {
        macAddress: mac?.toUpperCase(),
        ipAddress: ip,
        hostname: hostname !== "*" ? hostname : undefined,
        routerId: prefixToRouter.get(prefix),
        expiry,
      } as DhcpLease;
    })
    .filter((lease) => lease.macAddress && lease.ipAddress);
}
