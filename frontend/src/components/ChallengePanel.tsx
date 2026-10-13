import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, CheckCircle2, Clock3, ExternalLink, Gavel, Loader2,
  MessageCircle, RefreshCw, ShieldCheck, Twitter, Github, WalletCards,
} from "lucide-react";
import clsx from "clsx";
import { useWallet } from "../lib/useWallet";
import {
  executeWalletRecovery,
  cancelWalletRecovery,
  expireOwnershipChallenge,
  getChallenges,
  requestOwnershipChallenge,
  respondToChallenge,
  resolveOwnershipChallenge,
  submitChallengeEvidence,
  transactionExplorerUrl,
} from "../lib/contract";
import {
  clearDiscordOAuthParams,
  createDiscordAttestation,
  discordOAuthError,
  discordStartUrl,
  hasDiscordBackend,
  parseDiscordOAuthResult,
} from "../lib/discord";
import { getChallengeActorActionState } from "../lib/challenge";
import type { ChallengeStatus, OwnershipChallenge, Platform } from "../types";

const PLATFORM_OPTIONS: Array<{ id: Platform; label: string; icon: React.ReactNode }> = [
  { id: "github", label: "GitHub", icon: <Github className="w-4 h-4" /> },
  { id: "twitter", label: "X", icon: <Twitter className="w-4 h-4" /> },
  { id: "discord", label: "Discord", icon: <MessageCircle className="w-4 h-4" /> },
];

const STATUS_STYLES: Record<ChallengeStatus, string> = {
  OPEN: "text-yellow-300 border-yellow-500/30 bg-yellow-500/10",
  AWAITING_REBUTTAL: "text-orange-300 border-orange-500/30 bg-orange-500/10",
  RESPONDED: "text-brand-300 border-brand-500/30 bg-brand-500/10",
  RESOLVED_OWNER: "text-success border-success/30 bg-success/10",
  RESOLVED_CHALLENGER: "text-red-300 border-red-500/30 bg-red-500/10",
  RESOLVED_INCONCLUSIVE: "text-gray-300 border-gray-600 bg-gray-800",
  EXECUTED: "text-success border-success/30 bg-success/10",
  EXPIRED: "text-gray-400 border-gray-700 bg-gray-800",
  RECOVERY_CANCELLED: "text-success border-success/30 bg-success/10",
};

function shortAddress(value: string) {
  return value ? `${value.slice(0, 8)}…${value.slice(-6)}` : "—";
}

function dateLabel(seconds: number) {
  if (!seconds) return "—";
  return new Date(seconds * 1000).toLocaleString();
}

function platformIcon(platform: Platform) {
  return PLATFORM_OPTIONS.find(option => option.id === platform)?.icon ?? <ShieldCheck className="w-4 h-4" />;
}

function statusLabel(status: ChallengeStatus) {
  return status.replace(/_/g, " ");
}

export function ChallengePanel() {
  const { address } = useWallet();
  const [challenges, setChallenges] = useState<OwnershipChallenge[]>([]);
  const [platform, setPlatform] = useState<Platform>("github");
  const [username, setUsername] = useState("");
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [rebuttals, setRebuttals] = useState<Record<string, string>>({});
  const [counterEvidence, setCounterEvidence] = useState<Record<string, string>>({});
  const [statements, setStatements] = useState<Record<string, string>>({});
  const [discordSession, setDiscordSession] = useState<string | null>(null);
  const [discordTarget, setDiscordTarget] = useState<string | null>(null);
  const [discordDisplay, setDiscordDisplay] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  async function load() {
    if (!address) return;
    setLoading(true);
    try {
      setChallenges(await getChallenges(address, 0, 50));
    } catch (e: any) {
      setError(e?.message ?? "Could not load ownership challenges");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const oauthError = discordOAuthError(window.location.search);
    const oauth = parseDiscordOAuthResult(window.location.search);
    if (oauthError) {
      setError(oauthError);
      clearDiscordOAuthParams();
    } else if (oauth) {
      setDiscordSession(oauth.sessionId);
      setDiscordDisplay(oauth.displayName);
      setDiscordTarget(window.localStorage.getItem("soulstamp.challengeDiscordTarget"));
      window.localStorage.removeItem("soulstamp.challengeDiscordTarget");
      setNotice(`Discord is connected as ${oauth.displayName}. Generate a fresh attestation below.`);
      clearDiscordOAuthParams();
    }
  }, []);

  useEffect(() => { if (address) load(); }, [address]);

  const sortedChallenges = useMemo(
    () => [...challenges].sort((a, b) => Number(b.opened_at) - Number(a.opened_at)),
    [challenges],
  );

  function setField(setter: React.Dispatch<React.SetStateAction<Record<string, string>>>, id: string, value: string) {
    setter(previous => ({ ...previous, [id]: value }));
  }

  async function runAction(id: string, operation: () => Promise<unknown>, success: string) {
    setAction(id);
    setError(null);
    setNotice(null);
    setLastTxHash(null);
    try {
      const result = await operation();
      if (result && typeof result === "object" && "hash" in result && typeof result.hash === "string") {
        setLastTxHash(result.hash);
      }
      setNotice(success);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "The finalized transaction did not succeed");
    } finally {
      setAction(null);
    }
  }

  async function startChallenge() {
    if (!username.trim()) return setError("Enter the exact account username to challenge.");
    await runAction("new", () => requestOwnershipChallenge(platform, username.trim().replace(/^@/, "")), "Challenge opened. Fresh evidence is required before the deadline.");
    setUsername("");
  }

  function connectDiscord(challengeId: string) {
    if (!address) return;
    if (!hasDiscordBackend()) {
      setError("Discord evidence is unavailable until VITE_DISCORD_BACKEND_URL is configured.");
      return;
    }
    window.localStorage.setItem("soulstamp.challengeDiscordTarget", challengeId);
    window.location.href = discordStartUrl(address, window.location.origin + window.location.pathname);
  }

  async function createFreshDiscordEvidence(challenge: OwnershipChallenge, role: "challenger" | "owner" | "counter") {
    if (!address || !discordSession) return setError("Connect Discord first.");
    const code = role === "challenger" ? challenge.challenger_code : role === "owner" ? challenge.owner_rebuttal_code : challenge.recovery_counter_code;
    if (!code) return setError("Recovery counter-evidence is not available for this challenge.");
    setAction(`attest:${challenge.challenge_id}`);
    setError(null);
    try {
      const attestation = await createDiscordAttestation({
        sessionId: discordSession,
        wallet: address,
        verificationCode: code,
        claimedUsername: challenge.username,
        pendingId: challenge.challenge_id,
      });
      if (role === "challenger") setField(setEvidence, challenge.challenge_id, attestation.attestation_url);
      else if (role === "owner") setField(setRebuttals, challenge.challenge_id, attestation.attestation_url);
      else setField(setCounterEvidence, challenge.challenge_id, attestation.attestation_url);
      setDiscordTarget(challenge.challenge_id);
      setNotice(`Fresh Discord attestation created and expires at ${dateLabel(attestation.expires_at)}.`);
    } catch (e: any) {
      setError(e?.message ?? "Could not create a Discord attestation");
    } finally {
      setAction(null);
    }
  }

  if (!address) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h2 className="text-2xl font-bold mb-1">Ownership challenges & recovery</h2>
        <p className="text-gray-400 text-sm max-w-3xl">
          A challenge introduces a second, time-bounded evidence path for an active link. GenLayer independently resolves fresh challenger and owner evidence; only the winning challenger can recover the principal after the safety delay.
        </p>
      </div>

      {(error || notice) && (
        <div className={clsx("rounded-xl border p-4 text-sm flex gap-3", error ? "bg-red-950/40 border-red-800 text-red-300" : "bg-success/10 border-success/30 text-green-200")}>
          {error ? <AlertCircle className="w-5 h-5 shrink-0" /> : <CheckCircle2 className="w-5 h-5 shrink-0" />}
          <div className="space-y-1">
            <span>{error ?? notice}</span>
            {lastTxHash && (
              <a className="block text-xs underline break-all" href={transactionExplorerUrl(lastTxHash)} target="_blank" rel="noreferrer">
                View finalized transaction {lastTxHash}
              </a>
            )}
          </div>
        </div>
      )}

      <section className="bg-gray-900 border border-gray-700 rounded-2xl p-5">
        <div className="flex items-start gap-3 mb-4">
          <Gavel className="w-5 h-5 text-brand-300 mt-0.5" />
          <div>
            <h3 className="font-semibold">Open a challenge</h3>
            <p className="text-xs text-gray-500 mt-1">The account must already have an active SoulStamp proof. You cannot challenge your own link. X oEmbed is handle-only today, so recovery-grade challenges require GitHub or Discord canonical identity evidence.</p>
          </div>
        </div>
        <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto]">
          <select value={platform} onChange={e => setPlatform(e.target.value as Platform)} className="input">
            {PLATFORM_OPTIONS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
          <input value={username} onChange={e => setUsername(e.target.value)} className="input" placeholder="Exact username, e.g. octocat" />
          <button onClick={startChallenge} disabled={action === "new" || platform === "twitter"} className="btn-primary">
            {action === "new" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gavel className="w-4 h-4" />} Open challenge
          </button>
        </div>
      </section>

      {discordSession && (
        <div className="bg-indigo-950/40 border border-indigo-700/50 rounded-xl p-4 text-sm text-indigo-100 flex flex-wrap items-center justify-between gap-3">
          <span>Fresh Discord session: <strong>{discordDisplay ?? "connected"}</strong>{discordTarget ? ` · selected challenge ${discordTarget}` : ""}</span>
          <button onClick={() => { setDiscordSession(null); setDiscordDisplay(null); setDiscordTarget(null); }} className="btn-secondary text-xs">Clear session</button>
        </div>
      )}

      <section>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold">Challenge history</h3>
            <p className="text-xs text-gray-500 mt-1">Codes and evidence URLs are public chain state. Do not put secrets in evidence.</p>
          </div>
          <button onClick={load} disabled={loading} className="btn-secondary"><RefreshCw className={clsx("w-4 h-4", loading && "animate-spin")} /></button>
        </div>

        {loading && challenges.length === 0 ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-brand-400" /></div>
        ) : sortedChallenges.length === 0 ? (
          <div className="border border-dashed border-gray-700 rounded-2xl py-16 text-center text-gray-500">No challenges involving this wallet.</div>
        ) : (
          <div className="space-y-4">
            {sortedChallenges.map(challenge => {
              const actionState = getChallengeActorActionState(challenge, address);
              const { isChallenger, isOwner } = actionState;
              const evidenceUrl = evidence[challenge.challenge_id] ?? "";
              const rebuttalUrl = rebuttals[challenge.challenge_id] ?? "";
              const counterUrl = counterEvidence[challenge.challenge_id] ?? "";
              const statement = statements[challenge.challenge_id] ?? "";
              const activeDeadline = challenge.status === "OPEN"
                ? Number(challenge.challenger_evidence_deadline ?? challenge.rebuttal_deadline)
                : Number(challenge.rebuttal_deadline);
              const deadlinePassed = activeDeadline > 0 && activeDeadline <= Math.floor(Date.now() / 1000);
              const canRecover = isChallenger && challenge.status === "RESOLVED_CHALLENGER" && Number(challenge.recovery_not_before) <= Math.floor(Date.now() / 1000);
              return (
                <article key={challenge.challenge_id} className="bg-gray-900 border border-gray-700 rounded-2xl p-5 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="text-brand-300">{platformIcon(challenge.platform)}</span>
                      <div>
                        <h4 className="font-semibold">@{challenge.username} <span className="text-gray-500 font-normal">on {challenge.platform}</span></h4>
                        <p className="font-mono text-[11px] text-gray-500">{challenge.challenge_id} · owner {shortAddress(challenge.current_owner)} · challenger {shortAddress(challenge.challenger_wallet)}</p>
                      </div>
                    </div>
                    <span className={clsx("px-2 py-1 rounded-full border text-[11px] font-semibold uppercase", STATUS_STYLES[challenge.status])}>{statusLabel(challenge.status)}</span>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3 text-xs text-gray-400">
                    <div className="bg-gray-800/70 rounded-lg p-3"><Clock3 className="w-3.5 h-3.5 inline mr-1" />Opened {dateLabel(challenge.opened_at)}</div>
                    <div className="bg-gray-800/70 rounded-lg p-3"><Clock3 className="w-3.5 h-3.5 inline mr-1" />Evidence deadline {dateLabel(activeDeadline)}</div>
                    <div className="bg-gray-800/70 rounded-lg p-3"><Clock3 className="w-3.5 h-3.5 inline mr-1" />Rebuttal deadline {challenge.rebuttal_deadline ? dateLabel(challenge.rebuttal_deadline) : "starts after evidence"}</div>
                    <div className="bg-gray-800/70 rounded-lg p-3"><ShieldCheck className="w-3.5 h-3.5 inline mr-1" />Outcome {challenge.outcome || "pending"}</div>
                  </div>
                  {challenge.challenger_evidence_hash && <div className="text-[11px] text-gray-500 break-all">Accepted evidence snapshot SHA-256: <code className="text-gray-300">{challenge.challenger_evidence_hash}</code></div>}

                  {isChallenger && challenge.status === "OPEN" && !deadlinePassed && (
                    <div className="border border-brand-500/20 bg-brand-500/5 rounded-xl p-4 space-y-3">
                      <div className="text-xs text-brand-200">Your fresh challenger code: <code className="font-mono text-white">{challenge.challenger_code}</code></div>
                      <p className="text-xs text-gray-400">Publish this code on the claimed account, then submit the exact public URL. Evidence is independently fetched and checked against the canonical account ID.</p>
                      <div className="flex gap-2">
                        <input value={evidenceUrl} onChange={e => setField(setEvidence, challenge.challenge_id, e.target.value)} className="input flex-1 text-xs" placeholder="Public evidence URL" />
                        {challenge.platform === "discord" && <button onClick={() => discordSession ? createFreshDiscordEvidence(challenge, "challenger") : connectDiscord(challenge.challenge_id)} className="btn-secondary text-xs">{discordSession ? "Fresh Discord evidence" : "Connect Discord"}</button>}
                        <button onClick={() => runAction(`submit:${challenge.challenge_id}`, () => submitChallengeEvidence(challenge.challenge_id, evidenceUrl.trim()), "Challenger evidence submitted.")} disabled={!evidenceUrl.trim() || action === `submit:${challenge.challenge_id}`} className="btn-primary text-xs">Submit</button>
                      </div>
                    </div>
                  )}

                  {isOwner && challenge.status === "AWAITING_REBUTTAL" && !deadlinePassed && (
                    <div className="border border-orange-500/20 bg-orange-500/5 rounded-xl p-4 space-y-3">
                      <div className="text-xs text-orange-200">Your fresh rebuttal code: <code className="font-mono text-white">{challenge.owner_rebuttal_code}</code></div>
                      <p className="text-xs text-gray-400">You have until the bounded deadline to publish fresh evidence and a concise rebuttal. The resolver receives both evidence paths.</p>
                      <input value={rebuttalUrl} onChange={e => setField(setRebuttals, challenge.challenge_id, e.target.value)} className="input w-full text-xs" placeholder="Fresh rebuttal evidence URL" />
                      <textarea value={statement} onChange={e => setField(setStatements, challenge.challenge_id, e.target.value)} className="input w-full text-xs min-h-20" maxLength={2000} placeholder="Rebuttal statement (max 2,000 characters)" />
                      <div className="flex justify-end gap-2">
                        {challenge.platform === "discord" && <button onClick={() => discordSession ? createFreshDiscordEvidence(challenge, "owner") : connectDiscord(challenge.challenge_id)} className="btn-secondary text-xs">{discordSession ? "Fresh Discord evidence" : "Connect Discord"}</button>}
                        <button onClick={() => runAction(`respond:${challenge.challenge_id}`, () => respondToChallenge(challenge.challenge_id, rebuttalUrl.trim(), statement.trim()), "Owner rebuttal submitted.")} disabled={!rebuttalUrl.trim() || !statement.trim() || action === `respond:${challenge.challenge_id}`} className="btn-primary text-xs">Submit rebuttal</button>
                      </div>
                    </div>
                  )}

                  {actionState.isParty && ["AWAITING_REBUTTAL", "RESPONDED"].includes(challenge.status) && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-800 pt-3">
                      <span className="text-xs text-gray-500">{actionState.resolutionReason}</span>
                      <button
                        onClick={() => runAction(`resolve:${challenge.challenge_id}`, () => resolveOwnershipChallenge(challenge.challenge_id), "Independent resolution finalized.")}
                        disabled={!actionState.canResolve || action === `resolve:${challenge.challenge_id}`}
                        title={!actionState.canResolve ? actionState.resolutionReason : undefined}
                        className="btn-secondary text-xs"
                      >
                        <Gavel className="w-3.5 h-3.5" />
                        {action === `resolve:${challenge.challenge_id}` ? "Resolving…" : "Resolve challenge"}
                      </button>
                    </div>
                  )}

                  {actionState.isParty && challenge.status === "OPEN" && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-800 pt-3">
                      <span className="text-xs text-gray-500">{actionState.canExpire ? actionState.expiryReason : actionState.resolutionReason}</span>
                      {actionState.canExpire && (
                        <button onClick={() => runAction(`expire:${challenge.challenge_id}`, () => expireOwnershipChallenge(challenge.challenge_id), "Unanswered challenge expired and the link is challengeable again.")} disabled={action === `expire:${challenge.challenge_id}`} className="btn-secondary text-xs">
                          {action === `expire:${challenge.challenge_id}` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Expire unanswered challenge"}
                        </button>
                      )}
                    </div>
                  )}

                  {challenge.status === "RESOLVED_CHALLENGER" && (
                    <div className="border-t border-gray-800 pt-3 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs text-gray-400">Recovery safety delay ends {dateLabel(challenge.recovery_not_before)}.</div>
                      {isChallenger && <button onClick={() => runAction(`recover:${challenge.challenge_id}`, () => executeWalletRecovery(challenge.challenge_id), "Challenged-account recovery finalized; unrelated links and reputation remain with the source identity.")} disabled={!canRecover || action === `recover:${challenge.challenge_id}`} className="btn-primary text-xs"><WalletCards className="w-3.5 h-3.5" /> Execute safe recovery</button>}
                      {isOwner && Number(challenge.recovery_counter_deadline ?? 0) >= Math.floor(Date.now() / 1000) && (
                        <div className="w-full border border-yellow-500/20 bg-yellow-500/5 rounded-xl p-4 space-y-2">
                          <div className="text-xs text-yellow-200">Temporary-compromise safeguard · counter window ends {dateLabel(Number(challenge.recovery_counter_deadline))}</div>
                          <p className="text-xs text-gray-400">Publish the fresh counter code on the challenged canonical account to cancel recovery. This evidence is independent of the original rebuttal.</p>
                          <code className="block text-xs text-white">{challenge.recovery_counter_code}</code>
                          <div className="flex gap-2">
                            <input value={counterUrl} onChange={e => setField(setCounterEvidence, challenge.challenge_id, e.target.value)} className="input flex-1 text-xs" placeholder="Fresh counter-evidence URL" />
                            {challenge.platform === "discord" && <button onClick={() => discordSession ? createFreshDiscordEvidence(challenge, "counter") : connectDiscord(challenge.challenge_id)} className="btn-secondary text-xs">{discordSession ? "Fresh Discord evidence" : "Connect Discord"}</button>}
                            <button onClick={() => runAction(`cancel:${challenge.challenge_id}`, () => cancelWalletRecovery(challenge.challenge_id, counterUrl.trim()), "Pending recovery cancelled by fresh owner evidence.")} disabled={!counterUrl.trim() || action === `cancel:${challenge.challenge_id}`} className="btn-secondary text-xs">Cancel recovery</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {challenge.resolution_reasoning && <p className="text-xs text-gray-400 bg-gray-800/60 rounded-lg p-3">Resolver reasoning: {challenge.resolution_reasoning}</p>}
                  {challenge.status === "EXECUTED" && <p className="text-xs text-success flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Recovery executed at marker #{challenge.recovery_executed_at}.</p>}
                  {challenge.platform === "discord" && challenge.status !== "EXECUTED" && !hasDiscordBackend() && <p className="text-[11px] text-yellow-300">Discord fresh evidence needs the deployed attestation Worker URL in VITE_DISCORD_BACKEND_URL.</p>}
                  {challenge.status !== "OPEN" && challenge.challenger_evidence_url && <a className="text-xs text-brand-300 inline-flex items-center gap-1 break-all" href={challenge.challenger_evidence_url} target="_blank" rel="noreferrer">Challenger evidence <ExternalLink className="w-3 h-3" /></a>}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
