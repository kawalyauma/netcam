import { Controller, Get, Headers, Body, Post, UnauthorizedException } from "@nestjs/common";
import { VoucherStatus } from "@netcam/shared";
import type { NetworkAgentHeartbeat } from "@netcam/shared";
import { Public } from "../auth/decorators/public.decorator";
import { RoutersService } from "../routers/routers.service";
import { PrismaService } from "../prisma/prisma.service";

const FALLBACK_SESSION_TTL_MS = 24 * 60 * 60_000;

/** Inbound endpoints the network-agent calls (not admin-authenticated; guarded by a shared secret). */
@Controller("network-agent")
export class NetworkAgentBridgeController {
  constructor(
    private readonly routersService: RoutersService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post("heartbeat")
  async heartbeat(@Body() body: NetworkAgentHeartbeat, @Headers("x-netcam-secret") secret: string) {
    this.assertSecret(secret);
    await this.routersService.markSeen(body.routerId);
    return { ok: true };
  }

  /**
   * Lets network-agent re-admit every currently-active device on startup.
   * Without this, restarting the agent (a crash, a `git pull` update, a
   * reboot) would silently drop every paying customer's access, because
   * applying the base nftables ruleset recreates the authorized_macs set
   * from scratch.
   */
  @Public()
  @Get("active-sessions")
  async activeSessions(@Headers("x-netcam-secret") secret: string) {
    this.assertSecret(secret);

    const sessions = await this.prisma.session.findMany({
      where: { endedAt: null, routerId: { not: null }, voucher: { status: VoucherStatus.ACTIVE } },
      include: { device: true, voucher: { include: { package: true } } },
    });

    return sessions.map((s) => ({
      macAddress: s.device.macAddress,
      routerId: s.routerId as string,
      downKbps: s.voucher.package.downKbps,
      upKbps: s.voucher.package.upKbps,
      sessionExpiresAt: (s.voucher.expiresAt ?? new Date(Date.now() + FALLBACK_SESSION_TTL_MS)).toISOString(),
    }));
  }

  private assertSecret(secret: string) {
    if (secret !== (process.env.NETWORK_AGENT_SHARED_SECRET ?? "insecure-dev-secret")) {
      throw new UnauthorizedException();
    }
  }
}
