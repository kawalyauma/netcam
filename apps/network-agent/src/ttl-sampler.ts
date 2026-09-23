import { spawn } from "child_process";
import { assertValidInterface, assertValidMac } from "./shell";

/**
 * Samples a few packets from a specific MAC on an interface with tcpdump and
 * extracts their IP TTLs, feeding the API's re-share heuristic
 * (see apps/api/src/sessions/ttl-fingerprint.util.ts). Requires tcpdump to
 * be installed and runnable by this (root) process.
 */
export function sampleTtls(iface: string, mac: string, packetCount: number, timeoutMs = 5000): Promise<number[]> {
  const safeIface = assertValidInterface(iface);
  const safeMac = assertValidMac(mac);

  return new Promise((resolve) => {
    const args = ["-i", safeIface, "-c", String(packetCount), "-nn", "-v", `ether src ${safeMac} and ip`];
    const proc = spawn("tcpdump", args);
    let output = "";
    const timer = setTimeout(() => proc.kill("SIGKILL"), timeoutMs);

    proc.stdout.on("data", (d) => (output += d.toString()));
    proc.stderr.on("data", (d) => (output += d.toString())); // tcpdump writes captured packet lines to stderr with -v in some builds

    proc.on("close", () => {
      clearTimeout(timer);
      const ttls = Array.from(output.matchAll(/ttl\s*(\d+)/gi)).map((m) => Number(m[1]));
      resolve(ttls);
    });
    proc.on("error", () => {
      clearTimeout(timer);
      resolve([]);
    });
  });
}
