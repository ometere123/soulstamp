import { useEffect, useState } from "react";
import { Building2, CreditCard, RefreshCw } from "lucide-react";
import { ensureStudionet } from "../lib/client";
import { payAssessment } from "../lib/arc";
import {
  confirmArcPayment,
  createAssessmentRequest,
  createPolicy,
  getPaymentIntent,
  getOrganisationPolicies,
  getRequests,
  type TrustPassPolicy,
  type TrustPassRequest,
} from "../lib/trustpass";

export function OrganisationPortal({ wallet }: { wallet: string }) {
  const [policyId, setPolicyId] = useState("organisation-v4-v1");
  const [subject, setSubject] = useState("");
  const [policies, setPolicies] = useState<TrustPassPolicy[]>([]);
  const [requests, setRequests] = useState<TrustPassRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [nextPolicies, nextRequests] = await Promise.all([
        getOrganisationPolicies(wallet),
        getRequests(wallet),
      ]);
      setPolicies(nextPolicies);
      setRequests(nextRequests.filter((request) => request.sponsored));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  useEffect(() => { void load(); }, [wallet]);

  async function publish() {
    setBusy(true); setError(""); setMessage("");
    try {
      await createPolicy(policyId, {
        version: 1,
        required_credentials: ["github"],
        minimum_proof_strength: "MEDIUM",
        maximum_evidence_age_seconds: 30 * 24 * 60 * 60,
        maximum_trustpass_lifetime_seconds: 7 * 24 * 60 * 60,
        external_humanity_required: false,
        minimum_humanity_score: 200000,
        permitted_assessment_use: "organisation_access_decision",
        assessment_price_usdc: 1000000,
        enabled: true,
      });
      await load();
      setMessage("Policy published. A sponsored request still requires the subject's explicit consent.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  async function sponsor() {
    if (!/^0x[0-9a-fA-F]{40}$/.test(subject)) { setError("Enter a valid subject wallet."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      await createAssessmentRequest(policyId, subject, "organisation_access_decision", true);
      await load();
      setMessage("Sponsored request created; the subject must consent before payment is possible.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  async function pay(request: TrustPassRequest) {
    setBusy(true); setError(""); setMessage("");
    try {
      const intent = await getPaymentIntent(request.request_id);
      const result = await payAssessment(
        wallet,
        String(intent.request_key) as `0x${string}`,
        String(intent.subject),
        String(intent.policy_hash) as `0x${string}`,
        BigInt(String(intent.payment_nonce)),
        BigInt(String(intent.intent_expires_at)),
      );
      await ensureStudionet();
      await confirmArcPayment(request.request_id, result.depositHash, result.logIndex);
      await load();
      setMessage("Arc deposit finalized and was accepted by GenLayer for this sponsored request.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
        <div className="flex items-start gap-3">
          <Building2 className="w-6 h-6 text-brand-400" />
          <div>
            <h2 className="text-xl font-bold text-white">Organisation portal</h2>
            <p className="text-sm text-gray-400 mt-1">Sponsors can define a bounded policy, request an assessment for a consenting subject, and pay the exact 1 USDC Arc escrow. Sponsorship never grants identity ownership or administrator authority.</p>
          </div>
        </div>
        <div className="grid md:grid-cols-2 gap-3 mt-5">
          <div className="space-y-2">
            <label className="text-xs text-gray-400">Policy ID<input className="input w-full mt-1" value={policyId} onChange={(event) => setPolicyId(event.target.value)} /></label>
            <button className="btn-primary" onClick={publish} disabled={busy}>Publish policy</button>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-gray-400">Consenting subject wallet<input className="input w-full mt-1" placeholder="0x…" value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
            <button className="btn-secondary" onClick={sponsor} disabled={busy}>Create sponsored request</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button className="btn-secondary" onClick={() => void load()} disabled={busy}><RefreshCw className="w-4 h-4" />Refresh portal</button>
        </div>
        {message && <p className="text-sm text-emerald-300 mt-3">{message}</p>}
        {error && <p className="text-sm text-red-300 mt-3">{error}</p>}
      </section>

      <section>
        <h3 className="font-semibold text-white mb-2">Your policies</h3>
        {policies.length ? <div className="grid md:grid-cols-2 gap-3">{policies.map((policy) => <div key={policy.policy_hash} className="rounded-lg border border-gray-800 p-3 text-sm text-gray-300">{policy.policy_id} · v{policy.version} · {policy.enabled ? "enabled" : "disabled"}<br /><span className="text-xs text-gray-500 break-all">{policy.policy_hash}</span></div>)}</div> : <p className="text-sm text-gray-500">No policies published from this wallet yet.</p>}
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold text-white">Sponsored requests</h3>
        {requests.length === 0 ? <p className="text-sm text-gray-500">No sponsored requests for this organisation wallet.</p> : requests.map((request) => (
          <article key={request.request_id} className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-2">
            <div className="flex flex-wrap justify-between gap-2"><span className="text-xs text-gray-500">{request.policy_id}</span><span className="text-sm text-gray-200">{request.state} · {request.payment_state}</span></div>
            <p className="text-xs text-gray-400 break-all">Subject: {request.subject}<br />Request: {request.request_id}</p>
            {request.state === "AWAITING_CONSENT" && <p className="text-xs text-amber-300">Waiting for the subject to consent to this exact purpose and policy.</p>}
            {request.state === "AWAITING_PAYMENT" && request.payer.toLowerCase() === wallet.toLowerCase() && <button className="btn-primary" onClick={() => void pay(request)} disabled={busy}><CreditCard className="w-4 h-4" />Pay exact 1 USDC on Arc</button>}
            {request.arc_tx_hash && <p className="text-xs text-emerald-300 break-all">Arc deposit: {request.arc_tx_hash}</p>}
            {request.arc_settlement_tx_hash && <p className="text-xs text-emerald-300 break-all">Arc settlement: {request.arc_settlement_tx_hash}</p>}
          </article>
        ))}
      </section>
    </div>
  );
}
