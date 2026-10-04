import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { NetworkAgentBridgeService } from "../network-agent-bridge/network-agent-bridge.service";
import { deviceType } from "./device-type.util";

const TIMEZONE = process.env.APP_TIMEZONE ?? "Africa/Kampala";
const RETENTION_DAYS = 90;

const RANGES = {
  "24h": { bucket: "hour", span: "23 hours" },
  "7d": { bucket: "day", span: "6 days" },
  "30d": { bucket: "day", span: "29 days" },
} as const;
export type UsageRange = keyof typeof RANGES;

interface DeviceInfo {
  label: string;
  deviceType: string;
  hostname: string | null;
  phoneNumber: string | null;
  customerName: string | null;
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agent: NetworkAgentBridgeService,
  ) {}

  /** Who each MAC belongs to, from the most recent device record bound to it. */
  private async describeDevices(macs: string[]): Promise<Map<string, DeviceInfo & { session?: SessionInfo }>> {
    if (macs.length === 0) return new Map();
    const devices = await this.prisma.device.findMany({
      where: { macAddress: { in: macs } },
      orderBy: { lastSeenAt: "desc" },
      include: {
        voucher: { include: { package: true, customer: true } },
        sessions: { where: { endedAt: null }, take: 1 },
      },
    });

    const result = new Map<string, DeviceInfo & { session?: SessionInfo }>();
    for (const d of devices) {
      if (result.has(d.macAddress)) continue;
      const customer = d.voucher.customer;
      const open = d.sessions[0];
      result.set(d.macAddress, {
        label: customer?.name ?? customer?.phoneNumber ?? d.hostname ?? d.macAddress,
        deviceType: deviceType(d.userAgent, d.hostname),
        hostname: d.hostname,
        phoneNumber: customer?.phoneNumber ?? null,
        customerName: customer?.name ?? null,
        session: open
          ? {
              voucherCode: d.voucher.code,
              packageName: d.voucher.package.name,
              speedLimitDownKbps: d.voucher.package.downKbps,
              speedLimitUpKbps: d.voucher.package.upKbps,
              expiresAt: d.voucher.expiresAt?.toISOString() ?? null,
              dataUsedMb: d.voucher.dataUsedMb,
              dataCapMb: d.voucher.package.dataCapMb,
              startedAt: open.startedAt.toISOString(),
            }
          : undefined,
      });
    }
    return result;
  }

  /** The live view: 5-second rates per online device, with who they are and what they bought. */
  async live() {
    let snapshot: Awaited<ReturnType<NetworkAgentBridgeService["usageLive"]>>;
    try {
      snapshot = await this.agent.usageLive();
    } catch (err) {
      throw new ServiceUnavailableException(`Network agent unreachable: ${(err as Error).message}`);
    }

    const info = await this.describeDevices(snapshot.devices.map((d) => d.macAddress));
    const devices = snapshot.devices
      .map((d) => {
        const i = info.get(d.macAddress);
        return {
          ...d,
          label: i?.label ?? d.hostname ?? d.macAddress,
          deviceType: i?.deviceType ?? deviceType(null, d.hostname),
          phoneNumber: i?.phoneNumber ?? null,
          customerName: i?.customerName ?? null,
          session: i?.session ?? null,
        };
      })
      .sort((a, b) => b.downBps + b.upBps - (a.downBps + a.upBps) || b.totalDown - a.totalDown);

    return { generatedAt: snapshot.generatedAt, tickMs: snapshot.tickMs, network: snapshot.network, devices };
  }

  /** History for the whole network, or one device when `mac` is given. */
  async summary(range: string, mac?: string) {
    const spec = RANGES[range as UsageRange];
    if (!spec) throw new BadRequestException(`range must be one of ${Object.keys(RANGES).join(", ")}`);
    const macFilter = mac ? Prisma.sql`AND "macAddress" = ${mac.toUpperCase()}` : Prisma.empty;

    // Buckets are local (Kampala) hours/days; "hour" is stored as UTC.
    const bounds = Prisma.sql`
      bounds AS (
        SELECT date_trunc(${spec.bucket}, now() AT TIME ZONE ${TIMEZONE}) - ${spec.span}::interval AS start_local
      ),
      scoped AS (
        SELECT u.*, date_trunc(${spec.bucket}, (u."hour" AT TIME ZONE 'UTC') AT TIME ZONE ${TIMEZONE}) AS bucket
        FROM "UsageHourly" u, bounds
        WHERE u."hour" >= ((bounds.start_local AT TIME ZONE ${TIMEZONE}) AT TIME ZONE 'UTC') ${macFilter}
      )`;

    const [series, byApp, byDevice] = await Promise.all([
      this.prisma.$queryRaw<Array<{ t: string; down: number; up: number }>>`
        WITH ${bounds},
        buckets AS (
          SELECT generate_series(bounds.start_local, date_trunc(${spec.bucket}, now() AT TIME ZONE ${TIMEZONE}), ('1 ' || ${spec.bucket})::interval) AS bucket
          FROM bounds
        )
        SELECT to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI') AS t,
               COALESCE(SUM(s."bytesDown"), 0)::float8 AS down,
               COALESCE(SUM(s."bytesUp"), 0)::float8 AS up
        FROM buckets b LEFT JOIN scoped s ON s.bucket = b.bucket
        GROUP BY b.bucket ORDER BY b.bucket`,
      this.prisma.$queryRaw<Array<{ app: string; down: number; up: number }>>`
        WITH ${bounds}
        SELECT app, SUM("bytesDown")::float8 AS down, SUM("bytesUp")::float8 AS up
        FROM scoped GROUP BY app ORDER BY SUM("bytesDown" + "bytesUp") DESC`,
      this.prisma.$queryRaw<Array<{ macAddress: string; down: number; up: number }>>`
        WITH ${bounds}
        SELECT "macAddress", SUM("bytesDown")::float8 AS down, SUM("bytesUp")::float8 AS up
        FROM scoped GROUP BY "macAddress" ORDER BY SUM("bytesDown" + "bytesUp") DESC`,
    ]);

    const info = await this.describeDevices(byDevice.map((d) => d.macAddress));
    const devices = byDevice.map((d) => {
      const i = info.get(d.macAddress);
      return {
        macAddress: d.macAddress,
        label: i?.label ?? d.macAddress,
        deviceType: i?.deviceType ?? "Unknown",
        phoneNumber: i?.phoneNumber ?? null,
        hostname: i?.hostname ?? null,
        down: d.down,
        up: d.up,
      };
    });

    const byDeviceType = new Map<string, { deviceType: string; down: number; up: number; devices: number }>();
    for (const d of devices) {
      const row = byDeviceType.get(d.deviceType) ?? { deviceType: d.deviceType, down: 0, up: 0, devices: 0 };
      row.down += d.down;
      row.up += d.up;
      row.devices += 1;
      byDeviceType.set(d.deviceType, row);
    }

    return {
      range,
      bucket: spec.bucket,
      timezone: TIMEZONE,
      totals: {
        down: series.reduce((s, p) => s + p.down, 0),
        up: series.reduce((s, p) => s + p.up, 0),
        devices: devices.length,
      },
      series,
      byApp,
      byDeviceType: [...byDeviceType.values()].sort((a, b) => b.down + b.up - (a.down + a.up)),
      topDevices: devices.slice(0, 20),
    };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async pruneOldUsage() {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60_000);
    const { count } = await this.prisma.usageHourly.deleteMany({ where: { hour: { lt: cutoff } } });
    if (count) this.logger.log(`Pruned ${count} usage row(s) older than ${RETENTION_DAYS} days`);
  }
}

interface SessionInfo {
  voucherCode: string;
  packageName: string;
  speedLimitDownKbps: number;
  speedLimitUpKbps: number;
  expiresAt: string | null;
  dataUsedMb: number;
  dataCapMb: number | null;
  startedAt: string;
}
