import { Injectable, Logger } from "@nestjs/common";
import { VoucherStatus } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";
import { NetworkService } from "../network/network.service";
import { EarningsService } from "../payments/earnings.service";

const ONLINE_WINDOW_MS = 3 * 60 * 1000;

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly network: NetworkService,
    private readonly earnings: EarningsService,
  ) {}

  async overview() {
    const now = new Date();
    const onlineCutoff = new Date(now.getTime() - ONLINE_WINDOW_MS);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalRouters,
      onlineRouters,
      activeSessions,
      activeVouchers,
      todayRevenueUgx,
      todaySmsSent,
      recentAnomalies,
    ] = await Promise.all([
      this.prisma.router.count(),
      this.prisma.router.count({ where: { lastSeenAt: { gte: onlineCutoff } } }),
      this.prisma.session.count({ where: { endedAt: null, voucher: { status: VoucherStatus.ACTIVE } } }),
      this.prisma.voucher.count({ where: { status: VoucherStatus.ACTIVE } }),
      // Mobile money + printed vouchers sold for cash, by local calendar day.
      this.earnings.todayUgx(),
      this.prisma.smsLog.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.session.count({ where: { ttlAnomalyScore: { gte: 0.5 }, endedAt: null, voucher: { status: VoucherStatus.ACTIVE } } }),
    ]);

    // Devices actually on the WiFi right now (paid or waiting at the portal),
    // from the live network scan. Null when the network agent is unreachable.
    const live = await this.network.live().catch((err) => {
      this.logger.warn(`live network scan failed: ${(err as Error).message}`);
      return null;
    });

    return {
      routers: { total: totalRouters, online: onlineRouters, offline: totalRouters - onlineRouters },
      activeSessions,
      usersOnline: live
        ? { total: live.summary.devicesOnline, paid: live.summary.devicesPaid, atPortal: live.summary.devicesBlocked }
        : null,
      activeVouchers,
      todayRevenueUgx,
      todaySmsSent,
      suspectedResharing: recentAnomalies,
      generatedAt: now.toISOString(),
    };
  }

  /** Users grouped by the router they're currently attributed to (for the topology view). */
  async usersPerRouter() {
    const routers = await this.prisma.router.findMany({
      select: { id: true, name: true, status: true, vlanId: true },
    });
    const counts = await this.prisma.session.groupBy({
      by: ["routerId"],
      where: { endedAt: null, voucher: { status: VoucherStatus.ACTIVE } },
      _count: { _all: true },
    });
    const countByRouter = new Map(counts.map((c) => [c.routerId, c._count._all]));

    return routers.map((r) => ({ ...r, activeUsers: countByRouter.get(r.id) ?? 0 }));
  }
}
