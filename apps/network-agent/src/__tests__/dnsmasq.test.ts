import { describe, expect, it } from "vitest";
import type { RouterVlanConfig } from "../config";
import { generateDnsmasqConf } from "../dnsmasq";

describe("generateDnsmasqConf", () => {
  it("advertises the segment captive portal with DHCP option 114", () => {
    const router: RouterVlanConfig = {
      parentInterface: "eno1",
      vlanId: null,
      subnetId: 10,
      routerId: "router-a",
      vlanInterface: "eno1",
      ifbInterface: "ifb-l10",
      subnetCidr: "10.50.10.0/24",
      gatewayIp: "10.50.10.1",
    };

    expect(generateDnsmasqConf([router], 8082)).toContain(
      "dhcp-option=tag:router-router-a,114,http://10.50.10.1:8082/",
    );
  });
});
