import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { VoucherStatus } from "@netcam/shared";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { NetworkAgentBridgeService } from "../network-agent-bridge/network-agent-bridge.service";
import { scoreTtlAnomaly } from "./ttl-fingerprint.util";
import type { ReportTrafficDto } from "./dto/report-traffic.dto";

const RESHARE_SUSPICION_THRESHOLD = 0.5;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly networkAgent: NetworkAgentBridgeService,
  ) {}

  findActive() {
    return this.prisma.session.findMany({
      where: { endedAt: null },
      include: { device: true, router: true, voucher: { include: { package: true } } },
      orderBy: { startedAt: "desc" },
    });
  }

  /** Ingests periodic traffic/TTL samples pushed by the network-agent. */
  async reportTraffic(dto: ReportTrafficDto) {
    const usageRows: Prisma.Sql[] = [];
    const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);

    for (const sample of dto.samples) {
      const mac = sample.macAddress.toUpperCase();
      // The open session is what's being billed right now; a MAC can also
      // appear on older, expired vouchers.
      const session = await this.prisma.session.findFirst({
        where: { endedAt: null, device: { macAddress: mac } },
        orderBy: { startedAt: "desc" },
        include: { device: true },
      });

      const bytesUp = Math.max(0, Math.round(sample.bytesUp));
      const bytesDown = Math.max(0, Math.round(sample.bytesDown));

      const apps = sample.apps?.length ? sample.apps : [{ app: "Other", bytesUp, bytesDown }];
      for (const a of apps) {
        const down = Math.max(0, Math.round(a.bytesDown));
        const up = Math.max(0, Math.round(a.bytesUp));
        if (down + up === 0) continue;
        usageRows.push(Prisma.sql`(${hour}, ${mac}, ${a.app}, ${BigInt(down)}, ${BigInt(up)}, ${session?.voucherId ?? null})`);
      }

      if (!session) continue;
      if (sample.hostname && sample.hostname !== session.device.hostname) {
        await this.prisma.device.update({ where: { id: session.deviceId }, data: { hostname: sample.hostname } });
      }
      const anomalyScore = sample.observedTtls?.length ? scoreTtlAnomaly(sample.observedTtls) : session.ttlAnomalyScore;

      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          bytesUp: { increment: BigInt(bytesUp) },
          bytesDown: { increment: BigInt(bytesDown) },
          ttlAnomalyScore: anomalyScore,
        },
      });

      if (bytesUp + bytesDown > 0) {
        // Only real traffic counts as "seen": an idle or absent device must
        // age out so its slot can be handed over (see VouchersService).
        await this.prisma.device.update({ where: { id: session.deviceId }, data: { lastSeenAt: new Date() } });
        // Incremented, not recomputed from this session: a voucher's usage
        // spans every session and device, and reconnecting starts a new session.
        await this.prisma.voucher.update({
          where: { id: session.voucherId },
          data: { dataUsedMb: { increment: (bytesUp + bytesDown) / (1024 * 1024) } },
        });
      }

      // Only on a fresh sample that crosses the threshold: re-flagging the
      // carried-over score every minute (e.g. while the device is idle and
      // nothing was sampled) floods the audit log without new evidence.
      const crossed = anomalyScore >= RESHARE_SUSPICION_THRESHOLD && session.ttlAnomalyScore < RESHARE_SUSPICION_THRESHOLD;
      if (sample.observedTtls?.length && crossed) {
        await this.flagPossibleResharing(session.voucherId, session.device.macAddress, anomalyScore);
      }
    }

    if (usageRows.length) {
      await this.prisma.$executeRaw`
        INSERT INTO "UsageHourly" ("hour", "macAddress", "app", "bytesDown", "bytesUp", "voucherId")
        VALUES ${Prisma.join(usageRows)}
        ON CONFLICT ("hour", "macAddress", "app") DO UPDATE SET
          "bytesDown" = "UsageHourly"."bytesDown" + EXCLUDED."bytesDown",
          "bytesUp" = "UsageHourly"."bytesUp" + EXCLUDED."bytesUp",
          "voucherId" = COALESCE(EXCLUDED."voucherId", "UsageHourly"."voucherId")`;
    }
    return { ok: true };
  }

  private async flagPossibleResharing(voucherId: string, macAddress: string, score: number) {
    this.logger.warn(`Possible connection re-sharing on voucher ${voucherId} via MAC ${macAddress} (score ${score.toFixed(2)})`);
    await this.audit.log({
      action: "RESHARE_SUSPECTED",
      entityType: "Voucher",
      entityId: voucherId,
      metadata: { macAddress, score },
    });
    // Flagged for admin review rather than auto-killed, to avoid false
    // positives from legit multi-NIC devices (e.g. laptops with VMs)
    // cutting off a paying customer. The dashboard surfaces this via the
    // session's ttlAnomalyScore for a human to suspend if warranted.
  }

  /** Expire vouchers/sessions past their deadline and revoke network access. */
  @Cron(CronExpression.EVERY_MINUTE)
  async expireOverdue() {
    const now = new Date();
    const expired = await this.prisma.voucher.findMany({
      where: { status: VoucherStatus.ACTIVE, expiresAt: { lt: now } },
      include: { devices: true },
    });

    for (const voucher of expired) {
      await this.prisma.voucher.update({ where: { id: voucher.id }, data: { status: VoucherStatus.EXPIRED } });
      await this.prisma.session.updateMany({ where: { voucherId: voucher.id, endedAt: null }, data: { endedAt: now } });
      for (const device of voucher.devices) {
        await this.networkAgent.revoke({ macAddress: device.macAddress, reason: "voucher expired" });
      }
    }

    const overCap = await this.prisma.voucher.findMany({
      where: { status: VoucherStatus.ACTIVE, package: { dataCapMb: { not: null } } },
      include: { devices: true, package: true },
    });
    for (const voucher of overCap) {
      if (voucher.dataUsedMb < (voucher.package.dataCapMb ?? Infinity)) continue;
      await this.prisma.voucher.update({ where: { id: voucher.id }, data: { status: VoucherStatus.DEPLETED } });
      await this.prisma.session.updateMany({ where: { voucherId: voucher.id, endedAt: null }, data: { endedAt: now } });
      for (const device of voucher.devices) {
        await this.networkAgent.revoke({ macAddress: device.macAddress, reason: "data allowance used up" });
      }
    }

    // Self-heal: a session can only be open while its voucher is ACTIVE. Any
    // other path that moves a voucher out of ACTIVE (manual edits, older
    // code) would otherwise leave it counted as an active session forever.
    const orphaned = await this.prisma.session.updateMany({
      where: { endedAt: null, voucher: { status: { not: VoucherStatus.ACTIVE } } },
      data: { endedAt: now },
    });
    if (orphaned.count) this.logger.log(`Closed ${orphaned.count} session(s) left open on inactive vouchers`);
  }
}
