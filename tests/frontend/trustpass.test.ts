import { describe, expect, it } from "vitest";
import { ASSESSMENT_PRICE_USDC, formatUsdc } from "../../frontend/src/lib/arc";

describe("TrustPass payment display invariants", () => {
  it("keeps the initial price at exactly one six-decimal USDC", () => {
    expect(ASSESSMENT_PRICE_USDC).toBe(1_000_000n);
    expect(formatUsdc(ASSESSMENT_PRICE_USDC)).toBe("1");
    expect(formatUsdc(1_000_001n)).toBe("1.000001");
  });

  it("does not round fractional USDC values upward", () => {
    expect(formatUsdc(999_999n)).toBe("0.999999");
    expect(formatUsdc(0n)).toBe("0");
  });
});
