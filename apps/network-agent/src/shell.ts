import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const MAC_REGEX = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const IFACE_REGEX = /^[a-zA-Z0-9_.-]{1,15}$/;

export function assertValidMac(mac: string): string {
  if (!MAC_REGEX.test(mac)) throw new Error(`Refusing to use invalid MAC address: ${mac}`);
  return mac.toUpperCase();
}

export function assertValidIp(ip: string): string {
  if (!IPV4_REGEX.test(ip)) throw new Error(`Refusing to use invalid IPv4 address: ${ip}`);
  return ip;
}

export function assertValidInterface(iface: string): string {
  if (!IFACE_REGEX.test(iface)) throw new Error(`Refusing to use invalid interface name: ${iface}`);
  return iface;
}

/**
 * Runs a system command with argv passed as an array — never through a
 * shell — so nothing in a MAC/IP/interface string (even if validation above
 * were ever bypassed) can break out into shell metacharacters.
 */
export async function run(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync(cmd, args, { timeout: 10_000 });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message: string };
    throw new Error(`Command failed: ${cmd} ${args.join(" ")}\n${e.stderr ?? e.message}`);
  }
}
