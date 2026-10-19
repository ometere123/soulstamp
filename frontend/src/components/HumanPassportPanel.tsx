import { useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { humanPassportAppUrl, humanPassportDocumentationUrl, readHumanPassport, type HumanPassportEvidence } from "../lib/humanPassport";
import { refreshHumanityEvidence } from "../lib/trustpass";

export function HumanPassportPanel({ subject, requestId, required, onRefreshed }: { subject: string; requestId?: string; required: boolean; onRefreshed?: () => Promise<void> | void }) {
  const [evidence, setEvidence] = useState<HumanPassportEvidence | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function inspect() {
    setBusy(true); setError("");
    try { setEvidence(await readHumanPassport(subject)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  async function attach() {
    if (!requestId || !evidence) return;
    setBusy(true); setError("");
    try { await refreshHumanityEvidence(requestId, evidence.blockNumber); await onRefreshed?.(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">Human Passport evidence {required ? <span className="text-amber-300">(required)</span> : <span className="text-gray-500">(optional)</span>}</h3>
          <p className="text-xs text-gray-400 mt-1">Reads the same subject wallet from the Optimism Sepolia decoder. SoulStamp never accepts a typed score.</p>
        </div>
        <button className="btn-secondary" onClick={inspect} disabled={busy}><RefreshCw className="w-4 h-4" />{busy ? "Reading…" : "Inspect wallet"}</button>
      </div>
      {evidence && <div className="grid sm:grid-cols-2 gap-2 text-xs text-gray-300">
        <span>Raw score: <strong className="text-white">{evidence.rawScore}</strong></span>
        <span>Scaled score: <strong className={evidence.thresholdMet ? "text-emerald-300" : "text-amber-300"}>{evidence.score}</strong> / {evidence.threshold}</span>
        <span>Chain: {evidence.chainId} · decoder {evidence.decoder.slice(0, 10)}…</span>
        <span>Block: {evidence.blockNumber} · {evidence.thresholdMet ? "threshold met" : "threshold not met"}</span>
      </div>}
      {requestId && evidence && <button className="btn-primary" onClick={attach} disabled={busy}>Attach this pinned snapshot to request</button>}
      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="flex flex-wrap gap-3 text-xs"><a className="footer-link inline-flex items-center gap-1" href={humanPassportDocumentationUrl()} target="_blank" rel="noreferrer">Official docs <ExternalLink className="w-3 h-3" /></a><a className="footer-link inline-flex items-center gap-1" href={humanPassportAppUrl()} target="_blank" rel="noreferrer">Open Passport <ExternalLink className="w-3 h-3" /></a></div>
      <p className="text-[11px] text-gray-500">A score is read at a pinned block and refreshed for this assessment. The decoder does not provide an original issuance timestamp for score attestations, so V4 uses a seven-day snapshot window and discloses that limitation.</p>
    </section>
  );
}
