import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PackageLimitType } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { CreatePackageDto } from "./dto/create-package.dto";
import type { UpdatePackageDto } from "./dto/update-package.dto";

type LimitFields = { limitType: string; durationMinutes?: number | null; dataCapMb?: number | null };

@Injectable()
export class PackagesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(activeOnly = false) {
    if (activeOnly) {
      return this.prisma.package.findMany({ where: { isActive: true }, orderBy: { priceUgx: "asc" } });
    }
    const packages = await this.prisma.package.findMany({
      orderBy: [{ isActive: "desc" }, { priceUgx: "asc" }],
      include: { _count: { select: { vouchers: true, payments: true } } },
    });
    // `inUse` tells the admin UI whether Delete will remove the package or
    // only deactivate it (history must keep pointing at it).
    return packages.map(({ _count, ...p }) => ({ ...p, inUse: _count.vouchers + _count.payments > 0 }));
  }

  async findOne(id: string) {
    const pkg = await this.prisma.package.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException("Package not found");
    return pkg;
  }

  create(dto: CreatePackageDto) {
    const limits = this.normalizeLimits(dto);
    return this.prisma.package.create({
      data: { ...dto, ...limits, name: dto.name.trim(), deviceLimit: dto.deviceLimit ?? 1 },
    });
  }

  async update(id: string, dto: UpdatePackageDto) {
    const existing = await this.findOne(id);
    const limits = this.normalizeLimits({ ...existing, ...dto });
    return this.prisma.package.update({
      where: { id },
      data: { ...dto, ...limits, ...(dto.name !== undefined ? { name: dto.name.trim() } : {}) },
    });
  }

  /**
   * Hard-deletes a package nobody has bought or been issued yet. One with
   * vouchers or payments can't be removed without destroying sales history,
   * so it is deactivated instead (hidden from the portal, kept for records).
   */
  async remove(id: string) {
    await this.findOne(id);
    const [vouchers, payments] = await Promise.all([
      this.prisma.voucher.count({ where: { packageId: id } }),
      this.prisma.payment.count({ where: { packageId: id } }),
    ]);
    if (vouchers + payments === 0) {
      await this.prisma.package.delete({ where: { id } });
      return { deleted: true, deactivated: false };
    }
    await this.prisma.package.update({ where: { id }, data: { isActive: false } });
    return { deleted: false, deactivated: true, vouchers, payments };
  }

  /**
   * Validates the limit fields for the chosen limitType and clears the ones
   * that don't apply — a leftover durationMinutes on a DATA_CAP package would
   * otherwise still give its vouchers an expiry time at redemption.
   */
  private normalizeLimits(dto: LimitFields) {
    const usesDuration = dto.limitType === PackageLimitType.DURATION || dto.limitType === PackageLimitType.DURATION_AND_DATA_CAP;
    const usesData = dto.limitType === PackageLimitType.DATA_CAP || dto.limitType === PackageLimitType.DURATION_AND_DATA_CAP;
    if (usesDuration && !dto.durationMinutes) {
      throw new BadRequestException("Enter how long the package lasts (duration)");
    }
    if (usesData && !dto.dataCapMb) {
      throw new BadRequestException("Enter the package's data allowance (MB)");
    }
    return {
      durationMinutes: usesDuration ? dto.durationMinutes : null,
      dataCapMb: usesData ? dto.dataCapMb : null,
    };
  }
}
