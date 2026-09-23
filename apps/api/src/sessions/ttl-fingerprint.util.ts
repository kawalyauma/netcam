/**
 * Heuristic re-sharing detector: infer the OS's original TTL from an
 * observed TTL (packets lose 1 per router hop) by rounding up to the
 * nearest common OS default, then count how many distinct "originating
 * device" fingerprints show up behind a single authorized MAC over a
 * sampling window. >1 distinct fingerprint strongly suggests the MAC is a
 * phone/router re-sharing its connection (each downstream device has its
 * own OS TTL default), not a single client device.
 *
 * This is a heuristic, not proof — documented in ARCHITECTURE.md.
 */
const COMMON_OS_DEFAULT_TTLS = [64, 128, 255];

export function inferOriginTtl(observedTtl: number): number {
  const candidate = COMMON_OS_DEFAULT_TTLS.find((d) => observedTtl <= d);
  return candidate ?? 255;
}

/** Returns a 0..1 anomaly score: fraction of distinct origin-TTL fingerprints beyond the first. */
export function scoreTtlAnomaly(observedTtls: number[]): number {
  if (observedTtls.length === 0) return 0;
  const fingerprints = new Set(observedTtls.map(inferOriginTtl));
  if (fingerprints.size <= 1) return 0;
  return Math.min(1, (fingerprints.size - 1) / 2);
}
