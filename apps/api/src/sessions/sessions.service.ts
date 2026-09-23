import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { VoucherStatus } from "@netcam/shared";
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
    for (const sample of dto.samples) {
      const device = await this.prisma.device.findFirst({
        where: { macAddress: sample.macAddress.toUpperCase() },
        orderBy: { lastSeenAt: "desc" },
      });
      if (!device) continue;

      const session = await this.prisma.session.findFirst({
        where: { deviceId: device.id, endedAt: null },
        orderBy: { startedAt: "desc" },
      });
      if (!session) continue;

      const anomalyScore = sample.observedTtls?.length ? scoreTtlAnomaly(sample.observedTtls) : session.ttlAnomalyScore;

      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          bytesUp: { increment: BigInt(Math.max(0, Math.round(sample.bytesUp))) },
          bytesDown: { increment: BigInt(Math.max(0, Math.round(sample.bytesDown))) },
          ttlAnomalyScore: anomalyScore,
        },
      });

      await this.prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });

      const dataMb = (Number(session.bytesUp) + Number(session.bytesDown) + sample.bytesUp + sample.bytesDown) / (1024 * 1024);
      await this.prisma.voucher.update({ where: { id: session.voucherId }, data: { dataUsedMb: dataMb } });

      if (anomalyScore >= RESHARE_SUSPICION_THRESHOLD) {
        await this.flagPossibleResharing(session.voucherId, device.macAddress, anomalyScore);
      }
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
  }
}
