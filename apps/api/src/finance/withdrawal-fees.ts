/**
 * Withdrawal fee schedule: a flat fee per band of withdrawal amount.
 *
 *   500 – 20,000      -> 2,500
 *   20,001 – 40,000   -> 3,000
 *   40,001 – 60,000   -> 3,500   ... +stepFee for every further band
 *
 * Stored as these few numbers (not hundreds of rows) so a super admin can
 * retune it; `feeTiers()` expands it into the table the UI shows.
 */
export interface FeeSchedule {
  minAmountUgx: number; // smallest withdrawal allowed (Ssentezo floor: 500)
  maxAmountUgx: number; // largest withdrawal allowed (Ssentezo ceiling: 7,000,000)
  bandSizeUgx: number; // width of each band, e.g. 20,000
  baseFeeUgx: number; // fee for the first band
  stepFeeUgx: number; // added per band after the first
}

export const SSENTEZO_MIN_UGX = 500;
export const SSENTEZO_MAX_UGX = 7_000_000;

export const DEFAULT_FEE_SCHEDULE: FeeSchedule = {
  minAmountUgx: 500,
  maxAmountUgx: SSENTEZO_MAX_UGX,
  bandSizeUgx: 20_000,
  baseFeeUgx: 2_500,
  stepFeeUgx: 500,
};

export function validateFeeSchedule(s: FeeSchedule): string | null {
  const ints = [s.minAmountUgx, s.maxAmountUgx, s.bandSizeUgx, s.baseFeeUgx, s.stepFeeUgx];
  if (!ints.every((n) => Number.isInteger(n) && n >= 0)) return "All fee values must be whole, non-negative UGX amounts";
  if (s.minAmountUgx < SSENTEZO_MIN_UGX) return `Minimum withdrawal can't be below UGX ${SSENTEZO_MIN_UGX.toLocaleString()} (Ssentezo limit)`;
  if (s.maxAmountUgx > SSENTEZO_MAX_UGX) return `Maximum withdrawal can't exceed UGX ${SSENTEZO_MAX_UGX.toLocaleString()} (Ssentezo limit)`;
  if (s.minAmountUgx > s.maxAmountUgx) return "Minimum withdrawal must be below the maximum";
  if (s.bandSizeUgx < 1000) return "Band size must be at least UGX 1,000";
  return null;
}

/** Fee for withdrawing `amountUgx`, or an error when the amount is outside the allowed range. */
export function withdrawalFee(amountUgx: number, s: FeeSchedule = DEFAULT_FEE_SCHEDULE): { feeUgx: number } | { error: string } {
  if (!Number.isInteger(amountUgx)) return { error: "Amount must be a whole number of UGX" };
  if (amountUgx < s.minAmountUgx) return { error: `Minimum withdrawal is UGX ${s.minAmountUgx.toLocaleString()}` };
  if (amountUgx > s.maxAmountUgx) return { error: `Maximum withdrawal is UGX ${s.maxAmountUgx.toLocaleString()}` };
  const band = Math.max(0, Math.ceil(amountUgx / s.bandSizeUgx) - 1);
  return { feeUgx: s.baseFeeUgx + band * s.stepFeeUgx };
}

/** The schedule expanded into rows for display, first `limit` bands. */
export function feeTiers(s: FeeSchedule = DEFAULT_FEE_SCHEDULE, limit = 12) {
  const tiers: Array<{ fromUgx: number; toUgx: number; feeUgx: number }> = [];
  for (let band = 0; tiers.length < limit; band++) {
    const from = band === 0 ? s.minAmountUgx : band * s.bandSizeUgx + 1;
    const to = Math.min((band + 1) * s.bandSizeUgx, s.maxAmountUgx);
    if (from > s.maxAmountUgx) break;
    if (to >= from) tiers.push({ fromUgx: from, toUgx: to, feeUgx: s.baseFeeUgx + band * s.stepFeeUgx });
  }
  return tiers;
}
