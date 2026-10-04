import { Injectable } from "@nestjs/common";
import { PaymentStatus } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";

/** Earnings are bucketed by the operator's local calendar day, not UTC. */
export const TIME_ZONE = process.env.BUSINESS_TIME_ZONE ?? "Africa/Kampala";
const DAY_MS = 24 * 60 * 60 * 1000;

export const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Where a sale's money came in: a mobile-money/manual Payment, or a printed voucher sold for cash. */
export type SaleSource = "SSENTEZO" | "MANUAL" | "VOUCHER";

interface Sale {
  amountUgx: number;
  at: Date;
  source: SaleSource;
  packageId: string;
  packageName: string;
}

@Injectable()
export class EarningsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every sale in the window, from both channels:
   *  - successful Payments, at their amount, on the day they completed;
   *  - printed (batch) vouchers with no Payment behind them, which were sold
   *    for cash off the system — counted at their package's price on the day
   *    they were first redeemed, the only moment the system knows of the sale.
   * A voucher issued for a Payment is only counted through the Payment.
   */
  async sales(since: Date): Promise<Sale[]> {
    const [payments, vouchers] = await Promise.all([
      this.prisma.payment.findMany({
        where: { status: PaymentStatus.SUCCESS, OR: [{ completedAt: { gte: since } }, { completedAt: null, createdAt: { gte: since } }] },
        select: { amountUgx: true, completedAt: true, createdAt: true, provider: true, package: { select: { id: true, name: true } } },
      }),
      this.prisma.voucher.findMany({
        where: { activatedAt: { gte: since }, payment: null },
        select: { activatedAt: true, package: { select: { id: true, name: true, priceUgx: true } } },
      }),
    ]);
    return [
      ...payments.map((p) => ({
        amountUgx: p.amountUgx,
        at: p.completedAt ?? p.createdAt,
        source: p.provider as SaleSource,
        packageId: p.package.id,
        packageName: p.package.name,
      })),
      ...vouchers.map((v) => ({
        amountUgx: v.package.priceUgx,
        at: v.activatedAt as Date,
        source: "VOUCHER" as const,
        packageId: v.package.id,
        packageName: v.package.name,
      })),
    ];
  }

  /** Today's takings (local day), both channels — used by the overview tile. */
  async todayUgx() {
    const today = dayKey.format(new Date());
    const sales = await this.sales(new Date(Date.now() - 2 * DAY_MS));
    return sales.filter((s) => dayKey.format(s.at) === today).reduce((sum, s) => sum + s.amountUgx, 0);
  }

  async summary(rangeDays: number) {
    const days = Math.min(Math.max(Math.floor(rangeDays) || 30, 7), 365);
    const now = new Date();
    // Pad by a day so the oldest local day is fully covered whatever the UTC offset.
    const since = new Date(now.getTime() - (days + 1) * DAY_MS);

    const [sales, statusCounts, allTimePayments, allTimeVouchers] = await Promise.all([
      this.sales(since),
      this.prisma.payment.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.payment.aggregate({ where: { status: PaymentStatus.SUCCESS }, _sum: { amountUgx: true }, _count: { _all: true } }),
      this.prisma.voucher.findMany({
        where: { activatedAt: { not: null }, payment: null },
        select: { package: { select: { priceUgx: true } } },
      }),
    ]);

    const keys: string[] = [];
    for (let i = days - 1; i >= 0; i--) keys.push(dayKey.format(new Date(now.getTime() - i * DAY_MS)));
    const daily = new Map(keys.map((k) => [k, { date: k, revenueUgx: 0, mobileMoneyUgx: 0, voucherUgx: 0, payments: 0 }]));
    const byPackage = new Map<string, { packageId: string; name: string; revenueUgx: number; payments: number }>();
    const bySource = new Map<SaleSource, { source: SaleSource; revenueUgx: number; sales: number }>();

    const todayKey = keys[keys.length - 1];
    const weekKeys = new Set(keys.slice(-7));
    let todayUgx = 0;
    let weekUgx = 0;
    let rangeUgx = 0;
    let rangeCount = 0;

    for (const s of sales) {
      const key = dayKey.format(s.at);
      const bucket = daily.get(key);
      if (!bucket) continue; // falls in the padding day, outside the range
      bucket.revenueUgx += s.amountUgx;
      if (s.source === "VOUCHER") bucket.voucherUgx += s.amountUgx;
      else bucket.mobileMoneyUgx += s.amountUgx;
      bucket.payments += 1;
      rangeUgx += s.amountUgx;
      rangeCount += 1;
      if (key === todayKey) todayUgx += s.amountUgx;
      if (weekKeys.has(key)) weekUgx += s.amountUgx;

      const pkg = byPackage.get(s.packageId) ?? { packageId: s.packageId, name: s.packageName, revenueUgx: 0, payments: 0 };
      pkg.revenueUgx += s.amountUgx;
      pkg.payments += 1;
      byPackage.set(s.packageId, pkg);

      const src = bySource.get(s.source) ?? { source: s.source, revenueUgx: 0, sales: 0 };
      src.revenueUgx += s.amountUgx;
      src.sales += 1;
      bySource.set(s.source, src);
    }

    const counts = Object.fromEntries(statusCounts.map((s) => [s.status, s._count._all])) as Partial<Record<PaymentStatus, number>>;
    const attempted = (counts.SUCCESS ?? 0) + (counts.FAILED ?? 0) + (counts.CANCELLED ?? 0);
    const allTimeVoucherUgx = allTimeVouchers.reduce((sum, v) => sum + v.package.priceUgx, 0);

    return {
      rangeDays: days,
      timeZone: TIME_ZONE,
      totals: {
        todayUgx,
        last7DaysUgx: weekUgx,
        rangeUgx,
        allTimeUgx: (allTimePayments._sum.amountUgx ?? 0) + allTimeVoucherUgx,
        averagePerDayUgx: Math.round(rangeUgx / days),
        averagePaymentUgx: rangeCount ? Math.round(rangeUgx / rangeCount) : 0,
      },
      counts: {
        success: counts.SUCCESS ?? 0,
        pending: counts.PENDING ?? 0,
        failed: counts.FAILED ?? 0,
        cancelled: counts.CANCELLED ?? 0,
        allTimeSuccess: allTimePayments._count._all,
        vouchersSold: bySource.get("VOUCHER")?.sales ?? 0,
        successRate: attempted ? (counts.SUCCESS ?? 0) / attempted : null,
      },
      daily: [...daily.values()],
      byPackage: [...byPackage.values()].sort((a, b) => b.revenueUgx - a.revenueUgx),
      bySource: [...bySource.values()].sort((a, b) => b.revenueUgx - a.revenueUgx),
    };
  }
}
