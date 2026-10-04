import type { RouterVlanConfig } from "./config";
import { assertValidInterface, assertValidMac, run } from "./shell";

/**
 * Per-MAC bandwidth shaping + accounting with Linux HTB.
 *
 * - Download (gateway -> client): HTB classes on egress of the router's
 *   interface, classified by `ether dst <mac>`.
 * - Upload (client -> gateway): the interface's ingress is mirrored to a
 *   dedicated `ifb` device per router, where a symmetric set of HTB classes
 *   classifies by `ether src <mac>`. Ingress can't hold a queueing
 *   discipline itself, so this is how upload gets real shaping and per-class
 *   byte counters.
 *
 * Each MAC gets one class minor ID, used for its class on both devices and
 * as its filter priority, so removing a MAC can delete exactly its filter.
 */

const ROOT_HANDLE = "1:";
// tc parses class minors as hex. 0xffff is the default class for traffic
// that matches no customer: unauthenticated clients loading the portal,
// DNS/DHCP replies, the router's own management traffic.
const DEFAULT_MINOR = 0xffff;
const FIRST_MINOR = 0x10;
const LAST_MINOR = 0xfff0;
const DEFAULT_RATE = "2mbit";
const DEFAULT_CEIL = "20mbit";

const minorByMac = new Map<string, number>();
const freeMinors: number[] = [];
let nextMinor = FIRST_MINOR;

function allocateMinor(mac: string): number {
  const existing = minorByMac.get(mac);
  if (existing) return existing;
  const minor = freeMinors.pop() ?? nextMinor++;
  if (minor > LAST_MINOR) throw new Error("No free traffic-shaping class IDs left");
  minorByMac.set(mac, minor);
  return minor;
}

function classId(minor: number): string {
  return `1:${minor.toString(16)}`;
}

/**
 * HTB's computed default burst is tiny (~1.6 KB), which keeps a class well
 * below its configured rate. ~20 ms worth of the rate lets it actually
 * reach the speed the customer paid for.
 */
function burstFor(kbps: number): string {
  const bytes = Math.max(16 * 1024, Math.round(((kbps * 1000) / 8) * 0.02));
  return `${Math.ceil(bytes / 1024)}k`;
}

/**
 * fq_codel inside each class keeps one customer's big download from
 * queueing ahead of their own calls and page loads (bufferbloat), which is
 * most of what makes a shared hotspot feel slow.
 */
async function addFairQueue(iface: string, parent: string, handle: string): Promise<void> {
  await run("tc", ["qdisc", "replace", "dev", iface, "parent", parent, "handle", `${handle}:`, "fq_codel"]).catch((err) => {
    console.warn(`fq_codel on ${iface} ${parent} failed: ${(err as Error).message}`);
  });
}

async function resetRoot(iface: string): Promise<void> {
  await run("tc", ["qdisc", "del", "dev", iface, "root"]).catch(() => undefined);
  await run("tc", ["qdisc", "add", "dev", iface, "root", "handle", ROOT_HANDLE, "htb", "default", DEFAULT_MINOR.toString(16)]);
  const burst = burstFor(20_000);
  await run("tc", [
    "class", "add", "dev", iface, "parent", ROOT_HANDLE, "classid", classId(DEFAULT_MINOR),
    "htb", "rate", DEFAULT_RATE, "ceil", DEFAULT_CEIL, "burst", burst, "cburst", burst,
  ]);
  // Not "ffff:" — that handle is the ingress qdisc on router interfaces.
  await addFairQueue(iface, classId(DEFAULT_MINOR), "fffe");
}

/**
 * Rebuilds shaping for a router from scratch. Called at bootstrap, right
 * before every session is re-admitted, so classes and filters left over from
 * a previous agent run never shadow the ones created now.
 */
export async function ensureShapingForRouter(r: RouterVlanConfig): Promise<void> {
  const iface = assertValidInterface(r.vlanInterface);
  const ifbIface = assertValidInterface(r.ifbInterface);

  await run("ip", ["link", "add", ifbIface, "type", "ifb"]).catch(() => undefined);
  await run("ip", ["link", "set", ifbIface, "up"]);

  await resetRoot(iface);
  await resetRoot(ifbIface);

  await run("tc", ["qdisc", "del", "dev", iface, "ingress"]).catch(() => undefined);
  await run("tc", ["qdisc", "add", "dev", iface, "handle", "ffff:", "ingress"]);
  await run("tc", [
    "filter", "add", "dev", iface, "parent", "ffff:", "protocol", "all", "u32",
    "match", "u32", "0", "0",
    "action", "mirred", "egress", "redirect", "dev", ifbIface,
  ]);

  for (const minor of minorByMac.values()) freeMinors.push(minor);
  minorByMac.clear();
}

async function upsertClassAndFilter(
  iface: string,
  minor: number,
  kbps: number,
  matchDirection: "dst" | "src",
  mac: string,
  hadClass: boolean,
): Promise<void> {
  const rate = `${Math.max(8, Math.round(kbps))}kbit`;
  const burst = burstFor(kbps);
  // `replace` updates the rate in place and keeps the byte counters.
  await run("tc", [
    "class", "replace", "dev", iface, "parent", ROOT_HANDLE, "classid", classId(minor),
    "htb", "rate", rate, "ceil", rate, "burst", burst, "cburst", burst,
  ]);
  await addFairQueue(iface, classId(minor), minor.toString(16));
  if (hadClass) return;
  await run("tc", ["filter", "del", "dev", iface, "parent", ROOT_HANDLE, "prio", String(minor)]).catch(() => undefined);
  await run("tc", [
    "filter", "add", "dev", iface, "parent", ROOT_HANDLE, "protocol", "all", "prio", String(minor),
    "u32", "match", "ether", matchDirection, mac, "flowid", classId(minor),
  ]);
}

/** Returns true when the MAC already had a class, i.e. its byte counters carried over. */
export async function applyShapingForMac(r: RouterVlanConfig, mac: string, downKbps: number, upKbps: number): Promise<boolean> {
  const safeMac = assertValidMac(mac).toUpperCase();
  const hadClass = minorByMac.has(safeMac);
  const minor = allocateMinor(safeMac);

  await upsertClassAndFilter(assertValidInterface(r.vlanInterface), minor, downKbps, "dst", safeMac, hadClass);
  await upsertClassAndFilter(assertValidInterface(r.ifbInterface), minor, upKbps, "src", safeMac, hadClass);
  return hadClass;
}

export async function removeShapingForMac(r: RouterVlanConfig, mac: string): Promise<void> {
  const safeMac = assertValidMac(mac).toUpperCase();
  const minor = minorByMac.get(safeMac);
  if (!minor) return;

  for (const iface of [assertValidInterface(r.vlanInterface), assertValidInterface(r.ifbInterface)]) {
    await run("tc", ["filter", "del", "dev", iface, "parent", ROOT_HANDLE, "prio", String(minor)]).catch(() => undefined);
    await run("tc", ["class", "del", "dev", iface, "classid", classId(minor)]).catch(() => undefined);
  }
  minorByMac.delete(safeMac);
  freeMinors.push(minor);
}

/** Cumulative bytes per MAC on one interface, from a single `tc` call. */
export async function readAllMacBytes(iface: string): Promise<Map<string, number>> {
  const { stdout } = await run("tc", ["-s", "class", "show", "dev", assertValidInterface(iface)]);
  const macByMinor = new Map([...minorByMac].map(([mac, minor]) => [minor, mac]));
  const bytes = new Map<string, number>();
  // Each class block starts "class htb 1:1a ..." and its stats line follows: " Sent 12345 bytes ...".
  for (const block of stdout.split(/\n(?=class )/)) {
    const id = block.match(/^class \w+ 1:([0-9a-f]+)/);
    const sent = block.match(/Sent (\d+) bytes/);
    if (!id || !sent) continue;
    const mac = macByMinor.get(parseInt(id[1], 16));
    if (mac) bytes.set(mac, Number(sent[1]));
  }
  return bytes;
}

/** Cumulative bytes sent through a MAC's class — the router interface gives download, its ifb gives upload. */
export async function readClassBytes(iface: string, mac: string): Promise<number | null> {
  const minor = minorByMac.get(assertValidMac(mac).toUpperCase());
  if (!minor) return null;
  const { stdout } = await run("tc", ["-s", "class", "show", "dev", assertValidInterface(iface), "classid", classId(minor)]);
  const match = stdout.match(/Sent (\d+) bytes/);
  return match ? Number(match[1]) : null;
}
