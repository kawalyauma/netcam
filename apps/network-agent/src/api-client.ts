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
  routerId: string | null;
  ipAddress: string | null;
  downKbps: number;
  upKbps: number;
  sessionExpiresAt: string;
}

/**
 * Throws when the API can't be reached. An empty list would mean "nobody is
 * entitled", which is wrong right after a reboot when the API container
 * simply isn't up yet — callers must retry instead.
 */
export async function fetchActiveSessions(): Promise<ActiveSessionRecord[]> {
  const { data } = await apiClient.get<ActiveSessionRecord[]>("/api/network-agent/active-sessions");
  return data;
}

/** Asks the API to log in a device that just took a DHCP lease, if it's entitled. The API admits it via /admit. */
export async function requestAutoLogin(
  macAddress: string,
  ipAddress: string,
  routerId: string,
  hostname?: string,
): Promise<boolean> {
  const { data } = await apiClient.post<{ authorized: boolean }>(
    "/api/portal/auto-login",
    { macAddress, ipAddress, routerId, hostname },
  );
  return data.authorized;
}

export interface TrafficSample {
  macAddress: string;
  bytesUp: number;
  bytesDown: number;
  observedTtls?: number[];
  ipAddress?: string;
  hostname?: string;
  apps?: Array<{ app: string; bytesUp: number; bytesDown: number }>;
}

export async function sendTrafficReport(routerId: string, samples: TrafficSample[]) {
  if (samples.length === 0) return;
  await apiClient.post("/api/sessions/traffic-report", { routerId, samples }).catch((err) => {
    console.warn(`traffic report to API failed: ${(err as Error).message}`);
  });
}
