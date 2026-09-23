import { Body, Controller, Headers, Post, UnauthorizedException } from "@nestjs/common";
import type { NetworkAgentHeartbeat } from "@netcam/shared";
import { Public } from "../auth/decorators/public.decorator";
import { RoutersService } from "../routers/routers.service";

/** Inbound endpoint the network-agent calls (not admin-authenticated; guarded by a shared secret). */
@Controller("network-agent")
export class NetworkAgentBridgeController {
  constructor(private readonly routersService: RoutersService) {}

  @Public()
  @Post("heartbeat")
  async heartbeat(@Body() body: NetworkAgentHeartbeat, @Headers("x-netcam-secret") secret: string) {
    if (secret !== (process.env.NETWORK_AGENT_SHARED_SECRET ?? "insecure-dev-secret")) {
      throw new UnauthorizedException();
    }
    await this.routersService.markSeen(body.routerId);
    return { ok: true };
  }
}
