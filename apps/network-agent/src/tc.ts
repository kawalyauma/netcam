import type { RouterVlanConfig } from "./config";
import { assertValidInterface, assertValidMac, run } from "./shell";

/**
 * Per-MAC bandwidth shaping + accounting with Linux HTB.
 *
 * - Download (gateway -> client): HTB classes on egress of the router's
 *   VLAN interface, classified by `ether dst <mac>`.
 * - Upload (client -> gateway): the VLAN interface's ingress is mirrored to
 *   a dedicated `ifb` device per router (`tc ... action mirred egress
 *   redirect`), where we apply a second, symmetric set of HTB classes
 *   classified by `ether src <mac>`. This is the standard way to get real
 *   queueing (not just drop-on-excess) and per-class byte counters for
 *   upload on Linux, since ingress itself can't hold a queueing discipline.
 *
 * Best-effort: validate actual throughput/accounting on real hardware —
 * NIC driver and kernel differences can affect HTB/u32 behavior.
 */

const ROOT_HANDLE = "1:";
const DEFAULT_CLASS_ID = "1:999";
let nextClassId = 10;
const classIdByMac = new Map<string, number>();

function classIdFor(mac: string): number {
  let id = classIdByMac.get(mac);
  if (!id) {
    id = nextClassId++;
    classIdByMac.set(mac, id);
  }
  return id;
}

async function ignoreIfExists(promise: Promise<unknown>): Promise<void> {
  try {
    await promise;
  } catch (err) {
    if (!/File exists/i.test((err as Error).message)) throw err;
  }
}

async function ensureHtbRoot(iface: string): Promise<void> {
  await ignoreIfExists(
    run("tc", ["qdisc", "add", "dev", iface, "root", "handle", ROOT_HANDLE, "htb", "default", "999"]),
  );
  await ignoreIfExists(
    run("tc", [
      "class", "add", "dev", iface, "parent", ROOT_HANDLE, "classid", DEFAULT_CLASS_ID,
      "htb", "rate", "512kbit", "ceil", "1mbit",
    ]),
  );
}

/** Sets up the download HTB root on the VLAN interface and the ifb mirror + HTB root for upload. */
export async function ensureShapingForRouter(r: RouterVlanConfig): Promise<void> {
  const vlanIface = assertValidInterface(r.vlanInterface);
  const ifbIface = assertValidInterface(r.ifbInterface);

  await ignoreIfExists(run("ip", ["link", "add", ifbIface, "type", "ifb"]));
  await run("ip", ["link", "set", ifbIface, "up"]);

  await ensureHtbRoot(vlanIface);
  await ensureHtbRoot(ifbIface);

  await ignoreIfExists(run("tc", ["qdisc", "add", "dev", vlanIface, "handle", "ffff:", "ingress"]));
  await ignoreIfExists(
    run("tc", [
      "filter", "add", "dev", vlanIface, "parent", "ffff:", "protocol", "all", "u32",
      "match", "u32", "0", "0",
      "action", "mirred", "egress", "redirect", "dev", ifbIface,
    ]),
  );
}

async function addClassAndFilter(
  iface: string,
  classid: string,
  kbps: number,
  matchDirection: "dst" | "src",
  mac: string,
): Promise<void> {
  await ignoreIfExists(
    run("tc", [
      "class", "add", "dev", iface, "parent", ROOT_HANDLE, "classid", classid,
      "htb", "rate", `${kbps}kbit`, "ceil", `${kbps}kbit`,
    ]),
  );
  await ignoreIfExists(
    run("tc", [
      "filter", "add", "dev", iface, "parent", ROOT_HANDLE, "protocol", "all", "prio", "1",
      "u32", "match", "ether", matchDirection, mac, "flowid", classid,
    ]),
  );
}

export async function applyShapingForMac(r: RouterVlanConfig, mac: string, downKbps: number, upKbps: number): Promise<void> {
  const safeMac = assertValidMac(mac);
  const classId = classIdFor(safeMac);
  const classid = `1:${classId}`;

  await addClassAndFilter(assertValidInterface(r.vlanInterface), classid, downKbps, "dst", safeMac);
  await addClassAndFilter(assertValidInterface(r.ifbInterface), classid, upKbps, "src", safeMac);
}

export async function removeShapingForMac(r: RouterVlanConfig, mac: string): Promise<void> {
  const safeMac = assertValidMac(mac);
  const classId = classIdByMac.get(safeMac);
  if (!classId) return;
  const classid = `1:${classId}`;

  await run("tc", ["class", "del", "dev", assertValidInterface(r.vlanInterface), "classid", classid]).catch(() => undefined);
  await run("tc", ["class", "del", "dev", assertValidInterface(r.ifbInterface), "classid", classid]).catch(() => undefined);
  classIdByMac.delete(safeMac);
}

/** Reads cumulative bytes sent through a MAC's HTB class — call for both the VLAN iface (download) and ifb iface (upload). */
export async function readClassBytes(iface: string, mac: string): Promise<number | null> {
  const classId = classIdByMac.get(assertValidMac(mac));
  if (!classId) return null;
  const { stdout } = await run("tc", ["-s", "class", "show", "dev", assertValidInterface(iface), "classid", `1:${classId}`]);
  const match = stdout.match(/Sent (\d+) bytes/);
  return match ? Number(match[1]) : null;
}
