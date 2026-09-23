import { Injectable } from "@nestjs/common";
import { PaymentStatus, RouterStatus, VoucherStatus } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";

const ONLINE_WINDOW_MS = 3 * 60 * 1000;

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async overview() {
    const now = new Date();
    const onlineCutoff = new Date(now.getTime() - ONLINE_WINDOW_MS);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [
      totalRouters,
      onlineRouters,
      activeSessions,
      activeVouchers,
      todayRevenue,
      todaySmsSent,
      recentAnomalies,
    ] = await Promise.all([
      this.prisma.router.count(),
      this.prisma.router.count({ where: { lastSeenAt: { gte: onlineCutoff } } }),
      this.prisma.session.count({ where: { endedAt: null } }),
      this.prisma.voucher.count({ where: { status: VoucherStatus.ACTIVE } }),
      this.prisma.payment.aggregate({
        where: { status: PaymentStatus.SUCCESS, completedAt: { gte: todayStart } },
        _sum: { amountUgx: true },
      }),
      this.prisma.smsLog.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.session.count({ where: { ttlAnomalyScore: { gte: 0.5 }, endedAt: null } }),
    ]);

    return {
      routers: { total: totalRouters, online: onlineRouters, offline: totalRouters - onlineRouters },
      activeSessions,
      activeVouchers,
      todayRevenueUgx: todayRevenue._sum.amountUgx ?? 0,
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
      where: { endedAt: null },
      _count: { _all: true },
    });
    const countByRouter = new Map(counts.map((c) => [c.routerId, c._count._all]));

    return routers.map((r) => ({ ...r, activeUsers: countByRouter.get(r.id) ?? 0 }));
  }
}
