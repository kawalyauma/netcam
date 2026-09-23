import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import type { NetworkAgentAdmitCommand, NetworkAgentRevokeCommand } from "@netcam/shared";

/**
 * Talks to the network-agent (a separate root/NET_ADMIN process running on
 * the host, see apps/network-agent) over a local HTTP API. The API never
 * touches nftables/dnsmasq/tc directly — it only issues commands here, so a
 * compromised/buggy API process can't get raw root network access.
 */
@Injectable()
export class NetworkAgentBridgeService {
  private readonly logger = new Logger(NetworkAgentBridgeService.name);
  private readonly baseUrl = process.env.NETWORK_AGENT_URL ?? "http://127.0.0.1:8787";
  private readonly sharedSecret = process.env.NETWORK_AGENT_SHARED_SECRET ?? "insecure-dev-secret";

  async admit(command: NetworkAgentAdmitCommand): Promise<void> {
    await this.call("/admit", command);
  }

  async revoke(command: NetworkAgentRevokeCommand): Promise<void> {
    await this.call("/revoke", command);
  }

  private async call(path: string, body: unknown): Promise<void> {
    try {
      await axios.post(`${this.baseUrl}${path}`, body, {
        headers: { "x-netcam-secret": this.sharedSecret },
        timeout: 5000,
      });
    } catch (err) {
      // Network-agent may be temporarily unreachable (e.g. during dev on a
      // machine with no real NICs). Never let this crash the request that
      // triggered it — the voucher/payment record is still the source of
      // truth; the agent will pick up state on its next heartbeat/reconcile.
      this.logger.warn(`network-agent call to ${path} failed: ${(err as Error).message}`);
    }
  }
}
