import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import type { CreateOutputChannelDto } from "./dto/create-output-channel.dto";

@Injectable()
export class OutputChannelsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  findAll() {
    return this.prisma.outputChannel.findMany({ orderBy: { createdAt: "asc" } });
  }

  async findOne(id: string) {
    const channel = await this.prisma.outputChannel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException("Output channel not found");
    return channel;
  }

  create(dto: CreateOutputChannelDto) {
    return this.prisma.outputChannel.create({ data: dto });
  }

  /**
   * Only one output channel is "active" (live-serving) at a time. Flipping it
   * is the operator's way of choosing which physical LAN port/adapter is
   * currently distributing internet, without touching hardware.
   */
  async setActive(id: string, adminUserId: string) {
    await this.findOne(id);
    const [, activated] = await this.prisma.$transaction([
      this.prisma.outputChannel.updateMany({ data: { isActive: false }, where: { isActive: true } }),
      this.prisma.outputChannel.update({ where: { id }, data: { isActive: true } }),
    ]);

    await this.audit.log({
      adminUserId,
      action: "OUTPUT_CHANNEL_ACTIVATED",
      entityType: "OutputChannel",
      entityId: id,
    });

    return activated;
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.outputChannel.delete({ where: { id } });
  }
}
