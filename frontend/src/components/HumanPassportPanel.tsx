import { useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { discoverPassport, type PassportDiscovery } from "../lib/passportDiscovery";
import { humanPassportAppUrl, humanPassportAttestationUrl, humanPassportDocumentationUrl, readHumanPassport, readUnifiedHumanPassport, type HumanPassportEvidence } from "../lib/humanPassport";
import { getHumanityEvidence, refreshHumanityEvidence, refreshUnifiedHumanityEvidence } from "../lib/trustpass";

type Snapshot = Record<string, unknown>;

export function HumanPassportPanel({ subject, requestId, required, canAttachUnified = false, onRefreshed }: { subject: string; requestId?: string; required: boolean; canAttachUnified?: boolean; onRefreshed?: () => Promise<void> | void }) {
  const [discovery, setDiscovery] = useState<PassportDiscovery | null>(null);
  const [evidence, setEvidence] = useState<HumanPassportEvidence | null>(null);
  const [attachedSnapshot, setAttachedSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const scanGeneration = useRef(0);

  async function inspectRequestSnapshot(isCurrent: () => boolean = () => true) {
    if (!requestId) return;
    try {
      const snapshot = await getHumanityEvidence(requestId);
      if (!isCurrent()) return;
      if (snapshot && snapshot.found !== false && String(snapshot.wallet || "").toLowerCase() === subject.toLowerCase()) setAttachedSnapshot(snapshot);
      else setAttachedSnapshot(null);
    } catch {
      if (isCurrent()) setAttachedSnapshot(null);
    }
  }

  async function scan(force = false) {
    const generation = ++scanGeneration.current;
    const isCurrent = () => generation === scanGeneration.current;
    setBusy(true); setError(""); setNotice(""); setEvidence(null); setDiscovery(null);
    setAttachedSnapshot(null);
    try {
      const result = await discoverPassport(subject, { force });
      if (!isCurrent()) return;
      setDiscovery(result);
      if (!result.passport_api.available && result.passport_api.error_code) {
        setNotice("The Passport API is unavailable or informational only; SoulStamp continues with independent EAS discovery.");
      } else if (result.passport_api.available && result.passport_api.matches_approved_scorer === false) {
        setNotice(`Passport API scorer ${result.passport_api.scorer_id || "unknown"} is informational only; SoulStamp requires approved on-chain scorer 335.`);
      }
      if (!result.candidate) {
        setNotice((current) => current || (result.eas_indexer.error_code || result.eas_indexer.secondary_error_code
          ? "Passport indexer coverage is incomplete. No authenticated Passport result is reported; refresh later."
          : result.passport_api.score !== null && result.passport_api.score !== undefined
            ? "A Passport API score was found, but no compatible unified EAS attestation is indexed for this wallet yet. The API score cannot authorize a TrustPass."
            : "No compatible unified EAS attestation was discovered for this wallet."));
        return;
      }
      // The indexer result is a candidate only. Direct EAS reads authenticate
      // the UID, wallet, schema, resolver, attester, score and expiry.
      const authenticated = await readUnifiedHumanPassport(subject, result.candidate.attestation_uid);
      if (!isCurrent()) return;
      setEvidence(authenticated);
      await inspectRequestSnapshot(isCurrent);
    } catch (cause) {
      if (isCurrent()) {
        setEvidence(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally { if (isCurrent()) setBusy(false); }
  }

  useEffect(() => {
    void scan();
    return () => { scanGeneration.current += 1; };
    // Scan only when the subject/request wallet changes. The button invokes it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, requestId]);

  async function attach() {
    if (!requestId || !evidence) return;
    setBusy(true); setError("");
    try {
      if (evidence.source === "eas-unified") {
        if (!canAttachUnified) throw new Error("The active V4 contract does not expose unified EAS evidence. Do not submit this attachment.");
        await refreshUnifiedHumanityEvidence(requestId, evidence.attestationUid || "", evidence.blockNumber);
      } else {
        await refreshHumanityEvidence(requestId, evidence.blockNumber);
      }
      const snapshot = await getHumanityEvidence(requestId);
      if (snapshot.found === false || String(snapshot.wallet || "").toLowerCase() !== subject.toLowerCase()) throw new Error("GenLayer finalized without the expected wallet-bound Human Passport snapshot.");
      if (evidence.attestationUid && String(snapshot.attestation_uid || "").toLowerCase() !== evidence.attestationUid.toLowerCase()) throw new Error("GenLayer finalized with a different Human Passport attestation UID.");
      setAttachedSnapshot(snapshot);
      await onRefreshed?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setBusy(false); }
  }

  const unified = evidence?.source === "eas-unified";
  const api = discovery?.passport_api;
  const apiScore = typeof api?.score === "number" ? api.score.toFixed(4) : "not available";
  return (
    <section className="rounded-xl border border-gray-800 bg-gray-900/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-white">Human Passport evidence {required ? <span className="text-amber-300">(required)</span> : <span className="text-gray-500">(optional)</span>}</h3>
          <p className="text-xs text-gray-400 mt-1">The connected subject wallet is scanned automatically. API and indexer results are candidates; only direct EAS validation and finalized GenLayer state can authorize this request.</p>
        </div>
        <button className="btn-secondary" onClick={() => void scan(true)} disabled={busy}><RefreshCw className="w-4 h-4" />{busy ? "Scanning…" : "Scan / Refresh Passport"}</button>
      </div>

      <div className="grid sm:grid-cols-2 gap-2 text-xs text-gray-300">
        <span>Wallet: <code className="text-white break-all">{subject}</code></span>
        <span>API score: <strong className="text-white">{apiScore}</strong> {api?.matches_approved_scorer === false ? <em className="text-amber-300">informational scorer</em> : ""}</span>
        <span>API stamps: <strong className="text-white">{api?.stamp_count ?? "not available"}</strong></span>
        <span>Approved on-chain scorer: <strong className="text-white">335</strong></span>
      </div>

      {discovery?.candidate && <p className="text-xs text-sky-300">1. EAS indexer candidate discovered: {discovery.candidate.attestation_uid.slice(0, 14)}…</p>}
      {evidence && <div className="grid sm:grid-cols-2 gap-2 text-xs text-gray-300">
        <span>2. Direct EAS validation: <strong className="text-emerald-300">authenticated</strong></span>
        <span>Score: <strong className={evidence.thresholdMet ? "text-emerald-300" : "text-amber-300"}>{evidence.score.toFixed(evidence.scoreDecimals ?? 4)}</strong> / {evidence.threshold}</span>
        <span>Raw score: <strong className="text-white">{evidence.rawScore}</strong> · scorer {evidence.scorerId ?? "legacy"}</span>
        <span>Network: Optimism Sepolia ({evidence.chainId}) · block {evidence.blockNumber}</span>
        {unified && <><span>Schema: <code className="break-all">{evidence.schemaUid}</code></span><span>Stamps: {evidence.stamps?.length ?? 0}</span><span>Expires: {evidence.expirationTime ? new Date(evidence.expirationTime * 1000).toUTCString() : "unknown"}</span><span>Revocation: {evidence.revocationTime ? "revoked" : "not revoked at pinned block"}</span></>}
      </div>}

      {unified && evidence?.attestationUid && <a className="footer-link inline-flex items-center gap-1 text-xs" href={humanPassportAttestationUrl(evidence.attestationUid)} target="_blank" rel="noreferrer">Open verified attestation {evidence.attestationUid.slice(0, 12)}… <ExternalLink className="w-3 h-3" /></a>}
      {requestId && evidence && !attachedSnapshot && <button className="btn-primary" onClick={attach} disabled={busy || (unified && !canAttachUnified)}>Attach verified Passport</button>}
      {attachedSnapshot && <div className="rounded-lg border border-emerald-700 bg-emerald-950/30 p-3 text-xs text-emerald-200"><strong>3. Verified for this request</strong><div className="mt-1">GenLayer snapshot: {String(attachedSnapshot.attestation_uid || attachedSnapshot.evidence_type || "authenticated evidence")} · pinned block {String(attachedSnapshot.block_number || "unknown")}</div><div className="mt-1">This is a request-bound snapshot, not a continuously live humanity guarantee.</div></div>}
      {requestId && evidence && !attachedSnapshot && !canAttachUnified && unified && <p className="text-xs text-amber-300">The active V4 contract does not advertise unified EAS support. The evidence is valid but cannot be attached through this deployment.</p>}
      {notice && <p className="text-sm text-sky-300">{notice}</p>}
      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex flex-wrap gap-3 text-xs"><a className="footer-link inline-flex items-center gap-1" href={humanPassportDocumentationUrl()} target="_blank" rel="noreferrer">Official schema docs <ExternalLink className="w-3 h-3" /></a><a className="footer-link inline-flex items-center gap-1" href={humanPassportAppUrl()} target="_blank" rel="noreferrer">Open Passport <ExternalLink className="w-3 h-3" /></a></div>
      {!evidence && !busy && <p className="text-[11px] text-gray-500">If you have no on-chain Passport evidence, publish the wallet’s approved score through the official Human Passport flow first. An off-chain API score alone cannot authorize a paid TrustPass.</p>}
    </section>
  );
}
