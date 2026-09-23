import { inferOriginTtl, scoreTtlAnomaly } from "./ttl-fingerprint.util";

describe("inferOriginTtl", () => {
  it("rounds a decremented TTL up to the nearest common OS default", () => {
    expect(inferOriginTtl(61)).toBe(64); // e.g. Linux/macOS, 3 hops away
    expect(inferOriginTtl(120)).toBe(128); // Windows, a few hops away
    expect(inferOriginTtl(250)).toBe(255); // some routers/network gear
  });
});

describe("scoreTtlAnomaly", () => {
  it("scores 0 when every sample implies the same origin OS (a single device)", () => {
    expect(scoreTtlAnomaly([64, 63, 64, 62])).toBe(0);
  });

  it("scores > 0 when samples imply multiple distinct origin OSes (likely re-shared)", () => {
    expect(scoreTtlAnomaly([64, 128])).toBeGreaterThan(0);
  });

  it("caps at 1 regardless of how many distinct fingerprints appear", () => {
    expect(scoreTtlAnomaly([64, 128, 255])).toBeLessThanOrEqual(1);
  });

  it("returns 0 for no samples", () => {
    expect(scoreTtlAnomaly([])).toBe(0);
  });
});
