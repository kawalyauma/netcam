import type { RouterVlanConfig } from "./config";
import { assertValidInterface, run } from "./shell";

/** Ensures the per-router 802.1Q VLAN sub-interface exists, is up, and owns its gateway IP. Idempotent. */
export async function ensureVlanInterface(r: RouterVlanConfig): Promise<void> {
  const parent = assertValidInterface(r.parentInterface);
  const iface = assertValidInterface(r.vlanInterface);

  const exists = await run("ip", ["link", "show", iface]).then(
    () => true,
    () => false,
  );

  if (!exists) {
    await run("ip", ["link", "add", "link", parent, "name", iface, "type", "vlan", "id", String(r.vlanId)]);
  }

  await run("ip", ["link", "set", iface, "up"]);

  const gatewayCidr = `${r.gatewayIp}/24`;
  const hasAddr = await run("ip", ["addr", "show", iface]).then(
    ({ stdout }) => stdout.includes(r.gatewayIp),
    () => false,
  );
  if (!hasAddr) {
    await run("ip", ["addr", "add", gatewayCidr, "dev", iface]);
  }
}

export async function ensureAllVlanInterfaces(routerVlans: RouterVlanConfig[]): Promise<void> {
  for (const r of routerVlans) {
    await ensureVlanInterface(r);
  }
}
