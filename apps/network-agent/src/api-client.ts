import axios from "axios";
import { config } from "./config";

export const apiClient = axios.create({
  baseURL: config.apiUrl,
  timeout: 8000,
  headers: { "x-netcam-secret": config.sharedSecret, "Content-Type": "application/json" },
});

export async function sendHeartbeat(routerId: string, vlanId: number, iface: string, connectedMacs: string[]) {
  await apiClient
    .post("/api/network-agent/heartbeat", {
      routerId,
      vlanId,
      interfaceName: iface,
      connectedMacs,
      timestamp: new Date().toISOString(),
    })
    .catch((err) => {
      console.warn(`heartbeat to API failed: ${(err as Error).message}`);
    });
}

export interface ActiveSessionRecord {
  macAddress: string;
  routerId: string;
  downKbps: number;
  upKbps: number;
  sessionExpiresAt: string;
}

/** Fetched once on startup so a restarted agent re-admits everyone the API still considers active (see network-agent-bridge.controller.ts). */
export async function fetchActiveSessions(): Promise<ActiveSessionRecord[]> {
  try {
    const { data } = await apiClient.get<ActiveSessionRecord[]>("/api/network-agent/active-sessions");
    return data;
  } catch (err) {
    console.warn(`fetching active sessions for reconciliation failed: ${(err as Error).message}`);
    return [];
  }
}

export async function sendTrafficReport(
  routerId: string,
  samples: Array<{ macAddress: string; bytesUp: number; bytesDown: number; observedTtls?: number[] }>,
) {
  if (samples.length === 0) return;
  await apiClient.post("/api/sessions/traffic-report", { routerId, samples }).catch((err) => {
    console.warn(`traffic report to API failed: ${(err as Error).message}`);
  });
}
