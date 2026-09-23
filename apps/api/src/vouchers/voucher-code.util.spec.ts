import { generateVoucherCode } from "./voucher-code.util";

describe("generateVoucherCode", () => {
  it("produces a XXXX-XXXX-XXXX shaped code with no ambiguous characters", () => {
    const code = generateVoucherCode();
    const charClass = "[23456789A-HJKMNP-Z]";
    expect(code).toMatch(new RegExp(`^${charClass}{4}-${charClass}{4}-${charClass}{4}$`));
    expect(code).not.toMatch(/[01OIL]/);
  });

  it("generates distinct codes across many calls", () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateVoucherCode()));
    expect(codes.size).toBe(200);
  });
});
