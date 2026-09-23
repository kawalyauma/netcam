import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PackageLimitType } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";
import type { CreatePackageDto } from "./dto/create-package.dto";
import type { UpdatePackageDto } from "./dto/update-package.dto";

@Injectable()
export class PackagesService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(activeOnly = false) {
    return this.prisma.package.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { priceUgx: "asc" },
    });
  }

  async findOne(id: string) {
    const pkg = await this.prisma.package.findUnique({ where: { id } });
    if (!pkg) throw new NotFoundException("Package not found");
    return pkg;
  }

  create(dto: CreatePackageDto) {
    this.validateLimits(dto);
    return this.prisma.package.create({ data: { ...dto, deviceLimit: dto.deviceLimit ?? 1 } });
  }

  async update(id: string, dto: UpdatePackageDto) {
    const existing = await this.findOne(id);
    this.validateLimits({ ...existing, ...dto });
    return this.prisma.package.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.package.update({ where: { id }, data: { isActive: false } });
  }

  private validateLimits(dto: {
    limitType: string;
    durationMinutes?: number | null;
    dataCapMb?: number | null;
  }) {
    if (
      (dto.limitType === PackageLimitType.DURATION || dto.limitType === PackageLimitType.DURATION_AND_DATA_CAP) &&
      !dto.durationMinutes
    ) {
      throw new BadRequestException("durationMinutes is required for this limitType");
    }
    if (
      (dto.limitType === PackageLimitType.DATA_CAP || dto.limitType === PackageLimitType.DURATION_AND_DATA_CAP) &&
      !dto.dataCapMb
    ) {
      throw new BadRequestException("dataCapMb is required for this limitType");
    }
  }
}
