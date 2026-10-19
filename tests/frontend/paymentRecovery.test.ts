import { describe, expect, it } from "vitest";
import { classifyPaymentRecovery } from "../../frontend/src/lib/paymentRecovery";

const PAYER = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";

describe("chain-backed payment recovery", () => {
  it("does not offer Resume before an Arc deposit exists", () => {
    expect(classifyPaymentRecovery({ requestState: "AWAITING_PAYMENT", paymentStatus: 0, connectedWallet: PAYER })).toBe("NO_PAYMENT");
  });

  it("recovers an existing deposit for the original payer without a second payment", () => {
    expect(classifyPaymentRecovery({ requestState: "AWAITING_PAYMENT", paymentStatus: 1, paymentPayer: PAYER, connectedWallet: PAYER, depositedAt: 1_000, now: 1_100 })).toBe("RESUME");
  });

  it("rejects Resume from a different wallet", () => {
    expect(classifyPaymentRecovery({ requestState: "AWAITING_PAYMENT", paymentStatus: 1, paymentPayer: PAYER, connectedWallet: OTHER, depositedAt: 1_000, now: 1_100 })).toBe("WRONG_WALLET");
  });

  it("distinguishes the 72-hour refund boundary", () => {
    expect(classifyPaymentRecovery({ requestState: "FUNDED", paymentStatus: 1, paymentPayer: PAYER, connectedWallet: OTHER, depositedAt: 1_000, now: 1_000 + 72 * 60 * 60 - 1 })).toBe("REFUND_PENDING");
    expect(classifyPaymentRecovery({ requestState: "FUNDED", paymentStatus: 1, paymentPayer: PAYER, connectedWallet: OTHER, depositedAt: 1_000, now: 1_000 + 72 * 60 * 60 })).toBe("REFUND_AVAILABLE");
  });

  it("treats settled and refunded escrow as terminal", () => {
    expect(classifyPaymentRecovery({ requestState: "ACTIVE", paymentStatus: 2 })).toBe("SETTLED");
    expect(classifyPaymentRecovery({ requestState: "REFUNDED", paymentStatus: 3 })).toBe("REFUNDED");
  });
});
