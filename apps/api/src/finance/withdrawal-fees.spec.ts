import { DEFAULT_FEE_SCHEDULE, feeTiers, validateFeeSchedule, withdrawalFee } from "./withdrawal-fees";

const fee = (amount: number) => {
  const result = withdrawalFee(amount);
  if ("error" in result) throw new Error(result.error);
  return result.feeUgx;
};

describe("withdrawalFee", () => {
  it("charges 2,500 from 500 up to 20,000", () => {
    expect(fee(500)).toBe(2500);
    expect(fee(10_000)).toBe(2500);
    expect(fee(20_000)).toBe(2500);
  });

  it("charges 3,000 above 20,000 up to 40,000", () => {
    expect(fee(20_001)).toBe(3000);
    expect(fee(21_000)).toBe(3000);
    expect(fee(40_000)).toBe(3000);
  });

  it("adds 500 for each further 20,000 band", () => {
    expect(fee(40_001)).toBe(3500);
    expect(fee(60_000)).toBe(3500);
    expect(fee(100_000)).toBe(4500);
    expect(fee(7_000_000)).toBe(2500 + 349 * 500);
  });

  it("rejects amounts outside the allowed range", () => {
    expect(withdrawalFee(499)).toEqual({ error: "Minimum withdrawal is UGX 500" });
    expect("error" in withdrawalFee(7_000_001)).toBe(true);
    expect("error" in withdrawalFee(1000.5)).toBe(true);
  });
});

describe("feeTiers", () => {
  it("expands the default schedule into contiguous bands", () => {
    const tiers = feeTiers(DEFAULT_FEE_SCHEDULE, 3);
    expect(tiers).toEqual([
      { fromUgx: 500, toUgx: 20_000, feeUgx: 2500 },
      { fromUgx: 20_001, toUgx: 40_000, feeUgx: 3000 },
      { fromUgx: 40_001, toUgx: 60_000, feeUgx: 3500 },
    ]);
  });

  it("stops at the maximum amount", () => {
    const tiers = feeTiers({ ...DEFAULT_FEE_SCHEDULE, maxAmountUgx: 50_000 }, 12);
    expect(tiers.at(-1)).toEqual({ fromUgx: 40_001, toUgx: 50_000, feeUgx: 3500 });
  });
});

describe("validateFeeSchedule", () => {
  it("accepts the default and enforces Ssentezo limits", () => {
    expect(validateFeeSchedule(DEFAULT_FEE_SCHEDULE)).toBeNull();
    expect(validateFeeSchedule({ ...DEFAULT_FEE_SCHEDULE, minAmountUgx: 100 })).toMatch(/below/);
    expect(validateFeeSchedule({ ...DEFAULT_FEE_SCHEDULE, maxAmountUgx: 8_000_000 })).toMatch(/exceed/);
  });
});
