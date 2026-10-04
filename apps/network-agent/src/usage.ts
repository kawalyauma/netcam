import { readFile, writeFile } from "fs/promises";
import { config } from "./config";
import { admitted } from "./state";
import { readAllMacBytes } from "./tc";
import { readLeases } from "./dnsmasq";
import { appForDestination, pollDnsLog } from "./dns-log";
import { classifyUnknown } from "./app-catalog";

const TICK_MS = 5_000;
const HISTORY_POINTS = 120; // 10 minutes of 5-second points
const CONNTRACK_FILE = "/proc/net/nf_conntrack";
const UNATTRIBUTED = "Other";

/** Bytes per second over one tick. */
export interface RatePoint {
  t: number;
  down: number;
  up: number;
}

interface Counter {
  down: number;
  up: number;
}

interface DeviceUsage {
  mac: string;
  routerId: string;
  ip?: string;
  hostname?: string;
  history: RatePoint[];
  appRates: Map<string, Counter>; // bytes/s during the last tick
  appTotals: Map<string, Counter>; // bytes since the device was admitted
  pendingApps: Map<string, Counter>; // bytes not yet reported to the API
  totalDown: number;
  totalUp: number;
}

export interface Flow {
  key: string;
  proto: string;
  src: string;
  dst: string;
  dport: number;
  orig: number; // client -> internet (upload)
  reply: number; // internet -> client (download)
}

const devices = new Map<string, DeviceUsage>();
const networkHistory: RatePoint[] = [];
const lastTc = new Map<string, Counter>();
const lastFlows = new Map<string, { orig: number; reply: number }>();
let lastTickAt = 0;
let ticking = false;

/** The gateway itself (DNS, the portal) and other clients — not internet usage. */
function isLanAddress(ip: string): boolean {
  return config.routerVlans.some((r) => ip.startsWith(r.subnetCidr.split("/")[0].split(".").slice(0, 3).join(".") + "."));
}

function add(map: Map<string, Counter>, app: string, down: number, up: number) {
  const c = map.get(app) ?? { down: 0, up: 0 };
  c.down += down;
  c.up += up;
  map.set(app, c);
}

function push(history: RatePoint[], point: RatePoint) {
  history.push(point);
  if (history.length > HISTORY_POINTS) history.shift();
}

/** Parses /proc/net/nf_conntrack lines that carry byte accounting. */
export function parseConntrack(text: string): Flow[] {
  const flows: Flow[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("ipv4")) continue;
    const proto = line.split(/\s+/)[2];
    const fields: Record<string, string[]> = {};
    for (const [, k, v] of line.matchAll(/\b(src|dst|sport|dport|bytes)=(\S+)/g)) {
      (fields[k] ??= []).push(v);
    }
    if (!fields.src || !fields.dst || !fields.bytes || fields.bytes.length < 2) continue;
    const dport = Number(fields.dport?.[0] ?? 0);
    flows.push({
      key: `${proto}|${fields.src[0]}|${fields.dst[0]}|${fields.sport?.[0] ?? ""}|${dport}`,
      proto,
      src: fields.src[0],
      dst: fields.dst[0],
      dport,
      orig: Number(fields.bytes[0]),
      reply: Number(fields.bytes[1]),
    });
  }
  return flows;
}

/**
 * Splits a device's billed bytes (from tc) across apps in the proportions
 * connection tracking saw. Whatever conntrack missed (very short flows,
 * flows to unknown hosts) is "Other", so the app split always adds up to
 * what the customer was actually charged for.
 */
export function splitAcrossApps(billed: Counter, seen: Map<string, Counter>): Map<string, Counter> {
  const result = new Map<string, Counter>();
  for (const dir of ["down", "up"] as const) {
    const attributed = [...seen.values()].reduce((sum, c) => sum + c[dir], 0);
    const scale = attributed > billed[dir] && attributed > 0 ? billed[dir] / attributed : 1;
    for (const [app, c] of seen) {
      const v = c[dir] * scale;
      if (v > 0) add(result, app, dir === "down" ? v : 0, dir === "up" ? v : 0);
    }
    const rest = billed[dir] - Math.min(attributed, billed[dir]);
    if (rest > 0) add(result, UNATTRIBUTED, dir === "down" ? rest : 0, dir === "up" ? rest : 0);
  }
  return result;
}

async function tick() {
  const now = Date.now();
  const firstTick = lastTickAt === 0;
  const seconds = firstTick ? TICK_MS / 1000 : Math.max(1, (now - lastTickAt) / 1000);
  lastTickAt = now;

  await pollDnsLog().catch(() => undefined);

  const leases = await readLeases(config.routerVlans);
  const macByIp = new Map(leases.map((l) => [l.ipAddress, l.macAddress]));
  const leaseByMac = new Map(leases.map((l) => [l.macAddress, l]));

  for (const mac of devices.keys()) {
    if (!admitted.has(mac)) {
      devices.delete(mac);
      lastTc.delete(mac);
    }
  }

  const billed = new Map<string, Counter>();
  for (const router of config.routerVlans) {
    const [down, up] = await Promise.all([
      readAllMacBytes(router.vlanInterface).catch(() => new Map<string, number>()),
      readAllMacBytes(router.ifbInterface).catch(() => new Map<string, number>()),
    ]);
    for (const [mac, entry] of admitted) {
      if (entry.router.routerId !== router.routerId) continue;
      const cur = { down: down.get(mac) ?? 0, up: up.get(mac) ?? 0 };
      const prev = lastTc.get(mac);
      lastTc.set(mac, cur);
      // Counters restart from 0 when a class is recreated; treat that as a new baseline.
      billed.set(mac, {
        down: prev && cur.down >= prev.down ? cur.down - prev.down : 0,
        up: prev && cur.up >= prev.up ? cur.up - prev.up : 0,
      });
    }
  }

  const seenByMac = new Map<string, Map<string, Counter>>();
  const conntrack = await readFile(CONNTRACK_FILE, "utf8").catch(() => "");
  const live = new Set<string>();
  for (const flow of parseConntrack(conntrack)) {
    const mac = macByIp.get(flow.src);
    if (!mac || !admitted.has(mac) || isLanAddress(flow.dst)) continue; // only client -> internet
    live.add(flow.key);
    const prev = lastFlows.get(flow.key);
    lastFlows.set(flow.key, { orig: flow.orig, reply: flow.reply });
    // On the very first tick every flow's counter includes history from
    // before this agent started; only measure from here on.
    if (firstTick) continue;
    const up = Math.max(0, flow.orig - (prev?.orig ?? 0));
    const down = Math.max(0, flow.reply - (prev?.reply ?? 0));
    if (up + down === 0) continue;
    const app = appForDestination(flow.src, flow.dst) ?? classifyUnknown(flow.proto, flow.dport);
    const perApp = seenByMac.get(mac) ?? new Map<string, Counter>();
    add(perApp, app, down, up);
    seenByMac.set(mac, perApp);
  }
  for (const key of lastFlows.keys()) if (!live.has(key)) lastFlows.delete(key);

  let netDown = 0;
  let netUp = 0;
  for (const [mac, entry] of admitted) {
    let d = devices.get(mac);
    if (!d) {
      d = {
        mac,
        routerId: entry.router.routerId,
        history: [],
        appRates: new Map(),
        appTotals: new Map(),
        pendingApps: new Map(),
        totalDown: 0,
        totalUp: 0,
      };
      devices.set(mac, d);
    }
    const lease = leaseByMac.get(mac);
    d.ip = lease?.ipAddress ?? d.ip;
    d.hostname = lease?.hostname ?? d.hostname;
    d.routerId = entry.router.routerId;

    const b = billed.get(mac) ?? { down: 0, up: 0 };
    const apps = splitAcrossApps(b, seenByMac.get(mac) ?? new Map());
    d.appRates = new Map([...apps].map(([app, c]) => [app, { down: c.down / seconds, up: c.up / seconds }]));
    for (const [app, c] of apps) {
      add(d.appTotals, app, c.down, c.up);
      add(d.pendingApps, app, c.down, c.up);
    }
    d.totalDown += b.down;
    d.totalUp += b.up;
    push(d.history, { t: now, down: b.down / seconds, up: b.up / seconds });
    netDown += b.down;
    netUp += b.up;
  }
  push(networkHistory, { t: now, down: netDown / seconds, up: netUp / seconds });
}

/** Byte accounting is off by default; without it conntrack can't attribute traffic to apps. */
export async function enableConntrackAccounting(): Promise<void> {
  await writeFile("/proc/sys/net/netfilter/nf_conntrack_acct", "1").catch((err) => {
    console.warn(`enabling conntrack accounting failed, per-app usage will show as Other: ${(err as Error).message}`);
  });
}

export function startUsageCollector(): void {
  if (config.routerVlans.length === 0) return;
  void enableConntrackAccounting();
  setInterval(async () => {
    if (ticking) return;
    ticking = true;
    try {
      await tick();
    } catch (err) {
      console.warn(`usage tick failed: ${(err as Error).message}`);
    } finally {
      ticking = false;
    }
  }, TICK_MS);
}

function sorted(map: Map<string, Counter>) {
  return [...map]
    .map(([app, c]) => ({ app, down: Math.round(c.down), up: Math.round(c.up) }))
    .sort((a, b) => b.down + b.up - (a.down + a.up));
}

/** Hands the per-app bytes accumulated since the last call to the traffic report. */
export function drainAppUsage(mac: string): { apps: Array<{ app: string; bytesDown: number; bytesUp: number }>; ipAddress?: string; hostname?: string } {
  const d = devices.get(mac.toUpperCase());
  if (!d) return { apps: [] };
  const apps = sorted(d.pendingApps).map((a) => ({ app: a.app, bytesDown: a.down, bytesUp: a.up }));
  d.pendingApps = new Map();
  return { apps, ipAddress: d.ip, hostname: d.hostname };
}

/** Everything the dashboard's live view needs, at 5-second resolution. */
export function usageSnapshot() {
  return {
    generatedAt: new Date().toISOString(),
    tickMs: TICK_MS,
    network: networkHistory,
    devices: [...devices.values()].map((d) => {
      const current = d.history[d.history.length - 1] ?? { t: Date.now(), down: 0, up: 0 };
      return {
        macAddress: d.mac,
        routerId: d.routerId,
        ipAddress: d.ip ?? null,
        hostname: d.hostname ?? null,
        downBps: Math.round(current.down),
        upBps: Math.round(current.up),
        totalDown: d.totalDown,
        totalUp: d.totalUp,
        history: d.history,
        apps: sorted(d.appTotals).map((a) => {
          const rate = d.appRates.get(a.app);
          return { ...a, downBps: Math.round(rate?.down ?? 0), upBps: Math.round(rate?.up ?? 0) };
        }),
      };
    }),
  };
}
