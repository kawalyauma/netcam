import { open, stat, truncate, mkdir, writeFile } from "fs/promises";
import path from "path";
import { classifyDomain } from "./app-catalog";
import { run } from "./shell";

export const DNS_LOG_FILE = "/var/log/netcam/dns.log";
// The log only exists to feed this parser; it's emptied once it gets this
// big so customers' lookups never pile up on disk.
const MAX_LOG_BYTES = 2 * 1024 * 1024;
const MAPPING_TTL_MS = 2 * 60 * 60_000;
const MAX_MAPPINGS = 50_000;

// With `log-queries=extra` every line carries a per-query serial and the
// client: "dnsmasq[1]: 812 10.50.10.66/40112 reply r1.googlevideo.com is 1.2.3.4"
const LINE = /:\s(\d+)\s(\d+\.\d+\.\d+\.\d+)\/\d+\s(query\[\w+\]|reply|cached|forwarded|config)\s(\S+)\s(?:is|from|to)\s(\S+)/;
const IPV4 = /^\d+\.\d+\.\d+\.\d+$/;

interface Mapping {
  app: string;
  at: number;
}

const queryNameBySerial = new Map<string, string>();
const byClientAndIp = new Map<string, Mapping>();
const byIp = new Map<string, Mapping>();
let offset = 0;

/** Creates the log file dnsmasq writes to (it drops root before logging). */
export async function prepareDnsLog(): Promise<void> {
  await mkdir(path.dirname(DNS_LOG_FILE), { recursive: true });
  await writeFile(DNS_LOG_FILE, "", { flag: "a", mode: 0o640 });
  await run("chown", ["dnsmasq", DNS_LOG_FILE]).catch(() => undefined);
}

function remember(map: Map<string, Mapping>, key: string, app: string, now: number) {
  map.delete(key);
  map.set(key, { app, at: now });
  if (map.size > MAX_MAPPINGS) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

export function parseDnsLogLine(line: string, now = Date.now()): void {
  const m = line.match(LINE);
  if (!m) return;
  const [, serial, client, action, name, value] = m;

  if (action.startsWith("query")) {
    queryNameBySerial.set(serial, name);
    if (queryNameBySerial.size > 5000) queryNameBySerial.delete(queryNameBySerial.keys().next().value!);
    return;
  }
  if ((action !== "reply" && action !== "cached") || !IPV4.test(value)) return;

  // A lookup of www.youtube.com is answered via CNAMEs like
  // youtube-ui.l.google.com; the name the device asked for is the telling one.
  const asked = queryNameBySerial.get(serial);
  const app = (asked && classifyDomain(asked)) ?? classifyDomain(name);
  if (!app) return;
  remember(byClientAndIp, `${client}|${value}`, app, now);
  remember(byIp, value, app, now);
}

/** Reads whatever dnsmasq appended since last time. */
export async function pollDnsLog(): Promise<void> {
  let size: number;
  try {
    size = (await stat(DNS_LOG_FILE)).size;
  } catch {
    return;
  }
  if (size < offset) offset = 0; // truncated or replaced
  if (size > offset) {
    const handle = await open(DNS_LOG_FILE, "r");
    try {
      const length = Math.min(size - offset, MAX_LOG_BYTES);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, offset);
      const text = buffer.toString("utf8");
      const complete = text.lastIndexOf("\n") + 1; // leave a half-written last line for next time
      const now = Date.now();
      for (const line of text.slice(0, complete).split("\n")) parseDnsLogLine(line, now);
      offset += Buffer.byteLength(text.slice(0, complete));
    } finally {
      await handle.close();
    }
  }
  if (offset >= MAX_LOG_BYTES) {
    await truncate(DNS_LOG_FILE, 0).catch(() => undefined);
    offset = 0;
  }
}

/** The app behind a connection from `clientIp` to `destIp`, if a DNS lookup told us. */
export function appForDestination(clientIp: string, destIp: string): string | undefined {
  const now = Date.now();
  const specific = byClientAndIp.get(`${clientIp}|${destIp}`);
  if (specific && now - specific.at < MAPPING_TTL_MS) return specific.app;
  const shared = byIp.get(destIp);
  if (shared && now - shared.at < MAPPING_TTL_MS) return shared.app;
  return undefined;
}
