import { describe, expect, it } from "vitest";
import { generateRuleset } from "../nft";
import type { RouterVlanConfig } from "../config";

const router: RouterVlanConfig = {
  parentInterface: "eth0",
  vlanId: 10,
  routerId: "router-a",
  vlanInterface: "eth0.10",
  ifbInterface: "ifb-v10",
  subnetCidr: "10.50.10.0/24",
  gatewayIp: "10.50.10.1",
};

describe("generateRuleset", () => {
  it("gates forwarding on the authorized_macs set per router VLAN", () => {
    const ruleset = generateRuleset("wlan0", [router], 8080);
    expect(ruleset).toContain("iifname \"eth0.10\" oifname \"wlan0\" ether saddr @authorized_macs accept");
    expect(ruleset).toContain("policy drop;");
  });

  it("DNATs unauthorized port-80 traffic to the portal on that router's gateway IP", () => {
    const ruleset = generateRuleset("wlan0", [router], 8080);
    expect(ruleset).toContain(
      "iifname \"eth0.10\" tcp dport 80 ether saddr != @authorized_macs dnat to 10.50.10.1:8080",
    );
  });

  it("always allows DNS/DHCP to the gateway so the portal is reachable before auth", () => {
    const ruleset = generateRuleset("wlan0", [router], 8080);
    expect(ruleset).toContain("iifname \"eth0.10\" udp dport { 53, 67 } accept");
  });
});
