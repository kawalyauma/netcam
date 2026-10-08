import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import type { NetworkAgentAdmitCommand, NetworkAgentRevokeCommand } from "@netcam/shared";

/**
 * Talks to the network-agent (a separate root/NET_ADMIN process running on
 * the host, see apps/network-agent) over a local HTTP API. The API never
 * touches nftables/dnsmasq/tc directly — it only issues commands here, so a
 * compromised/buggy API process can't get raw root network access.
 */
export interface AgentNetworkStatus {
  generatedAt: string;
  interfaces: Array<{ routerId: string; interfaceName: string; subnetCidr: string; gatewayIp: string }>;
  devices: Array<{
    macAddress: string;
    ipAddress: string | null;
    hostname: string | null;
    interfaceName: string | null;
    leaseExpiresAt: string | null;
    neighborState: string | null;
    pingMs: number | null;
    online: boolean;
    authorized: boolean;
  }>;
  routers: Array<{ id: string; ipAddress: string | null; pingMs: number | null; reachable: boolean }>;
}

export interface AgentUsageSnapshot {
  generatedAt: string;
  tickMs: number;
  /** Whole-network bytes/second, oldest first. */
  network: Array<{ t: number; down: number; up: number }>;
  devices: Array<{
    macAddress: string;
    routerId: string;
    ipAddress: string | null;
    hostname: string | null;
    downBps: number;
    upBps: number;
    totalDown: number;
    totalUp: number;
    history: Array<{ t: number; down: number; up: number }>;
    apps: Array<{ app: string; down: number; up: number; downBps: number; upBps: number }>;
  }>;
}

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

  /** Unlike admit/revoke this must surface failures — the caller renders the result. */
  async networkStatus(routers: Array<{ id: string; ipAddress: string | null; macAddress: string | null }>): Promise<AgentNetworkStatus> {
    const { data } = await axios.post<AgentNetworkStatus>(
      `${this.baseUrl}/network-status`,
      { routers },
      { headers: { "x-netcam-secret": this.sharedSecret }, timeout: 15_000 },
    );
    return data;
  }

  async isHealthy(): Promise<boolean> {
    try {
      await axios.get(`${this.baseUrl}/healthz`, { headers: { "x-netcam-secret": this.sharedSecret }, timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /** Whether a MAC answers on the network right now; null when the agent can't be asked. */
  async isPresent(macAddress: string, ipAddress?: string | null): Promise<boolean | null> {
    try {
      const { data } = await axios.post<{ present: boolean }>(
        `${this.baseUrl}/presence`,
        { macAddress, ipAddress },
        { headers: { "x-netcam-secret": this.sharedSecret }, timeout: 8000 },
      );
      return data.present;
    } catch (err) {
      this.logger.warn(`presence check for ${macAddress} failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Live per-device usage at 5-second resolution. Throws when the agent is unreachable. */
  async usageLive(): Promise<AgentUsageSnapshot> {
    const { data } = await axios.get<AgentUsageSnapshot>(`${this.baseUrl}/usage/live`, {
      headers: { "x-netcam-secret": this.sharedSecret },
      timeout: 5000,
    });
    return data;
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
