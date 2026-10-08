import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { AlertSeverity, type AlertRecipient, type Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { MessengerService } from "../whatsapp/messenger.service";

export const ALERT_CATEGORIES = {
  PAYMENTS: "Payments & sales",
  FINANCE: "Withdrawals & money",
  NETWORK: "Internet & routers",
  POWER: "Power & battery",
  SYSTEM: "System health",
  SECURITY: "Security",
  CUSTOMERS: "Customer support",
  DAILY_SUMMARY: "Daily summary",
} as const;
export type AlertCategory = keyof typeof ALERT_CATEGORIES;

const RANK: Record<AlertSeverity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };
const DEFAULT_COOLDOWN_MINUTES = 30;
const TIMEZONE = process.env.APP_TIMEZONE ?? "Africa/Kampala";

export interface AlertInput {
  category: AlertCategory;
  severity: AlertSeverity;
  title: string;
  message: string;
  /** Same key within the cooldown = suppressed, so a flapping link doesn't spam anyone. */
  dedupeKey?: string;
  cooldownMinutes?: number;
}

function ugx(amount: number) {
  return `UGX ${Math.round(amount).toLocaleString("en-US")}`;
}

function gb(bytes: number) {
  return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messenger: MessengerService,
  ) {}

  /**
   * Records an alert and delivers it to every matching recipient. Never
   * throws: an alert must not be able to break the action that raised it.
   */
  async notify(input: AlertInput): Promise<void> {
    try {
      if (input.dedupeKey) {
        const since = new Date(Date.now() - (input.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES) * 60_000);
        const recent = await this.prisma.alertEvent.findFirst({
          where: { dedupeKey: input.dedupeKey, createdAt: { gte: since } },
          select: { id: true },
        });
        if (recent) return;
      }

      const event = await this.prisma.alertEvent.create({
        data: {
          category: input.category,
          severity: input.severity,
          title: input.title,
          message: input.message,
          dedupeKey: input.dedupeKey,
        },
      });

      const recipients = (await this.prisma.alertRecipient.findMany({ where: { enabled: true } })).filter(
        (r) =>
          (r.categories.length === 0 || r.categories.includes(input.category)) &&
          RANK[input.severity] >= RANK[r.minSeverity],
      );
      if (recipients.length === 0) return;

      const deliveries = await this.notifyRecipients(recipients, input);
      await this.prisma.alertEvent.update({
        where: { id: event.id },
        data: { deliveries: deliveries as unknown as Prisma.InputJsonValue },
      });
    } catch (err) {
      this.logger.error(`Raising alert "${input.title}" failed: ${(err as Error).message}`);
    }
  }

  /** Delivers to exactly these recipients (no category/severity filtering, no logging as an event). */
  async notifyRecipients(recipients: AlertRecipient[], input: AlertInput) {
    const prefix = input.severity === "CRITICAL" ? "URGENT: " : input.severity === "WARNING" ? "Warning: " : "";
    const deliveries = await Promise.all(
      recipients.map(async (r) => {
        const result = await this.messenger.send({
          phoneDigits: r.phoneNumber,
          name: r.name,
          subject: `${prefix}${input.title}`,
          message: input.message,
          whatsapp: r.whatsapp,
          sms: r.sms,
        });
        return { recipientId: r.id, name: r.name, ...result };
      }),
    );
    const failed = deliveries.filter((d) => !d.ok);
    if (failed.length) this.logger.warn(`Alert "${input.title}" not delivered to ${failed.map((f) => f.name).join(", ")}`);
    return deliveries;
  }

  /** End-of-day report: sales, customers, data and anything that went wrong today. */
  @Cron("0 21 * * *", { timeZone: TIMEZONE })
  async dailySummary() {
    const [startOfDay] = await this.prisma.$queryRaw<Array<{ start: Date }>>`
      SELECT ((date_trunc('day', now() AT TIME ZONE ${TIMEZONE})) AT TIME ZONE ${TIMEZONE}) AS start`.then((r) => r.map((x) => x.start));

    const [sales, newCustomers, activeSessions, usage, alerts] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { status: "SUCCESS", completedAt: { gte: startOfDay } },
        _count: true,
        _sum: { amountUgx: true },
      }),
      this.prisma.customer.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.session.count({ where: { endedAt: null } }),
      this.prisma.usageHourly.aggregate({
        where: { hour: { gte: startOfDay } },
        _sum: { bytesDown: true, bytesUp: true },
      }),
      this.prisma.alertEvent.count({
        where: { createdAt: { gte: startOfDay }, severity: { in: ["WARNING", "CRITICAL"] } },
      }),
    ]);

    const bytes = Number(usage._sum.bytesDown ?? 0) + Number(usage._sum.bytesUp ?? 0);
    await this.notify({
      category: "DAILY_SUMMARY",
      severity: "INFO",
      title: "Today's summary",
      message:
        `Sales: ${sales._count} payment(s), ${ugx(sales._sum.amountUgx ?? 0)}. ` +
        `New customers: ${newCustomers}. Online now: ${activeSessions}. ` +
        `Data used: ${gb(bytes)}. Problems today: ${alerts}.`,
      dedupeKey: `daily-summary:${startOfDay.toISOString()}`,
      cooldownMinutes: 12 * 60,
    });
  }
}
