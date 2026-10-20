import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { humanPassportAppUrl, humanPassportAttestationUrl, humanPassportDocumentationUrl, readHumanPassport, readUnifiedHumanPassport, type HumanPassportEvidence } from "../lib/humanPassport";
import { refreshHumanityEvidence, refreshUnifiedHumanityEvidence } from "../lib/trustpass";

const DEFAULT_ATTESTATION_UID = String(import.meta.env.VITE_HUMAN_PASSPORT_ATTESTATION_UID || "").trim();

export function HumanPassportPanel({ subject, requestId, required, canAttachUnified = false, onRefreshed }: { subject: string; requestId?: string; required: boolean; canAttachUnified?: boolean; onRefreshed?: () => Promise<void> | void }) {
  const [attestationUid, setAttestationUid] = useState(DEFAULT_ATTESTATION_UID);
  const [evidence, setEvidence] = useState<HumanPassportEvidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function inspect() {
    setBusy(true); setError("");
    try {
      const uid = attestationUid.trim();
      setEvidence(uid ? await readUnifiedHumanPassport(subject, uid) : await readHumanPassport(subject));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setEvidence(null);
      setError(message.includes("AttestationNotFound") || message.includes("0x120a2e77")
        ? "The deployed legacy decoder does not recognize the current unified Human Passport schema. Enter the EAS attestation UID above; a new V4 deployment is required before this evidence can be attached on-chain."
        : message);
    } finally { setBusy(false); }
  }

  async function attach() {
    if (!requestId || !evidence) return;
    setBusy(true); setError("");
    try {
      if (evidence.source === "eas-unified") {
        if (!canAttachUnified) throw new Error("The connected V4 contract exposes only the legacy Passport decoder. Do not run this Sybil assessment; deploy the prepared unified-EAS V4/escrow pair first.");
        await refreshUnifiedHumanityEvidence(requestId, evidence.attestationUid || "", evidence.blockNumber);
      } else {
        await refreshHumanityEvidence(requestId, evidence.blockNumber);
      }
      await onRefreshed?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  const unified = evidence?.source === "eas-unified";
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">Human Passport evidence {required ? <span className="text-amber-300">(required)</span> : <span className="text-gray-500">(optional)</span>}</h3>
          <p className="text-xs text-gray-400 mt-1">Reads the exact subject wallet on Optimism Sepolia. SoulStamp accepts authenticated EAS records or the legacy decoder, never a typed score.</p>
        </div>
        <button className="btn-secondary" onClick={inspect} disabled={busy}><RefreshCw className="w-4 h-4" />{busy ? "Reading…" : "Inspect evidence"}</button>
      </div>
      <label className="block text-xs text-gray-400">Unified EAS attestation UID (required for current Human Passport records)
        <input className="input mt-1 w-full font-mono" value={attestationUid} onChange={(event) => setAttestationUid(event.target.value)} placeholder="0x…" spellCheck={false} />
      </label>
      {evidence && <div className="grid sm:grid-cols-2 gap-2 text-xs text-gray-300">
        <span>Source: <strong className="text-white">{unified ? "EAS unified attestation" : "legacy decoder"}</strong></span>
        <span>Raw score: <strong className="text-white">{evidence.rawScore}</strong></span>
        <span>Scaled score: <strong className={evidence.thresholdMet ? "text-emerald-300" : "text-amber-300"}>{evidence.score.toFixed(evidence.scoreDecimals ?? 4)}</strong> / {evidence.threshold}</span>
        <span>Scorer: {evidence.scorerId ?? "legacy"} · chain {evidence.chainId}</span>
        <span>Block: {evidence.blockNumber} · {evidence.thresholdMet ? "threshold met" : "threshold not met"}</span>
        {unified && <><span>Schema: <code className="break-all">{evidence.schemaUid}</code></span><span>Attester: <code>{evidence.attester}</code></span><span>Resolver: <code>{evidence.resolver}</code></span><span>Expires: {evidence.expirationTime ? new Date(evidence.expirationTime * 1000).toUTCString() : "unknown"}</span><span>Revocation: {evidence.revocationTime ? "revoked" : "not revoked at pinned block"}</span></>}
      </div>}
      {unified && evidence?.attestationUid && <a className="footer-link inline-flex items-center gap-1 text-xs" href={humanPassportAttestationUrl(evidence.attestationUid)} target="_blank" rel="noreferrer">Open attestation {evidence.attestationUid.slice(0, 12)}… <ExternalLink className="w-3 h-3" /></a>}
      {requestId && evidence && <button className="btn-primary" onClick={attach} disabled={busy || (unified && !canAttachUnified)}>{unified ? "Attach verified EAS snapshot" : "Attach legacy pinned snapshot"}</button>}
      {unified && !canAttachUnified && <p className="text-xs text-amber-300">The currently deployed V4 address is legacy-decoder-only. The evidence is valid, but this deployment cannot consume the unified schema.</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-3 text-xs"><a className="footer-link inline-flex items-center gap-1" href={humanPassportDocumentationUrl()} target="_blank" rel="noreferrer">Official schema docs <ExternalLink className="w-3 h-3" /></a><a className="footer-link inline-flex items-center gap-1" href={humanPassportAppUrl()} target="_blank" rel="noreferrer">Open Passport <ExternalLink className="w-3 h-3" /></a></div>
      <p className="text-[11px] text-gray-500">Unified score 44.6980 is 446980 with four decimals when the authenticated record proves it. The attestation expires at its own on-chain timestamp; the pinned snapshot is refreshed for this assessment and is not a continuously live humanity guarantee.</p>
    </section>
  );
}
