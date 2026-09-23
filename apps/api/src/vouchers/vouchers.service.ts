import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { VoucherStatus } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { NetworkAgentBridgeService } from "../network-agent-bridge/network-agent-bridge.service";
import { generateVoucherCode } from "./voucher-code.util";
import type { GenerateVouchersDto } from "./dto/generate-vouchers.dto";
import type { RedeemVoucherDto } from "./dto/redeem-voucher.dto";

@Injectable()
export class VouchersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly networkAgent: NetworkAgentBridgeService,
  ) {}

  async findAll(params: { status?: VoucherStatus; batchLabel?: string }) {
    return this.prisma.voucher.findMany({
      where: { status: params.status, batchLabel: params.batchLabel },
      include: { package: true, devices: true },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  async findByCode(code: string) {
    const voucher = await this.prisma.voucher.findUnique({
      where: { code: this.normalizeCode(code) },
      include: { package: true, devices: true },
    });
    if (!voucher) throw new NotFoundException("Voucher not found");
    return voucher;
  }

  async generateBatch(dto: GenerateVouchersDto, adminUserId: string) {
    const pkg = await this.prisma.package.findUnique({ where: { id: dto.packageId } });
    if (!pkg) throw new BadRequestException("Unknown packageId");

    const codes = new Set<string>();
    while (codes.size < dto.count) {
      codes.add(generateVoucherCode());
    }

    await this.prisma.voucher.createMany({
      data: Array.from(codes).map((code) => ({
        code,
        packageId: dto.packageId,
        batchLabel: dto.batchLabel,
        generatedAtRouterId: dto.generatedAtRouterId,
      })),
    });

    await this.audit.log({
      adminUserId,
      action: "VOUCHER_BATCH_GENERATED",
      entityType: "Voucher",
      metadata: { count: dto.count, packageId: dto.packageId, batchLabel: dto.batchLabel },
    });

    return this.prisma.voucher.findMany({
      where: { code: { in: Array.from(codes) } },
      include: { package: true },
    });
  }

  /**
   * Core captive-portal redemption: validates the voucher, enforces the
   * per-voucher device limit (anti phone-sharing), activates it on first
   * use, opens/refreshes a Session, and tells the network-agent to admit
   * the MAC onto the network with the package's speed caps.
   */
  async redeem(dto: RedeemVoucherDto, routerId?: string) {
    const code = this.normalizeCode(dto.voucherCode);
    const voucher = await this.prisma.voucher.findUnique({
      where: { code },
      include: { package: true, devices: true },
    });
    if (!voucher) throw new NotFoundException("Voucher code not found");

    if (voucher.status === VoucherStatus.SUSPENDED) {
      throw new ForbiddenException("This voucher has been suspended");
    }
    if (voucher.status === VoucherStatus.EXPIRED || voucher.status === VoucherStatus.DEPLETED) {
      throw new ForbiddenException("This voucher is no longer valid");
    }

    const mac = dto.macAddress.toUpperCase();
    let device = voucher.devices.find((d) => d.macAddress === mac);

    if (!device) {
      const activeDeviceCount = voucher.devices.filter((d) => !d.isBlocked).length;
      if (activeDeviceCount >= voucher.package.deviceLimit) {
        throw new ForbiddenException(
          `This voucher is already in use on ${activeDeviceCount} device(s) (limit ${voucher.package.deviceLimit}). Buy another voucher to add a device.`,
        );
      }
      device = await this.prisma.device.create({
        data: { voucherId: voucher.id, macAddress: mac, userAgent: dto.userAgent },
      });
    } else if (device.isBlocked) {
      throw new ForbiddenException("This device has been blocked on this voucher");
    } else {
      await this.prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
    }

    const now = new Date();
    let expiresAt = voucher.expiresAt;
    if (voucher.status === VoucherStatus.UNUSED) {
      expiresAt = voucher.package.durationMinutes
        ? new Date(now.getTime() + voucher.package.durationMinutes * 60_000)
        : null;
      await this.prisma.voucher.update({
        where: { id: voucher.id },
        data: { status: VoucherStatus.ACTIVE, activatedAt: now, expiresAt },
      });
    } else if (expiresAt && expiresAt.getTime() < now.getTime()) {
      await this.prisma.voucher.update({ where: { id: voucher.id }, data: { status: VoucherStatus.EXPIRED } });
      throw new ForbiddenException("This voucher has expired");
    }

    await this.prisma.session.create({
      data: {
        deviceId: device.id,
        voucherId: voucher.id,
        routerId,
        ipAddress: dto.ipAddress,
      },
    });

    await this.networkAgent.admit({
      macAddress: mac,
      ipAddress: dto.ipAddress,
      routerId: routerId ?? "",
      voucherId: voucher.id,
      downKbps: voucher.package.downKbps,
      upKbps: voucher.package.upKbps,
      sessionExpiresAt: (expiresAt ?? new Date(now.getTime() + 24 * 60 * 60_000)).toISOString(),
    });

    return {
      ok: true,
      message: "Connected",
      sessionExpiresAt: expiresAt?.toISOString(),
      remainingDataMb: voucher.package.dataCapMb ? voucher.package.dataCapMb - voucher.dataUsedMb : undefined,
    };
  }

  /** Issues a single voucher tied to a paying customer's phone (used by the payments flow). */
  async issueForPayment(packageId: string, customerId: string) {
    const pkg = await this.prisma.package.findUnique({ where: { id: packageId } });
    if (!pkg) throw new BadRequestException("Unknown packageId");

    let code = generateVoucherCode();
    // Astronomically unlikely to collide, but guard anyway since code is unique.
    while (await this.prisma.voucher.findUnique({ where: { code } })) {
      code = generateVoucherCode();
    }

    return this.prisma.voucher.create({
      data: { code, packageId, customerId },
      include: { package: true },
    });
  }

  async suspend(id: string, adminUserId: string, reason: string) {
    const voucher = await this.prisma.voucher.findUnique({ where: { id }, include: { devices: true } });
    if (!voucher) throw new NotFoundException("Voucher not found");

    await this.prisma.voucher.update({ where: { id }, data: { status: VoucherStatus.SUSPENDED } });
    for (const device of voucher.devices) {
      await this.networkAgent.revoke({ macAddress: device.macAddress, reason });
    }
    await this.audit.log({ adminUserId, action: "VOUCHER_SUSPENDED", entityType: "Voucher", entityId: id, metadata: { reason } });
  }

  /** Per-device kill switch — blocks one device on a voucher without suspending the whole voucher. */
  async setDeviceBlocked(voucherId: string, deviceId: string, isBlocked: boolean, adminUserId: string) {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device || device.voucherId !== voucherId) {
      throw new NotFoundException("Device not found on this voucher");
    }

    const updated = await this.prisma.device.update({ where: { id: deviceId }, data: { isBlocked } });

    if (isBlocked) {
      await this.networkAgent.revoke({ macAddress: device.macAddress, reason: "device blocked by admin" });
      await this.prisma.session.updateMany({ where: { deviceId, endedAt: null }, data: { endedAt: new Date() } });
    }

    await this.audit.log({
      adminUserId,
      action: isBlocked ? "DEVICE_BLOCKED" : "DEVICE_UNBLOCKED",
      entityType: "Device",
      entityId: deviceId,
      metadata: { voucherId, macAddress: device.macAddress },
    });

    return updated;
  }

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }
}
