import "dotenv/config";

export interface RouterVlanConfig {
  parentInterface: string;
  /** null means the router is connected untagged directly to parentInterface. */
  vlanId: number | null;
  subnetId: number;
  routerId: string;
  vlanInterface: string; // e.g. eth0.10, or eth0 for an untagged router
  ifbInterface: string; // mirrors this segment's ingress for upload shaping/accounting
  subnetCidr: string; // e.g. 10.50.10.0/24
  gatewayIp: string; // e.g. 10.50.10.1
}

function assertSubnetId(value: string, entry: string): number {
  const subnetId = Number(value);
  if (!Number.isInteger(subnetId) || subnetId < 1 || subnetId > 254) {
    throw new Error(`Invalid subnet ID in "${entry}". Expected a number from 1 to 254`);
  }
  return subnetId;
}

function parseRouterVlans(base: string): RouterVlanConfig[] {
  const raw = process.env.ROUTER_VLANS ?? "";
  if (!raw.trim()) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [parentInterface, vlanIdStr, routerId, subnetIdStr] = entry.split(":");
      const vlanId = Number(vlanIdStr);
      if (!parentInterface || !Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094 || !routerId) {
        throw new Error(`Invalid ROUTER_VLANS entry: "${entry}". Expected parentIface:vlanId:routerId`);
      }
      // VLAN IDs extend to 4094, while an IPv4 /24 subnet octet only extends
      // to 254. An optional fourth field keeps the two namespaces separate.
      const subnetId = assertSubnetId(subnetIdStr ?? vlanIdStr, entry);
      return {
        parentInterface,
        vlanId,
        subnetId,
        routerId,
        vlanInterface: `${parentInterface}.${vlanId}`,
        ifbInterface: `ifb-v${vlanId}`,
        subnetCidr: `${base}.${subnetId}.0/24`,
        gatewayIp: `${base}.${subnetId}.1`,
      };
    });
}

/**
 * Parses ordinary, untagged router/AP connections. This is the practical
 * fallback for consumer routers that do not support 802.1Q VLANs.
 * Format: parentIface:subnetId:routerId
 */
function parseRouterLans(base: string): RouterVlanConfig[] {
  const raw = process.env.ROUTER_LANS ?? "";
  if (!raw.trim()) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [parentInterface, subnetIdStr, routerId] = entry.split(":");
      if (!parentInterface || !routerId) {
        throw new Error(`Invalid ROUTER_LANS entry: "${entry}". Expected parentIface:subnetId:routerId`);
      }
      const subnetId = assertSubnetId(subnetIdStr, entry);
      return {
        parentInterface,
        vlanId: null,
        subnetId,
        routerId,
        vlanInterface: parentInterface,
        ifbInterface: `ifb-l${subnetId}`,
        subnetCidr: `${base}.${subnetId}.0/24`,
        gatewayIp: `${base}.${subnetId}.1`,
      };
    });
}

function parseRouterNetworks(): RouterVlanConfig[] {
  const base = process.env.DHCP_POOL_BASE ?? "10.50";
  if (!/^\d{1,3}\.\d{1,3}$/.test(base)) {
    throw new Error(`Invalid DHCP_POOL_BASE "${base}". Expected the first two IPv4 octets, e.g. 10.50`);
  }
  const networks = [...parseRouterVlans(base), ...parseRouterLans(base)];
  const interfaces = new Set<string>();
  const subnets = new Set<number>();
  const routers = new Set<string>();
  for (const network of networks) {
    if (interfaces.has(network.vlanInterface)) throw new Error(`Router interface ${network.vlanInterface} is configured more than once`);
    if (subnets.has(network.subnetId)) throw new Error(`Subnet ID ${network.subnetId} is configured more than once`);
    if (routers.has(network.routerId)) throw new Error(`Router ID ${network.routerId} is configured more than once`);
    interfaces.add(network.vlanInterface);
    subnets.add(network.subnetId);
    routers.add(network.routerId);
  }
  return networks;
}

function ipInSubnet(ip: string, network: RouterVlanConfig): boolean {
  const prefix = network.subnetCidr.split("/")[0].split(".").slice(0, 3).join(".") + ".";
  return ip.startsWith(prefix);
}

/**
 * Which configured segment a device belongs to: by router ID when known,
 * else by the /24 its IP is in, else the only segment on a single-segment
 * box. Never fails just because an older session row has no routerId.
 */
export function findRouter(routerId?: string | null, ipAddress?: string | null): RouterVlanConfig | undefined {
  const networks = config.routerVlans;
  return (
    (routerId ? networks.find((r) => r.routerId === routerId) : undefined) ??
    (ipAddress ? networks.find((r) => ipInSubnet(ipAddress, r)) : undefined) ??
    (networks.length === 1 ? networks[0] : undefined)
  );
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  apiUrl: process.env.NETCAM_API_URL ?? "http://127.0.0.1:3000",
  sharedSecret: process.env.NETWORK_AGENT_SHARED_SECRET ?? "insecure-dev-secret",
  wanInterface: process.env.WAN_INTERFACE ?? "wlan0",
  routerVlans: parseRouterNetworks(),
  dnsmasqConfDir: process.env.DNSMASQ_CONF_DIR ?? "/etc/dnsmasq.d",
  dnsmasqLeasesFile: process.env.DNSMASQ_LEASES_FILE ?? "/var/lib/misc/dnsmasq.leases",
  ttlSampleIntervalMs: Number(process.env.TTL_SAMPLE_INTERVAL_MS ?? 60_000),
  ttlSamplePacketCount: Number(process.env.TTL_SAMPLE_PACKET_COUNT ?? 8),
};
