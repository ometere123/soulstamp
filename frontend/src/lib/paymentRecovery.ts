export type PaymentRecoveryStatus = "NONE" | "ESCROWED" | "SETTLED" | "REFUNDED";

export type PaymentRecoveryInput = {
  requestState: string;
  paymentStatus: number;
  paymentPayer?: string;
  connectedWallet?: string;
  depositedAt?: number;
  now?: number;
};

/** A refund date is meaningful only for a live Arc escrow record. Never
 * derive one from a request-only timestamp or from zero, which renders as
 * January 1970 in browsers. */
export function refundAvailableAtFromEscrow(paymentStatus: number, depositedAt?: number): number | null {
  if (Number(paymentStatus) !== 1) return null;
  const deposited = Number(depositedAt || 0);
  if (!Number.isFinite(deposited) || deposited <= 0) return null;
  return deposited + 72 * 60 * 60;
}

/**
 * Classify a request from chain-read facts only.  This is deliberately pure
 * so reload, disconnected-wallet and duplicate-payment behavior can be tested
 * without a browser or a mock "paid" flag.
 */
export function classifyPaymentRecovery(input: PaymentRecoveryInput): "NO_PAYMENT" | "RESUME" | "WRONG_WALLET" | "ESCROWED" | "REFUND_PENDING" | "REFUND_AVAILABLE" | "SETTLED" | "REFUNDED" {
  const status = Number(input.paymentStatus);
  if (status === 0) return "NO_PAYMENT";
  if (status === 2) return "SETTLED";
  if (status === 3) return "REFUNDED";
  if (status !== 1) return "NO_PAYMENT";

  const connected = String(input.connectedWallet || "").toLowerCase();
  const payer = String(input.paymentPayer || "").toLowerCase();
  if (input.requestState === "AWAITING_PAYMENT") {
    if (!connected || !payer || connected !== payer) return "WRONG_WALLET";
    return "RESUME";
  }
  const refundAt = refundAvailableAtFromEscrow(status, input.depositedAt) || 0;
  if (refundAt > 0 && Number(input.now ?? Math.floor(Date.now() / 1000)) >= refundAt) return "REFUND_AVAILABLE";
  return "REFUND_PENDING";
}
