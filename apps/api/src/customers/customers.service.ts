import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateByPhone(phoneNumber: string) {
    const normalized = this.normalizePhone(phoneNumber);
    return this.prisma.customer.upsert({
      where: { phoneNumber: normalized },
      update: {},
      create: { phoneNumber: normalized },
    });
  }

  async findByPhone(phoneNumber: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { phoneNumber: this.normalizePhone(phoneNumber) },
    });
    if (!customer) throw new NotFoundException("No customer with that phone number");
    return customer;
  }

  findAll() {
    return this.prisma.customer.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  }

  /** Uganda-style normalization: accepts 07..., +2567..., 2567... and stores E.164. */
  normalizePhone(raw: string): string {
    const digits = raw.replace(/[^\d]/g, "");
    if (digits.startsWith("256")) return `+${digits}`;
    if (digits.startsWith("0")) return `+256${digits.slice(1)}`;
    if (digits.startsWith("7") && digits.length === 9) return `+256${digits}`;
    return `+${digits}`;
  }
}
