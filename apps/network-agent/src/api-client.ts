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
      // eslint-disable-next-line no-console
      console.warn(`heartbeat to API failed: ${(err as Error).message}`);
    });
}

export async function sendTrafficReport(
  routerId: string,
  samples: Array<{ macAddress: string; bytesUp: number; bytesDown: number; observedTtls?: number[] }>,
) {
  if (samples.length === 0) return;
  await apiClient.post("/api/sessions/traffic-report", { routerId, samples }).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn(`traffic report to API failed: ${(err as Error).message}`);
  });
}
