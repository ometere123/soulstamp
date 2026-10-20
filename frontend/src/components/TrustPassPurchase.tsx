import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, CreditCard, FileCheck2, RefreshCw } from "lucide-react";
import { ensureStudionet } from "../lib/client";
import { findArcDepositReference, payAssessment, readArcPayment, refundArcPayment, type ArcDepositReference, type ArcPaymentRecord } from "../lib/arc";
import { GoogleVerification } from "./GoogleVerification";
import { HumanPassportPanel } from "./HumanPassportPanel";
import { PaymentLifecycle } from "./PaymentLifecycle";
import { classifyPaymentRecovery, refundAvailableAtFromEscrow } from "../lib/paymentRecovery";
import { selectGoogleRequest, type GoogleCallback } from "../lib/google";
import {
  confirmArcPayment,
  cancelAssessmentRequest,
  consentAssessment,
  confirmArcRefund,
  createAssessmentRequest,
  createPolicy,
  evaluateAssessment,
  getPaymentIntent,
  getPolicy,
  getRequests,
  getRequest,
  getV4Stats,
  type TrustPassPolicy,
  type TrustPassRequest,
} from "../lib/trustpass";

const IDENTITY_POLICY_ID = "identity-trustpass-v1";
const SYBIL_POLICY_ID = "sybil-trustpass-v1";

function policyDraft(sybil: boolean) {
  return {
    version: 1,
    required_credentials: sybil ? ["github", "discord"] : ["github"],
    minimum_proof_strength: sybil ? "STRONG" : "MEDIUM",
    maximum_evidence_age_seconds: 30 * 24 * 60 * 60,
    maximum_trustpass_lifetime_seconds: 7 * 24 * 60 * 60,
    external_humanity_required: sybil,
    minimum_humanity_score: 200000,
    permitted_assessment_use: sybil ? "sybil_screening" : "access_decision",
    assessment_price_usdc: 1000000,
    enabled: true,
  };
}

export function TrustPassPurchase({ wallet, googleCallback }: { wallet: string; googleCallback?: GoogleCallback }) {
  const [sybil, setSybil] = useState(false);
  const [policy, setPolicy] = useState<TrustPassPolicy | null>(null);
  const [request, setRequest] = useState<TrustPassRequest | null>(null);
  const [arcPayment, setArcPayment] = useState<ArcPaymentRecord | null>(null);
  const [depositReference, setDepositReference] = useState<ArcDepositReference | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [v4HumanityMode, setV4HumanityMode] = useState("LEGACY_DECODER");
  const policyId = sybil ? SYBIL_POLICY_ID : IDENTITY_POLICY_ID;

  const linkedGoogle = Boolean(request?.google_commitment);
  const canPay = request?.state === "AWAITING_PAYMENT" && Boolean(request.consent_nonce);
  const canEvaluate = request?.state === "FUNDED" && (!policy?.external_humanity_required || (v4HumanityMode.includes("EAS_UNIFIED") && Boolean(request.humanity_snapshot_ref)));

  async function inspectArcPayment(current: TrustPassRequest): Promise<{ payment: ArcPaymentRecord; reference: ArcDepositReference | null } | null> {
    if (current.state !== "AWAITING_PAYMENT" && current.payment_state !== "ESCROWED") {
      setArcPayment(null);
      setDepositReference(null);
      return null;
    }
    try {
      const intent = await getPaymentIntent(current.request_id);
      const payment = await readArcPayment(String(intent.request_key) as `0x${string}`);
      setArcPayment(payment);
      if (payment.status !== 1) {
        setDepositReference(null);
        return { payment, reference: null };
      }
      const reference = await findArcDepositReference(String(intent.request_key) as `0x${string}`, current.arc_tx_hash && Number(current.arc_log_index ?? -1) >= 0 && Number(current.arc_deposit_block_number ?? 0) > 0 ? {
        transactionHash: current.arc_tx_hash as `0x${string}`,
        logIndex: Number(current.arc_log_index),
        blockNumber: BigInt(Number(current.arc_deposit_block_number)),
      } : undefined);
      setDepositReference(reference);
      return { payment, reference };
    } catch (cause) {
      // A public RPC/log-indexing failure must not make a confirmed V4
      // request look unpaid; keep the chain request visible and let Resume
      // retry the Arc read explicitly.
      setArcPayment(null);
      setDepositReference(null);
      setNotice(cause instanceof Error ? `Arc recovery read unavailable: ${cause.message}` : "Arc recovery read unavailable.");
      return null;
    }
  }

  async function refresh() {
    setRequest(null);
    setPolicy(null);
    setArcPayment(null);
    setDepositReference(null);
    setError("");
    try {
      try {
        const stats = await getV4Stats();
        setV4HumanityMode(String(stats.human_passport_evidence_mode || "LEGACY_DECODER"));
      } catch {
        setV4HumanityMode("LEGACY_DECODER");
      }
      const found = await getRequests(wallet, 0, 50);
      let latest: TrustPassRequest | null;
      if (googleCallback?.status === "ready" && googleCallback.pendingId) {
        latest = selectGoogleRequest(found, googleCallback, wallet);
        if (!latest) {
          try {
            const exact = await getRequest(googleCallback.pendingId);
            if (exact.subject.toLowerCase() !== wallet.toLowerCase()) throw new Error("The connected wallet does not own the Google-link request.");
            latest = exact;
          } catch (cause) {
            throw new Error(cause instanceof Error ? cause.message : "The Google callback's TrustPass request was not found.");
          }
        }
      } else {
        latest = [...found].sort((left, right) => Number(right.created_at || 0) - Number(left.created_at || 0))[0] || null;
      }
      setRequest(latest);
      if (latest) {
        const selected = await getPolicy(latest.policy_id);
        if (selected.found !== false) {
          setPolicy(selected);
          setSybil(latest.policy_id === SYBIL_POLICY_ID);
        }
        await inspectArcPayment(latest);
      } else setPolicy(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => { void refresh(); }, [wallet]);

  async function preparePolicy() {
    setBusy(true); setError(""); setNotice("");
    try {
      let selected = await getPolicy(policyId);
      if (selected.found === false) {
        await createPolicy(policyId, policyDraft(sybil));
        selected = await getPolicy(policyId);
      }
      if (selected.found === false) throw new Error("The policy was not available after publication.");
      setPolicy(selected);
      setNotice(`Policy ${policyId} is pinned at ${selected.policy_hash}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  async function createRequest() {
    setBusy(true); setError(""); setNotice("");
    try {
      if (!policy || policy.policy_id !== policyId) await preparePolicy();
      await createAssessmentRequest(policyId, wallet, sybil ? "sybil_screening" : "access_decision", false);
      await refresh();
      setNotice("Request created. Consent is still required before any payment can be made.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  async function consent() {
    if (!request) return;
    setBusy(true); setError("");
    try {
      const latest = await getRequest(request.request_id);
      const now = Math.floor(Date.now() / 1000);
      const expires = Math.min(now + 20 * 60, Number(latest.created_at) + 30 * 60 - 1);
      if (expires <= now) throw new Error("This request's consent window has expired. Create a fresh request.");
      await consentAssessment(latest.request_id, latest.purpose, crypto.randomUUID().replace(/-/g, ""), expires);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  async function pay() {
    if (!request) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const observed = await inspectArcPayment(request);
      if (observed?.payment.status === 1) {
        const recovery = classifyPaymentRecovery({ requestState: request.state, paymentStatus: observed.payment.status, paymentPayer: observed.payment.payer, connectedWallet: wallet, depositedAt: Number(observed.payment.depositedAt) });
        setNotice(recovery === "WRONG_WALLET" ? "An Arc deposit exists, but only the original payer can confirm it on GenLayer." : "An Arc deposit already exists for this request. Resume will bind that existing deposit; no second payment is permitted.");
        return;
      }
      const intent = await getPaymentIntent(request.request_id);
      const result = await payAssessment(
        wallet,
        String(intent.request_key) as `0x${string}`,
        String(intent.subject),
        String(intent.policy_hash) as `0x${string}`,
        BigInt(String(intent.payment_nonce)),
        BigInt(String(intent.intent_expires_at)),
      );
      setDepositReference({ transactionHash: result.depositHash, logIndex: result.logIndex, blockNumber: result.receipt.blockNumber });
      try {
        await ensureStudionet();
        await confirmArcPayment(request.request_id, result.depositHash, result.logIndex);
      } catch (cause) {
        await inspectArcPayment(request);
        throw cause;
      }
      await refresh();
      setNotice("Arc deposit is final and bound to this request. The browser did not mark it paid; GenLayer accepted the receipt and post-state.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  async function resumePayment() {
    if (!request) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const observed = await inspectArcPayment(request);
      if (!observed || observed.payment.status !== 1 || !observed.reference) throw new Error("No recoverable escrow deposit was found for this request.");
      if (observed.payment.payer.toLowerCase() !== wallet.toLowerCase()) throw new Error("Connect the original payer wallet to confirm this existing Arc deposit.");
      await ensureStudionet();
      await confirmArcPayment(request.request_id, observed.reference.transactionHash, observed.reference.logIndex);
      await refresh();
      setNotice("The existing Arc deposit was recovered and confirmed on GenLayer. No second payment was submitted.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  async function refund() {
    if (!request) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const observed = await inspectArcPayment(request);
      if (!observed || observed.payment.status !== 1) throw new Error("No escrowed Arc payment is available for refund.");
      if (observed.payment.payer.toLowerCase() !== wallet.toLowerCase()) throw new Error("Only the original payer wallet can request this refund.");
      const availableAt = refundAvailableAtFromEscrow(observed.payment.status, Number(observed.payment.depositedAt));
      if (availableAt === null) throw new Error("No genuine escrow deposit timestamp is available for refund.");
      if (Math.floor(Date.now() / 1000) < availableAt) throw new Error(`Refund becomes available at ${new Date(availableAt * 1000).toLocaleString()}.`);
      const refundResult = await refundArcPayment(wallet, observed.payment.requestId);
      await ensureStudionet();
      await confirmArcRefund(request.request_id, refundResult.refundHash, refundResult.logIndex);
      await refresh();
      setNotice("Refund confirmed on Arc and finalized on GenLayer. The original payer received the escrowed USDC.");
    } catch (cause) {
      await refresh();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  async function evaluate() {
    if (!request) return;
    setBusy(true); setError(""); setNotice("");
    try { await evaluateAssessment(request.request_id); await refresh(); setNotice("Independent assessment finalized. Settlement remains a separate operator acknowledgement; PASS is not usable before it."); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  async function cancelRequest() {
    if (!request) return;
    setBusy(true); setError("");
    try { await cancelAssessmentRequest(request.request_id); await refresh(); setNotice("The unpaid request was cancelled; no Arc funds were moved."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  function startNewRequest() {
    setRequest(null);
    setPolicy(null);
    setArcPayment(null);
    setDepositReference(null);
    setError("");
    setNotice("Choose a tier and pin its policy before creating another request.");
  }

  const displayedPolicyId = request?.policy_id || policy?.policy_id || policyId;
  const displayedSybil = request ? request.policy_id === SYBIL_POLICY_ID : sybil;
  const displayedRequirements = policy?.external_humanity_required || displayedSybil ? "GitHub + Discord + Passport ≥ 20" : "GitHub + current V3 eligibility";

  return <div className="space-y-4">
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-5 space-y-4">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div><p className="text-xs uppercase tracking-widest text-brand-400">Paid assessment</p><h2 className="text-xl font-bold text-white mt-1">Create a TrustPass</h2><p className="text-sm text-gray-400 mt-2 max-w-2xl">Payment purchases an independent assessment, never a PASS. Unsettled, stale or unavailable evidence cannot become consumable eligibility.</p></div>
        <label className="flex items-center gap-2 text-sm text-gray-300"><input type="checkbox" checked={sybil} disabled={busy || Boolean(request)} onChange={(event) => { setSybil(event.target.checked); setPolicy(null); }} /> Sybil-resistant tier</label>
      </div>
      <div className="grid sm:grid-cols-3 gap-3 text-xs text-gray-400"><div className="rounded-lg border border-gray-800 p-3">Policy<br /><strong className="text-gray-200">{displayedPolicyId}</strong></div><div className="rounded-lg border border-gray-800 p-3">Requirements<br /><strong className="text-gray-200">{displayedRequirements}</strong></div><div className="rounded-lg border border-gray-800 p-3">Price<br /><strong className="text-gray-200">1 USDC · 6 decimals</strong></div></div>
      <div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={preparePolicy} disabled={busy || Boolean(request)}><FileCheck2 className="w-4 h-4" />{busy ? "Working…" : "Pin policy"}</button><button className="btn-primary" onClick={createRequest} disabled={busy}><CheckCircle2 className="w-4 h-4" />Create self-paid request</button><button className="btn-secondary" onClick={() => void refresh()} disabled={busy}><RefreshCw className="w-4 h-4" />Resume</button>{request && <button className="btn-secondary" onClick={startNewRequest} disabled={busy}>Choose another tier</button>}</div>
      {googleCallback?.status === "ready" && !request && <p className="text-sm text-yellow-300">Google authenticated, but the matching TrustPass request is unavailable for this wallet. Reconnect the wallet that started the request or create a new request.</p>}
      {notice && <p className="text-sm text-emerald-300">{notice}</p>}{error && <p className="text-sm text-red-300">{error}</p>}
    </section>

      {request && policy && <>
       <PaymentLifecycle request={request} arcPayment={arcPayment} onResume={resumePayment} onRefund={refund} busy={busy} />
       <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-3"><h3 className="font-semibold text-white">Consent and evidence</h3><p className="text-xs text-gray-400">Request <code>{request.request_id}</code> · policy hash <code>{request.policy_hash}</code></p><div className="flex flex-wrap gap-2">{request.state === "AWAITING_CONSENT" && <button className="btn-primary" onClick={consent} disabled={busy}>I consent to this policy and purpose</button>}{canPay && <button className="btn-primary" onClick={pay} disabled={busy}><CreditCard className="w-4 h-4" />Approve and pay 1 USDC on Arc</button>}{canEvaluate && <button className="btn-primary" onClick={evaluate} disabled={busy}>Run independent assessment</button>}{(request.state === "AWAITING_CONSENT" || request.state === "AWAITING_PAYMENT") && <button className="btn-secondary" onClick={cancelRequest} disabled={busy}>Cancel unpaid request</button>}</div></section>
       {request.state === "FUNDED" && policy.external_humanity_required && !canEvaluate && <p className="text-sm text-amber-300">This funded Sybil request is intentionally blocked until a verified Human Passport snapshot is attached through a V4 deployment that supports the unified EAS schema. No assessment or settlement will be submitted.</p>}
      <GoogleVerification wallet={wallet} requestId={request.request_id} linked={linkedGoogle} callback={googleCallback} onChanged={refresh} />
       <HumanPassportPanel subject={request.subject} requestId={request.request_id} required={Boolean(policy.external_humanity_required)} canAttachUnified={v4HumanityMode.includes("EAS_UNIFIED")} onRefreshed={refresh} />
      <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4"><p className="text-xs text-gray-500">{request.state === "EVALUATED_PENDING_SETTLEMENT" ? "Assessment complete, but no TrustPass is active until the settlement operator submits and the Arc settlement event is independently consumed." : "Refresh the page at any point; the request, payment, and evidence references are read from chain state."}</p></div>
    </>}
  </div>;
}
