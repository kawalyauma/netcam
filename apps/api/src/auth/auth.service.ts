import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import type { JwtPayload } from "./jwt.strategy";
import { AlertsService } from "../alerts/alerts.service";

const FAILED_LOGIN_WINDOW_MS = 15 * 60_000;
const FAILED_LOGINS_BEFORE_ALERT = 5;

@Injectable()
export class AuthService {
  private readonly failedLogins = new Map<string, number[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly alerts: AlertsService,
  ) {}

  /** The dashboard is on the public internet; repeated failures look like password guessing. */
  private recordFailedLogin(email: string) {
    const now = Date.now();
    const recent = (this.failedLogins.get(email) ?? []).filter((t) => now - t < FAILED_LOGIN_WINDOW_MS);
    recent.push(now);
    this.failedLogins.delete(email);
    this.failedLogins.set(email, recent);
    if (this.failedLogins.size > 1000) this.failedLogins.delete(this.failedLogins.keys().next().value!);
    if (recent.length >= FAILED_LOGINS_BEFORE_ALERT) {
      void this.alerts.notify({
        category: "SECURITY",
        severity: "WARNING",
        title: "Repeated failed logins",
        message: `${recent.length} wrong passwords for "${email.slice(0, 60)}" on the dashboard in 15 minutes. If this wasn't you, someone may be guessing passwords.`,
        dedupeKey: `failed-login:${email.slice(0, 60)}`,
        cooldownMinutes: 60,
      });
    }
  }

  async login(email: string, password: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!admin || !admin.isActive) {
      this.recordFailedLogin(email);
      throw new UnauthorizedException("Invalid credentials");
    }

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) {
      this.recordFailedLogin(email);
      throw new UnauthorizedException("Invalid credentials");
    }

    this.failedLogins.delete(email);
    void this.alerts.notify({
      category: "SECURITY",
      severity: "INFO",
      title: "Dashboard login",
      message: `${admin.email} signed in to the NetCam dashboard.`,
      dedupeKey: `login:${admin.id}`,
      cooldownMinutes: 6 * 60,
    });

    const payload: JwtPayload = { sub: admin.id, email: admin.email, role: admin.role };
    const accessToken = await this.jwt.signAsync(payload);

    return {
      accessToken,
      admin: {
        id: admin.id,
        email: admin.email,
        fullName: admin.fullName,
        role: admin.role,
      },
    };
  }

  async hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, 10);
  }

  /** Step-up check before sensitive actions (moving money): re-verifies the admin's password. */
  async verifyPassword(adminId: string, password: string): Promise<boolean> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin || !admin.isActive) return false;
    return bcrypt.compare(password, admin.passwordHash);
  }

  async changePassword(adminId: string, currentPassword: string, newPassword: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin) throw new UnauthorizedException();

    const valid = await bcrypt.compare(currentPassword, admin.passwordHash);
    if (!valid) throw new BadRequestException("Current password is incorrect");

    if (newPassword.length < 8) {
      throw new BadRequestException("New password must be at least 8 characters");
    }

    const passwordHash = await this.hashPassword(newPassword);
    await this.prisma.adminUser.update({ where: { id: adminId }, data: { passwordHash } });
  }
}
