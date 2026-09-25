import { extractSsentezoError, parseTransactionStatus } from "./ssentezo.gateway";

describe("Ssentezo response parsing", () => {
  it("normalizes known statuses and rejects unknown ones", () => {
    expect(parseTransactionStatus("succeeded")).toBe("SUCCEEDED");
    expect(parseTransactionStatus("PENDING")).toBe("PENDING");
    expect(parseTransactionStatus("REFUNDED")).toBeUndefined();
    expect(parseTransactionStatus(null)).toBeUndefined();
  });

  it("includes field validation errors", () => {
    expect(
      extractSsentezoError(
        { error: { message: "Validation failed", errors: { msisdn: ["The phone number is invalid"] } } },
        422,
      ),
    ).toBe("Validation failed: The phone number is invalid");
  });

  it("falls back to the HTTP status for malformed errors", () => {
    expect(extractSsentezoError(undefined, 503)).toBe("Ssentezo HTTP 503");
  });
});
