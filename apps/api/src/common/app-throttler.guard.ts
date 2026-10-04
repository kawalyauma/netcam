import { Injectable, type ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  /**
   * The network-agent proxies every customer's portal traffic, so all of it
   * reaches the API from one address; throttling it per IP would make the
   * whole hotspot share a single budget. The agent proves itself with the
   * shared secret.
   */
  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    return req.headers["x-netcam-secret"] === (process.env.NETWORK_AGENT_SHARED_SECRET ?? "insecure-dev-secret");
  }

  /** Dashboard traffic arrives via Cloudflare Tunnel -> nginx; key on the real visitor, not the proxy. */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const headers = req.headers as Record<string, string | undefined>;
    return headers["cf-connecting-ip"] ?? headers["x-real-ip"] ?? req.ip;
  }
}
