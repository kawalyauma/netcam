import { writeFile, mkdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { RouterVlanConfig } from "./config";
import { assertValidMac, run } from "./shell";

const TABLE = "inet netcam";
const RULESET_PATH = path.join(tmpdir(), "netcam-ruleset.nft");

/**
 * Walled-garden model: every router VLAN interface is in the `forward`
 * chain. A client's ether saddr must be in `authorized_macs` (a dynamic,
 * per-element-timeout set we manage at runtime) to be forwarded to the WAN
 * interface. Unauthenticated HTTP (port 80) gets DNAT'd to this box's own
 * address on that VLAN so the captive-portal page loads no matter what URL
 * the client's OS probes first; DNS/DHCP to the gateway itself is always
 * allowed so the portal is resolvable and reachable before authorization.
 */
export function generateRuleset(
  wanInterface: string,
  routerVlans: RouterVlanConfig[],
  portalPort: number,
  controlPort: number,
): string {
  const lines: string[] = [];
  lines.push(`table ${TABLE}`);
  lines.push(`delete table ${TABLE}`);
  lines.push(`table ${TABLE} {`);
  lines.push(`  set authorized_macs {`);
  lines.push(`    type ether_addr`);
  lines.push(`    flags dynamic,timeout`);
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  chain forward {`);
  lines.push(`    type filter hook forward priority filter; policy drop;`);
  lines.push(`    ct state established,related accept`);
  for (const r of routerVlans) {
    lines.push(
      `    iifname "${r.vlanInterface}" oifname "${wanInterface}" ether saddr @authorized_macs accept`,
    );
  }
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  chain input {`);
  lines.push(`    type filter hook input priority filter; policy accept;`);
  lines.push(`    ct state established,related accept`);
  for (const r of routerVlans) {
    // The control API (network-agent <-> main API, shared-secret gated) is
    // bound on all interfaces so a containerized API can reach it via
    // host.docker.internal, but it must never be reachable from LAN clients.
    lines.push(`    iifname "${r.vlanInterface}" tcp dport ${controlPort} drop`);
    lines.push(`    iifname "${r.vlanInterface}" udp dport { 53, 67 } accept`);
    lines.push(`    iifname "${r.vlanInterface}" tcp dport 53 accept`);
    lines.push(`    iifname "${r.vlanInterface}" tcp dport ${portalPort} accept`);
  }
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  chain prerouting {`);
  lines.push(`    type nat hook prerouting priority dstnat; policy accept;`);
  for (const r of routerVlans) {
    lines.push(
      `    iifname "${r.vlanInterface}" tcp dport 80 ether saddr != @authorized_macs dnat to ${r.gatewayIp}:${portalPort}`,
    );
  }
  lines.push(`  }`);
  lines.push(``);
  lines.push(`  chain postrouting {`);
  lines.push(`    type nat hook postrouting priority srcnat; policy accept;`);
  lines.push(`    oifname "${wanInterface}" masquerade`);
  lines.push(`  }`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

export async function applyBaseRuleset(
  wanInterface: string,
  routerVlans: RouterVlanConfig[],
  portalPort: number,
  controlPort: number,
): Promise<void> {
  await mkdir(path.dirname(RULESET_PATH), { recursive: true });
  await writeFile(RULESET_PATH, generateRuleset(wanInterface, routerVlans, portalPort, controlPort), "utf8");
  await run("nft", ["-f", RULESET_PATH]);
}

export async function admitMac(mac: string, timeoutSeconds: number): Promise<void> {
  const safeMac = assertValidMac(mac);
  const timeout = Math.max(1, Math.floor(timeoutSeconds));
  // Idempotent: delete first (ignore failure if absent) so re-admitting refreshes the timeout.
  await revokeMac(safeMac).catch(() => undefined);
  await run("nft", ["add", "element", "inet", "netcam", "authorized_macs", `{ ${safeMac} timeout ${timeout}s }`]);
}

export async function revokeMac(mac: string): Promise<void> {
  const safeMac = assertValidMac(mac);
  await run("nft", ["delete", "element", "inet", "netcam", "authorized_macs", `{ ${safeMac} }`]);
}

export async function listAuthorizedMacs(): Promise<string[]> {
  const { stdout } = await run("nft", ["-j", "list", "set", "inet", "netcam", "authorized_macs"]);
  try {
    const parsed = JSON.parse(stdout) as {
      nftables: Array<{ set?: { elem?: Array<string | { elem: { val: string } }> } }>;
    };
    const set = parsed.nftables.find((n) => n.set)?.set;
    const elems = set?.elem ?? [];
    return elems.map((e) => (typeof e === "string" ? e : e.elem.val));
  } catch {
    return [];
  }
}
