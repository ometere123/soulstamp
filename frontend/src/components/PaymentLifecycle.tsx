import { ExternalLink, ShieldCheck } from "lucide-react";
import { arcExplorerTx, formatUsdc } from "../lib/arc";
import type { TrustPassRequest } from "../lib/trustpass";

export function PaymentLifecycle({ request }: { request: TrustPassRequest | null }) {
  if (!request) return null;
  const stages = [
    ["Request", request.state !== ""],
    ["Consent", Boolean(request.consent_nonce)],
    ["Arc USDC escrow", request.payment_state === "ESCROWED" || request.payment_state === "SETTLED" || request.payment_state === "REFUNDED"],
    ["Assessment", Boolean(request.assessment_id)],
    ["Settlement", request.payment_state === "SETTLED"],
  ] as const;
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-brand-400" />
        <h3 className="font-semibold text-white">Verified lifecycle</h3>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {stages.map(([label, done]) => (
          <div key={label} className={`rounded-lg border px-3 py-2 text-xs ${done ? "border-emerald-700 bg-emerald-950/30 text-emerald-300" : "border-gray-700 text-gray-500"}`}>
            {done ? "✓ " : "○ "}{label}
          </div>
        ))}
      </div>
      <div className="grid sm:grid-cols-2 gap-2 text-xs text-gray-400">
        <span>State: <strong className="text-gray-200">{request.state}</strong></span>
        <span>Payment: <strong className="text-gray-200">{request.payment_state || "NONE"}</strong></span>
        <span>Quote: <strong className="text-gray-200">{formatUsdc(1_000_000n)} USDC</strong></span>
        <span>Assessment: <strong className="text-gray-200">{request.proposed_outcome || "pending"}</strong></span>
      </div>
      <div className="flex flex-wrap gap-3 text-xs">
        {request.arc_tx_hash && <a className="footer-link inline-flex items-center gap-1" href={arcExplorerTx(request.arc_tx_hash)} target="_blank" rel="noreferrer">Arc deposit <ExternalLink className="w-3 h-3" /></a>}
        {request.arc_settlement_tx_hash && <a className="footer-link inline-flex items-center gap-1" href={arcExplorerTx(request.arc_settlement_tx_hash)} target="_blank" rel="noreferrer">Arc settlement <ExternalLink className="w-3 h-3" /></a>}
        {request.arc_refund_tx_hash && <a className="footer-link inline-flex items-center gap-1" href={arcExplorerTx(request.arc_refund_tx_hash)} target="_blank" rel="noreferrer">Arc refund <ExternalLink className="w-3 h-3" /></a>}
      </div>
    </div>
  );
}
