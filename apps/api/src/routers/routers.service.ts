import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { RouterStatus } from "@netcam/shared";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { encryptSecret } from "../common/crypto.util";
import type { CreateRouterDto } from "./dto/create-router.dto";
import type { UpdateRouterDto } from "./dto/update-router.dto";

/** A router is considered OFFLINE if the network-agent hasn't heartbeat-ed it in this window. */
const ONLINE_WINDOW_MS = 3 * 60 * 1000;

@Injectable()
export class RoutersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll() {
    const routers = await this.prisma.router.findMany({
      include: { outputChannel: true, childRouters: true },
      orderBy: { createdAt: "asc" },
    });
    const now = Date.now();
    return routers.map((r) => ({
      ...r,
      apPasswordEnc: undefined,
      status: this.deriveStatus(r.lastSeenAt, now),
    }));
  }

  /** Builds the chain as a tree, rooted at routers with no parent. */
  async findTopology() {
    const routers = await this.prisma.router.findMany({
      include: { outputChannel: true },
      orderBy: { createdAt: "asc" },
    });
    const now = Date.now();
    const byId = new Map(
      routers.map((r) => [
        r.id,
        { ...r, apPasswordEnc: undefined as string | undefined, status: this.deriveStatus(r.lastSeenAt, now), children: [] as unknown[] },
      ]),
    );
    const roots: unknown[] = [];
    for (const router of byId.values()) {
      if (router.parentRouterId && byId.has(router.parentRouterId)) {
        (byId.get(router.parentRouterId)!.children as unknown[]).push(router);
      } else {
        roots.push(router);
      }
    }
    return roots;
  }

  async findOne(id: string) {
    const router = await this.prisma.router.findUnique({
      where: { id },
      include: { outputChannel: true, parentRouter: true, childRouters: true },
    });
    if (!router) throw new NotFoundException("Router not found");
    return { ...router, apPasswordEnc: undefined, status: this.deriveStatus(router.lastSeenAt, Date.now()) };
  }

  /** Devices/sessions currently attributed to this router's VLAN segment. */
  async findActiveUsers(id: string) {
    await this.findOne(id);
    const cutoff = new Date(Date.now() - ONLINE_WINDOW_MS);
    return this.prisma.session.findMany({
      where: { routerId: id, endedAt: null, startedAt: { gte: cutoff } },
      include: { device: true, voucher: { include: { package: true } } },
      orderBy: { startedAt: "desc" },
    });
  }

  async create(dto: CreateRouterDto) {
    if (dto.parentRouterId) {
      const parent = await this.prisma.router.findUnique({ where: { id: dto.parentRouterId } });
      if (!parent) throw new BadRequestException("parentRouterId does not reference an existing router");
    }

    const { apPassword, ...rest } = dto;
    return this.prisma.router.create({
      data: {
        ...rest,
        apPasswordEnc: apPassword ? encryptSecret(apPassword) : undefined,
      },
    });
  }

  async update(id: string, dto: UpdateRouterDto) {
    await this.findOne(id);
    if (dto.parentRouterId === id) {
      throw new BadRequestException("A router cannot be its own parent");
    }
    const { apPassword, ...rest } = dto;
    return this.prisma.router.update({
      where: { id },
      data: {
        ...rest,
        apPasswordEnc: apPassword ? encryptSecret(apPassword) : undefined,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.router.delete({ where: { id } });
  }

  /** Called by the network-agent heartbeat to mark a router as seen. */
  async markSeen(id: string) {
    await this.prisma.router.update({
      where: { id },
      data: { lastSeenAt: new Date(), status: RouterStatus.ONLINE },
    });
  }

  private deriveStatus(lastSeenAt: Date | null, now: number): RouterStatus {
    if (!lastSeenAt) return RouterStatus.UNKNOWN;
    return now - lastSeenAt.getTime() <= ONLINE_WINDOW_MS ? RouterStatus.ONLINE : RouterStatus.OFFLINE;
  }
}
