import "dotenv/config";

export interface RouterVlanConfig {
  parentInterface: string;
  vlanId: number;
  routerId: string;
  vlanInterface: string; // e.g. eth0.10
  ifbInterface: string; // e.g. ifb-v10 — mirrors this VLAN's ingress for upload shaping/accounting
  subnetCidr: string; // e.g. 10.50.10.0/24
  gatewayIp: string; // e.g. 10.50.10.1
}

function parseRouterVlans(): RouterVlanConfig[] {
  const raw = process.env.ROUTER_VLANS ?? "";
  const base = process.env.DHCP_POOL_BASE ?? "10.50";
  if (!raw.trim()) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [parentInterface, vlanIdStr, routerId] = entry.split(":");
      const vlanId = Number(vlanIdStr);
      if (!parentInterface || !Number.isInteger(vlanId) || vlanId < 1 || vlanId > 4094 || !routerId) {
        throw new Error(`Invalid ROUTER_VLANS entry: "${entry}". Expected parentIface:vlanId:routerId`);
      }
      return {
        parentInterface,
        vlanId,
        routerId,
        vlanInterface: `${parentInterface}.${vlanId}`,
        ifbInterface: `ifb-v${vlanId}`,
        subnetCidr: `${base}.${vlanId}.0/24`,
        gatewayIp: `${base}.${vlanId}.1`,
      };
    });
}

export const config = {
  port: Number(process.env.PORT ?? 8787),
  apiUrl: process.env.NETCAM_API_URL ?? "http://127.0.0.1:3000",
  sharedSecret: process.env.NETWORK_AGENT_SHARED_SECRET ?? "insecure-dev-secret",
  wanInterface: process.env.WAN_INTERFACE ?? "wlan0",
  routerVlans: parseRouterVlans(),
  dnsmasqConfDir: process.env.DNSMASQ_CONF_DIR ?? "/etc/dnsmasq.d",
  dnsmasqLeasesFile: process.env.DNSMASQ_LEASES_FILE ?? "/var/lib/misc/dnsmasq.leases",
  ttlSampleIntervalMs: Number(process.env.TTL_SAMPLE_INTERVAL_MS ?? 60_000),
  ttlSamplePacketCount: Number(process.env.TTL_SAMPLE_PACKET_COUNT ?? 8),
};
