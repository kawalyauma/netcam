import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { RouterStatus, VoucherStatus } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NetworkAgentBridgeService, type AgentNetworkStatus } from "../network-agent-bridge/network-agent-bridge.service";

export type DeviceAccess = "PAID" | "BLOCKED";
export type RouterOnlineReason = "ping" | "clients" | "downstream";

interface LiveRouter {
  id: string;
  name: string;
  model: string | null;
  location: string | null;
  macAddress: string | null;
  ipAddress: string | null;
  parentRouterId: string | null;
  status: RouterStatus;
  onlineReason: RouterOnlineReason | null;
  pingMs: number | null;
  lastSeenAt: Date | null;
  /** True for routers plugged straight into this box (the agent heartbeats them). */
  isSegmentRoot: boolean;
  children: LiveRouter[];
}

@Injectable()
export class NetworkService {
  private readonly logger = new Logger(NetworkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: NetworkAgentBridgeService,
  ) {}

  /**
   * Chained routers share the root router's flat LAN, so the agent never
   * heartbeats them. Probe them every minute so their ONLINE/OFFLINE status
   * (and the dashboard's "routers online" count) reflects reality.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async refreshRouterPresence() {
    await this.probe().catch((err) => this.logger.warn(`router presence probe failed: ${(err as Error).message}`));
  }

  async live() {
    const { status, routers, presence } = await this.probe();
    const segmentRootIds = new Set(status.interfaces.map((i) => i.routerId));
    const reachability = new Map(status.routers.map((r) => [r.id, r]));

    const routerMacs = new Set(routers.map((r) => r.macAddress?.toUpperCase()).filter(Boolean) as string[]);
    const routerIps = new Set(status.routers.map((r) => r.ipAddress).filter(Boolean) as string[]);

    const liveById = new Map<string, LiveRouter>();
    for (const r of routers) {
      const probe = reachability.get(r.id);
      const reason = presence.get(r.id) ?? null;
      // Without a probe target or clients to vouch for it, a router's state
      // genuinely can't be known on a flat LAN; say so instead of guessing.
      const routerStatus = reason
        ? RouterStatus.ONLINE
        : r.ipAddress || r.macAddress || segmentRootIds.has(r.id)
          ? RouterStatus.OFFLINE
          : RouterStatus.UNKNOWN;

      liveById.set(r.id, {
        id: r.id,
        name: r.name,
        model: r.model,
        location: r.location,
        macAddress: r.macAddress,
        ipAddress: probe?.ipAddress ?? r.ipAddress,
        parentRouterId: r.parentRouterId,
        status: routerStatus,
        onlineReason: reason,
        pingMs: probe?.pingMs ?? null,
        lastSeenAt: r.lastSeenAt,
        isSegmentRoot: segmentRootIds.has(r.id),
        children: [],
      });
    }
    const tree: LiveRouter[] = [];
    for (const r of liveById.values()) {
      const parent = r.parentRouterId ? liveById.get(r.parentRouterId) : undefined;
      if (parent) parent.children.push(r);
      else tree.push(r);
    }

    const onlineClients = this.clientDevices(status, routerMacs, routerIps);
    const onlineMacs = new Set(onlineClients.map((d) => d.macAddress));

    // Customers with paid time left who aren't on the WiFi right now (walked
    // away, phone asleep). Listed so "paid" reconciles with active sessions.
    const openSessions = await this.prisma.session.findMany({
      where: { endedAt: null, voucher: { status: VoucherStatus.ACTIVE } },
      include: { device: true },
    });
    const paidAwayMacs = [...new Set(openSessions.map((s) => s.device.macAddress.toUpperCase()))].filter((m) => !onlineMacs.has(m));

    const known = await this.prisma.device.findMany({
      where: { macAddress: { in: [...onlineMacs, ...paidAwayMacs], mode: "insensitive" } },
      include: { voucher: { include: { package: true, customer: true } } },
      orderBy: { lastSeenAt: "desc" },
    });
    const knownByMac = new Map<string, (typeof known)[number]>();
    for (const d of known) {
      const mac = d.macAddress.toUpperCase();
      if (!knownByMac.has(mac)) knownByMac.set(mac, d);
    }
    const voucherOf = (mac: string) => {
      const record = knownByMac.get(mac);
      return {
        isBlockedByAdmin: record?.isBlocked ?? false,
        voucher: record
          ? {
              code: record.voucher.code,
              status: record.voucher.status,
              packageName: record.voucher.package.name,
              expiresAt: record.voucher.expiresAt,
              customerPhone: record.voucher.customer?.phoneNumber ?? null,
            }
          : null,
      };
    };
    const leaseByMac = new Map(status.devices.map((d) => [d.macAddress, d]));

    const devices = [
      ...onlineClients.map((d) => ({
        macAddress: d.macAddress,
        ipAddress: d.ipAddress,
        hostname: d.hostname,
        interfaceName: d.interfaceName,
        pingMs: d.pingMs,
        online: true,
        access: (d.authorized ? "PAID" : "BLOCKED") as DeviceAccess,
        ...voucherOf(d.macAddress),
      })),
      ...paidAwayMacs.map((mac) => ({
        macAddress: mac,
        ipAddress: leaseByMac.get(mac)?.ipAddress ?? null,
        hostname: leaseByMac.get(mac)?.hostname ?? null,
        interfaceName: null,
        pingMs: null,
        online: false,
        access: "PAID" as DeviceAccess,
        ...voucherOf(mac),
      })),
    ].sort((a, b) => {
      const rank = (d: { online: boolean; access: DeviceAccess }) => (d.access === "PAID" ? (d.online ? 0 : 2) : 1);
      return rank(a) - rank(b) || (a.ipAddress ?? "").localeCompare(b.ipAddress ?? "", undefined, { numeric: true });
    });

    const flat = [...liveById.values()];
    const online = devices.filter((d) => d.online);
    return {
      generatedAt: status.generatedAt,
      segments: status.interfaces,
      summary: {
        routersOnline: flat.filter((r) => r.status === RouterStatus.ONLINE).length,
        routersTotal: flat.length,
        devicesOnline: online.length,
        devicesPaid: online.filter((d) => d.access === "PAID").length,
        devicesBlocked: online.filter((d) => d.access === "BLOCKED").length,
        paidTotal: devices.filter((d) => d.access === "PAID").length,
      },
      routers: tree,
      devices,
    };
  }

  private clientDevices(status: AgentNetworkStatus, routerMacs: Set<string>, routerIps: Set<string>) {
    return status.devices.filter(
      (d) => d.online && !routerMacs.has(d.macAddress) && !(d.ipAddress && routerIps.has(d.ipAddress)),
    );
  }

  /**
   * Which routers are provably up, and how we know. On a flat chained LAN a
   * router in AP/bridge mode often has no address of its own to ping, but
   * clients can only reach this box *through* the chain: any online client on
   * a segment proves that segment's root router is up, and any online router
   * proves every router above it in the chain is up.
   */
  private inferPresence(status: AgentNetworkStatus, routers: Array<{ id: string; macAddress: string | null; parentRouterId: string | null }>) {
    const presence = new Map<string, RouterOnlineReason>();
    for (const r of status.routers) if (r.reachable) presence.set(r.id, "ping");

    const routerMacs = new Set(routers.map((r) => r.macAddress?.toUpperCase()).filter(Boolean) as string[]);
    const routerIps = new Set(status.routers.map((r) => r.ipAddress).filter(Boolean) as string[]);
    const clients = this.clientDevices(status, routerMacs, routerIps);
    for (const seg of status.interfaces) {
      if (!presence.has(seg.routerId) && clients.some((d) => d.interfaceName === seg.interfaceName)) {
        presence.set(seg.routerId, "clients");
      }
    }

    const byId = new Map(routers.map((r) => [r.id, r]));
    for (const id of [...presence.keys()]) {
      let parentId = byId.get(id)?.parentRouterId;
      const seen = new Set<string>([id]);
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        if (!presence.has(parentId)) presence.set(parentId, "downstream");
        parentId = byId.get(parentId)?.parentRouterId;
      }
    }
    return presence;
  }

  private async probe() {
    const routers = await this.loadRouters();
    const status = await this.agent.networkStatus(
      routers.map((r) => ({ id: r.id, ipAddress: r.ipAddress, macAddress: r.macAddress })),
    );
    const presence = this.inferPresence(status, routers);
    if (presence.size) {
      await this.prisma.router.updateMany({
        where: { id: { in: [...presence.keys()] } },
        data: { lastSeenAt: new Date(), status: RouterStatus.ONLINE },
      });
    }
    return { status, routers, presence };
  }

  private loadRouters() {
    return this.prisma.router.findMany({ orderBy: { createdAt: "asc" } });
  }
}
