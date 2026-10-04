import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PaymentStatus, VoucherStatus } from "@netcam/shared";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { NetworkAgentBridgeService } from "../network-agent-bridge/network-agent-bridge.service";
import { generateVoucherCode } from "./voucher-code.util";
import type { GenerateVouchersDto } from "./dto/generate-vouchers.dto";
import type { RedeemVoucherDto } from "./dto/redeem-voucher.dto";

const FALLBACK_SESSION_TTL_MS = 24 * 60 * 60_000;
/**
 * A device that hasn't moved any traffic for this long can hand its slot on
 * a full voucher to a new device. Covers phones that re-randomize their MAC
 * ("forget network", OS updates) without letting two devices share a
 * single-device voucher at the same time.
 */
const DEVICE_SLOT_STALE_MS = 10 * 60_000;
/**
 * Many phones (Samsung especially) join with a new random MAC each time they
 * reconnect. A new MAC announcing the same device name as a paid device that
 * was active this recently, and that has since left the network, is treated
 * as that same device and logged straight in.
 */
const MAC_HANDOVER_WINDOW_MS = 15 * 60_000;
// Names too common to identify one device.
const GENERIC_HOSTNAMES = new Set(["android", "iphone", "ipad", "localhost", "unknown", "*"]);

export interface DeviceContext {
  macAddress: string;
  ipAddress?: string;
  routerId?: string;
  /** DHCP hostname the device announced, e.g. "Galaxy-Tab-A7-Lite". */
  hostname?: string;
}

function voucherUsable(voucher: { expiresAt: Date | null; dataUsedMb: number; package: { dataCapMb: number | null } }, now: Date) {
  return (
    (!voucher.expiresAt || voucher.expiresAt > now) &&
    (!voucher.package.dataCapMb || voucher.dataUsedMb < voucher.package.dataCapMb)
  );
}

export interface AutoLoginResult {
  authorized: boolean;
  voucherCode?: string;
  expiresAt?: string;
  remainingDataMb?: number;
}

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
    const now = new Date();
    let device = voucher.devices.find((d) => d.macAddress === mac);

    if (device?.isBlocked) {
      throw new ForbiddenException("This device has been blocked on this voucher");
    }
    if (!device || device.releasedAt) {
      await this.freeSlotIfFull(voucher, mac, now);
      device = device
        ? await this.prisma.device.update({
            where: { id: device.id },
            data: {
              releasedAt: null,
              lastSeenAt: now,
              userAgent: dto.userAgent ?? device.userAgent,
              hostname: dto.hostname ?? device.hostname,
            },
          })
        : await this.prisma.device.create({
            data: { voucherId: voucher.id, macAddress: mac, userAgent: dto.userAgent, hostname: dto.hostname },
          });
    } else {
      await this.prisma.device.update({
        where: { id: device.id },
        data: { lastSeenAt: now, hostname: dto.hostname ?? device.hostname },
      });
    }

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

    // Re-redeeming (reconnecting, portal reload) replaces the device's open
    // session rather than stacking another one on top of it.
    await this.prisma.session.updateMany({ where: { deviceId: device.id, endedAt: null }, data: { endedAt: now } });
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
      sessionExpiresAt: (expiresAt ?? new Date(now.getTime() + FALLBACK_SESSION_TTL_MS)).toISOString(),
    });

    return {
      ok: true,
      message: "Connected",
      sessionExpiresAt: expiresAt?.toISOString(),
      remainingDataMb: voucher.package.dataCapMb ? voucher.package.dataCapMb - voucher.dataUsedMb : undefined,
    };
  }

  /**
   * Logs a device in without asking for a voucher code, if it's already
   * entitled: either bound to a still-valid voucher, or the device that paid
   * for a voucher nobody has redeemed yet (customer closed the portal while
   * the payment was confirming). Idempotent — called on every new DHCP
   * lease, every portal open, and every successful payment.
   */
  async autoLogin(ctx: DeviceContext): Promise<AutoLoginResult> {
    const mac = ctx.macAddress.toUpperCase();
    const now = new Date();

    const devices = await this.prisma.device.findMany({
      where: { macAddress: mac, isBlocked: false, releasedAt: null, voucher: { status: VoucherStatus.ACTIVE } },
      include: { voucher: { include: { package: true } } },
      orderBy: { lastSeenAt: "desc" },
    });
    const device = devices.find(({ voucher }) => voucherUsable(voucher, now));

    if (device) {
      const { voucher } = device;
      const open = await this.prisma.session.findFirst({
        where: { deviceId: device.id, endedAt: null },
        orderBy: { startedAt: "desc" },
      });
      const routerId = ctx.routerId ?? open?.routerId ?? undefined;
      if (!open) {
        await this.prisma.session.create({
          data: { deviceId: device.id, voucherId: voucher.id, routerId, ipAddress: ctx.ipAddress },
        });
      } else if (routerId !== open.routerId || (ctx.ipAddress && ctx.ipAddress !== open.ipAddress)) {
        await this.prisma.session.update({
          where: { id: open.id },
          data: { routerId, ipAddress: ctx.ipAddress ?? open.ipAddress },
        });
      }
      await this.prisma.device.update({
        where: { id: device.id },
        data: { lastSeenAt: now, hostname: ctx.hostname ?? device.hostname },
      });

      await this.networkAgent.admit({
        macAddress: mac,
        ipAddress: ctx.ipAddress,
        routerId: routerId ?? "",
        voucherId: voucher.id,
        downKbps: voucher.package.downKbps,
        upKbps: voucher.package.upKbps,
        sessionExpiresAt: (voucher.expiresAt ?? new Date(now.getTime() + FALLBACK_SESSION_TTL_MS)).toISOString(),
      });

      return {
        authorized: true,
        voucherCode: voucher.code,
        expiresAt: voucher.expiresAt?.toISOString(),
        remainingDataMb: voucher.package.dataCapMb
          ? Math.max(0, voucher.package.dataCapMb - voucher.dataUsedMb)
          : undefined,
      };
    }

    const paid = await this.prisma.payment.findFirst({
      where: { macAddress: mac, status: PaymentStatus.SUCCESS, voucher: { status: VoucherStatus.UNUSED } },
      include: { voucher: true },
      orderBy: { completedAt: "desc" },
    });
    if (paid?.voucher) {
      const result = await this.redeem(
        { voucherCode: paid.voucher.code, macAddress: mac, ipAddress: ctx.ipAddress, hostname: ctx.hostname },
        ctx.routerId ?? paid.routerId ?? undefined,
      );
      return {
        authorized: true,
        voucherCode: paid.voucher.code,
        expiresAt: result.sessionExpiresAt,
        remainingDataMb: result.remainingDataMb,
      };
    }

    return (await this.handOverChangedMac(ctx, mac, now)) ?? { authorized: false };
  }

  /** Moves a paid login to the same device's new random MAC (see MAC_HANDOVER_WINDOW_MS). */
  private async handOverChangedMac(ctx: DeviceContext, mac: string, now: Date): Promise<AutoLoginResult | null> {
    const hostname = ctx.hostname?.trim();
    if (!hostname || GENERIC_HOSTNAMES.has(hostname.toLowerCase())) return null;

    const candidates = await this.prisma.device.findMany({
      where: {
        hostname,
        macAddress: { not: mac },
        isBlocked: false,
        releasedAt: null,
        lastSeenAt: { gte: new Date(now.getTime() - MAC_HANDOVER_WINDOW_MS) },
        voucher: { status: VoucherStatus.ACTIVE },
      },
      include: { voucher: { include: { package: true } }, sessions: { where: { endedAt: null }, take: 1 } },
      orderBy: { lastSeenAt: "desc" },
    });

    for (const old of candidates) {
      if (!voucherUsable(old.voucher, now)) continue;
      // Still on the network means it's a different device with the same name.
      if ((await this.networkAgent.isPresent(old.macAddress, old.sessions[0]?.ipAddress)) !== false) continue;

      await this.releaseDevice(old, now, `MAC changed to ${mac}`);
      await this.audit.log({
        action: "DEVICE_MAC_HANDOVER",
        entityType: "Voucher",
        entityId: old.voucherId,
        metadata: { fromMac: old.macAddress, toMac: mac, hostname },
      });
      const result = await this.redeem(
        { voucherCode: old.voucher.code, macAddress: mac, ipAddress: ctx.ipAddress, hostname },
        ctx.routerId ?? old.sessions[0]?.routerId ?? undefined,
      );
      return {
        authorized: true,
        voucherCode: old.voucher.code,
        expiresAt: result.sessionExpiresAt,
        remainingDataMb: result.remainingDataMb,
      };
    }
    return null;
  }

  private async releaseDevice(device: { id: string; macAddress: string }, now: Date, reason: string) {
    await this.prisma.device.update({ where: { id: device.id }, data: { releasedAt: now } });
    await this.prisma.session.updateMany({ where: { deviceId: device.id, endedAt: null }, data: { endedAt: now } });
    await this.networkAgent.revoke({ macAddress: device.macAddress, reason });
  }

  /**
   * Makes room for `mac` on a voucher that's at its device limit by
   * releasing a device that can't be in use right now: idle for a while, or
   * no longer on the network at all (typically the same phone, reconnected
   * under a new random MAC). A device that's still here keeps its slot.
   */
  private async freeSlotIfFull(
    voucher: { devices: Array<{ id: string; macAddress: string; isBlocked: boolean; releasedAt: Date | null; lastSeenAt: Date }>; package: { deviceLimit: number } },
    mac: string,
    now: Date,
  ) {
    const holders = voucher.devices.filter((d) => !d.isBlocked && !d.releasedAt && d.macAddress !== mac);
    if (holders.length < voucher.package.deviceLimit) return;

    const stalestFirst = [...holders].sort((a, b) => a.lastSeenAt.getTime() - b.lastSeenAt.getTime());
    for (const holder of stalestFirst) {
      const idle = now.getTime() - holder.lastSeenAt.getTime() >= DEVICE_SLOT_STALE_MS;
      if (!idle) {
        const open = await this.prisma.session.findFirst({ where: { deviceId: holder.id, endedAt: null } });
        if ((await this.networkAgent.isPresent(holder.macAddress, open?.ipAddress)) !== false) continue;
      }
      await this.releaseDevice(holder, now, "device slot handed to a newer device");
      return;
    }

    throw new ForbiddenException(
      `This voucher is already in use on ${holders.length} device(s) (limit ${voucher.package.deviceLimit}). Buy another voucher to add a device.`,
    );
  }

  /** Issues a single voucher tied to a paying customer's phone (used by the payments flow). */
  async issueForPayment(packageId: string, customerId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const pkg = await db.package.findUnique({ where: { id: packageId } });
    if (!pkg) throw new BadRequestException("Unknown packageId");

    let code = generateVoucherCode();
    // Astronomically unlikely to collide, but guard anyway since code is unique.
    while (await db.voucher.findUnique({ where: { code } })) {
      code = generateVoucherCode();
    }

    return db.voucher.create({
      data: { code, packageId, customerId },
      include: { package: true },
    });
  }

  async suspend(id: string, adminUserId: string, reason: string) {
    const voucher = await this.prisma.voucher.findUnique({ where: { id }, include: { devices: true } });
    if (!voucher) throw new NotFoundException("Voucher not found");

    await this.prisma.voucher.update({ where: { id }, data: { status: VoucherStatus.SUSPENDED } });
    await this.prisma.session.updateMany({ where: { voucherId: id, endedAt: null }, data: { endedAt: new Date() } });
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
