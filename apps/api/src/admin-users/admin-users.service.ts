import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { AuditService } from "../audit/audit.service";
import type { CreateAdminUserDto } from "./dto/create-admin-user.dto";

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
    private readonly audit: AuditService,
  ) {}

  findAll() {
    return this.prisma.adminUser.findMany({
      select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  async create(dto: CreateAdminUserDto, createdBy: string) {
    const existing = await this.prisma.adminUser.findUnique({ where: { email: dto.email } });
    if (existing) throw new BadRequestException("An admin with that email already exists");

    const passwordHash = await this.authService.hashPassword(dto.password);
    const admin = await this.prisma.adminUser.create({
      data: { email: dto.email, passwordHash, fullName: dto.fullName, role: dto.role },
      select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
    });

    await this.audit.log({ adminUserId: createdBy, action: "ADMIN_USER_CREATED", entityType: "AdminUser", entityId: admin.id });
    return admin;
  }

  async setActive(id: string, isActive: boolean, actingAdminId: string) {
    if (id === actingAdminId && !isActive) {
      throw new BadRequestException("You cannot deactivate your own account");
    }
    const admin = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!admin) throw new NotFoundException("Admin not found");

    const updated = await this.prisma.adminUser.update({
      where: { id },
      data: { isActive },
      select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
    });

    await this.audit.log({
      adminUserId: actingAdminId,
      action: isActive ? "ADMIN_USER_REACTIVATED" : "ADMIN_USER_DEACTIVATED",
      entityType: "AdminUser",
      entityId: id,
    });
    return updated;
  }
}
