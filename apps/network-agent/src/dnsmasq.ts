import { readFile, writeFile } from "fs/promises";
import path from "path";
import type { RouterVlanConfig } from "./config";
import { config } from "./config";
import { run } from "./shell";

function subnetPrefix(cidr: string): string {
  // "10.50.10.0/24" -> "10.50.10."
  return cidr.split("/")[0].split(".").slice(0, 3).join(".") + ".";
}

export function generateDnsmasqConf(routerVlans: RouterVlanConfig[]): string {
  const lines: string[] = ["# Managed by @netcam/network-agent — do not edit by hand.", ""];
  for (const r of routerVlans) {
    const prefix = subnetPrefix(r.subnetCidr);
    lines.push(`interface=${r.vlanInterface}`);
    lines.push(`dhcp-range=set:router-${r.routerId},${prefix}10,${prefix}250,255.255.255.0,12h`);
    lines.push(`dhcp-option=tag:router-${r.routerId},option:router,${r.gatewayIp}`);
    lines.push(`dhcp-option=tag:router-${r.routerId},option:dns-server,${r.gatewayIp}`);
    lines.push("");
  }
  return lines.join("\n");
}

export async function applyDnsmasqConfig(routerVlans: RouterVlanConfig[]): Promise<void> {
  if (routerVlans.length === 0) return;
  const confPath = path.join(config.dnsmasqConfDir, "netcam-routers.conf");
  await writeFile(confPath, generateDnsmasqConf(routerVlans), "utf8");
  await run("systemctl", ["restart", "dnsmasq"]);
}

export interface DhcpLease {
  macAddress: string;
  ipAddress: string;
  hostname?: string;
  routerId?: string;
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
      const [, mac, ip, hostname] = line.split(/\s+/);
      const prefix = ip ? ip.split(".").slice(0, 3).join(".") + "." : "";
      return {
        macAddress: mac?.toUpperCase(),
        ipAddress: ip,
        hostname: hostname !== "*" ? hostname : undefined,
        routerId: prefixToRouter.get(prefix),
      } as DhcpLease;
    })
    .filter((lease) => lease.macAddress && lease.ipAddress);
}
