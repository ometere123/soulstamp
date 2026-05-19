import { useEffect, useState } from "react";
import {
  Github, Twitter, CheckCircle2, Loader2, AlertCircle,
  Copy, Check, ExternalLink, ArrowRight, RotateCcw, MessageCircle
} from "lucide-react";
import clsx from "clsx";
import { useWallet } from "../lib/useWallet";
import {
  requestVerification,
  getPendingVerification,
  completeVerification,
  cancelPendingVerification,
  isPlatformTaken,
  getIdentity,
} from "../lib/contract";
import {
  clearDiscordOAuthParams,
  createDiscordAttestation,
  discordOAuthError,
  discordStartUrl,
  hasDiscordBackend,
  parseDiscordOAuthResult,
} from "../lib/discord";
import type { IdentityRecord, Platform, PendingVerification, VerificationStep } from "../types";

const PLATFORMS: { id: Platform; label: string; icon: React.ReactNode; placeholder: string }[] = [
  { id: "github",  label: "GitHub",  icon: <Github className="w-5 h-5" />,  placeholder: "octocat" },
  { id: "twitter", label: "Twitter", icon: <Twitter className="w-5 h-5" />, placeholder: "elonmusk" },
  { id: "discord", label: "Discord", icon: <MessageCircle className="w-5 h-5" />, placeholder: "Connect Discord" },
];

function profileUrl(platform: Platform, username: string): string {
  if (platform === "github") return `https://github.com/${username}`;
  if (platform === "twitter") return `https://twitter.com/${username}`;
  const discordId = username.includes("#") ? username.split("#").pop() : username;
  return `https://discord.com/users/${discordId}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function hasLinkedAccount(identity: IdentityRecord, platform: Platform, username: string): boolean {
  const usernameLc = username.toLowerCase();
  return Boolean(
    identity.found &&
    identity.linked_accounts?.some(acct =>
      acct.platform === platform && acct.username.toLowerCase() === usernameLc
    )
  );
}

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div className={clsx(
      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-colors",
      done   ? "bg-success text-white" :
      active ? "bg-brand-600 text-white" :
               "bg-gray-800 text-gray-500"
    )}>
      {done ? <CheckCircle2 className="w-4 h-4" /> : n}
    </div>
  );
}

export function VerificationFlow() {
  const [step, setStep]         = useState<VerificationStep>("idle");
  const [platform, setPlatform] = useState<Platform>("github");
  const [username, setUsername] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const { address } = useWallet();
  const [pending, setPending]   = useState<PendingVerification | null>(null);
  const [copied, setCopied]     = useState(false);
  const [checking, setChecking] = useState(false);
  const [postUrl, setPostUrl]   = useState("");   // Twitter tweet URL
  const [discordSession, setDiscordSession] = useState<string | null>(null);
  const [discordDisplay, setDiscordDisplay] = useState<string | null>(null);

  useEffect(() => {
    const oauthError = discordOAuthError(window.location.search);
    const oauth = parseDiscordOAuthResult(window.location.search);
    if (oauthError) {
      setError(oauthError);
      clearDiscordOAuthParams();
      return;
    }
    if (!oauth) return;
    setPlatform("discord");
    setUsername(oauth.claim);
    setDiscordSession(oauth.sessionId);
    setDiscordDisplay(oauth.displayName);
    setStep("idle");
    clearDiscordOAuthParams();
  }, []);

  // On mount (or address change), check if there's already a pending verification
  useEffect(() => {
    if (!address) return;
    (async () => {
      try {
        const p = await getPendingVerification(address);
        if (p.found) {
          setPending(p);
          setPlatform(p.platform as Platform);
          setUsername(p.username);
          setStep("pending");
        }
      } catch { /* ignore */ }
    })();
  }, [address]);

  function copyCode() {
    if (!pending) return;
    navigator.clipboard.writeText(pending.verification_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function confirmVerifiedLink(targetPlatform: Platform, targetUsername: string): Promise<boolean> {
    if (!address) return false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const identity = await getIdentity(address, 60_000);
        if (hasLinkedAccount(identity, targetPlatform, targetUsername)) return true;
      } catch (e: any) {
        console.log("[soulstamp] post-verification identity confirmation failed:", e?.message ?? e);
      }
      if (attempt < 4) await sleep(2_500);
    }
    return false;
  }

  function finishSuccess() {
    setStep("done");
    setPending(null);
    setPostUrl("");
    setDiscordSession(null);
    setDiscordDisplay(null);
  }

  function startDiscordOAuth() {
    if (!address) {
      setError("Connect your wallet before linking Discord.");
      return;
    }
    if (!hasDiscordBackend()) {
      setError("Discord backend is not configured. Set VITE_DISCORD_BACKEND_URL first.");
      return;
    }
    window.location.href = discordStartUrl(address, window.location.origin + window.location.pathname);
  }

  async function handleRequest() {
    if (platform === "discord" && !discordSession) {
      startDiscordOAuth();
      return;
    }
    if (!username.trim()) return;
    setError(null);
    setStep("requesting");
    try {
      // Sybil check
      setChecking(true);
      const taken = await isPlatformTaken(platform, username.trim());
      setChecking(false);
      if (taken) {
        setError(`@${username} on ${platform} is already linked to another wallet.`);
        setStep("idle");
        return;
      }

      const url = profileUrl(platform, username.trim());
      await requestVerification(platform, username.trim(), url);

      const p = await getPendingVerification(address!);
      if (p.found) {
        setPending(p);
        setStep("pending");
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to request verification");
      setStep("idle");
    }
  }

  async function handleComplete() {
    // For Twitter we need a tweet URL; GitHub uses the stored profile URL.
    if (platform === "twitter") {
      if (!postUrl.trim()) {
        setError("Paste your tweet URL — the one containing the verification code.");
        return;
      }
      const lc = postUrl.toLowerCase();
      const u  = username.toLowerCase();
      if (!lc.includes(`x.com/${u}/status/`) && !lc.includes(`twitter.com/${u}/status/`)) {
        setError(`Tweet URL must belong to @${username} (e.g. https://x.com/${username}/status/...)`);
        return;
      }
    }
    if (platform === "discord" && (!discordSession || !pending || !address)) {
      setError("Connect Discord again before verifying.");
      return;
    }
    setError(null);
    setStep("completing");
    const targetPlatform = platform;
    const targetUsername = pending?.username ?? username;
    try {
      let fetchUrl = "";
      if (platform === "twitter") {
        fetchUrl = postUrl.trim();
      } else if (platform === "discord") {
        const attestation = await createDiscordAttestation({
          sessionId: discordSession!,
          wallet: address!,
          verificationCode: pending!.verification_code,
          claimedUsername: pending!.username,
        });
        fetchUrl = attestation.attestation_url;
      }
      await completeVerification(fetchUrl);
      await confirmVerifiedLink(targetPlatform, targetUsername);
      finishSuccess();
    } catch (e: any) {
      const confirmed = await confirmVerifiedLink(targetPlatform, targetUsername);
      if (confirmed) {
        finishSuccess();
        return;
      }
      setError(e?.message ?? "Verification failed");
      setStep("pending");
    }
  }

  async function handleCancel() {
    if (!confirm("Cancel this verification request?")) return;
    try {
      await cancelPendingVerification();
    } catch { /* ignore */ }
    setPending(null);
    setStep("idle");
    setUsername("");
    setError(null);
    setDiscordSession(null);
    setDiscordDisplay(null);
  }

  const expiresAt = pending
    ? new Date(pending.expires_at * 1000).toLocaleString()
    : null;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-1">Verify Your Identity</h2>
        <p className="text-gray-400 text-sm">
          Link your social media accounts to your wallet. GenLayer AI autonomously validates your post.
        </p>
      </div>

      {/* Progress steps */}
      <div className="flex items-center gap-3 mb-10">
        {[
          { n: 1, label: "Choose platform" },
          { n: 2, label: "Post the code" },
          { n: 3, label: "AI verification" },
        ].map((s, i) => {
          const isDone   = (step === "pending" && i === 0) || (step === "completing" && i <= 1) || (step === "done" && i <= 2);
          const isActive = (step === "idle" || step === "requesting") && i === 0
            || step === "pending" && i === 1
            || step === "completing" && i === 2;
          return (
            <div key={s.n} className="flex items-center gap-2">
              {i > 0 && <div className={clsx("h-px flex-1 w-8 transition-colors", isDone ? "bg-success" : "bg-gray-700")} />}
              <div className="flex items-center gap-2">
                <StepDot n={s.n} active={isActive} done={isDone} />
                <span className={clsx("text-sm hidden sm:block", isActive ? "text-white" : isDone ? "text-success" : "text-gray-500")}>
                  {s.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="mb-6 bg-red-950/40 border border-red-800 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-danger shrink-0 mt-0.5" />
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Step 1 — choose platform & username */}
      {(step === "idle" || step === "requesting") && (
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-6">
          <div>
            <label className="block text-sm font-medium mb-3">Platform</label>
            <div className="flex gap-3">
              {PLATFORMS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setPlatform(p.id)}
                  className={clsx(
                    "flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-colors",
                    platform === p.id
                      ? "bg-brand-600/20 border-brand-500 text-brand-300"
                      : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600"
                  )}
                >
                  {p.icon} {p.label}
                </button>
              ))}
            </div>
          </div>

          {platform === "discord" ? (
            <div>
              <label className="block text-sm font-medium mb-2">Discord account</label>
              <div className="bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-sm">
                {discordSession ? (
                  <div>
                    <p className="text-white font-medium">{discordDisplay ?? username}</p>
                    <p className="text-gray-500 font-mono text-xs mt-1">{username}</p>
                  </div>
                ) : (
                  <p className="text-gray-400">Connect Discord with OAuth to continue.</p>
                )}
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-2">Username</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">@</span>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value.replace(/^@/, ""))}
                  placeholder={PLATFORMS.find(p => p.id === platform)?.placeholder ?? "username"}
                  className="input w-full pl-7"
                  onKeyDown={e => e.key === "Enter" && handleRequest()}
                />
              </div>
            </div>
          )}

          <div className="bg-gray-800/60 rounded-xl p-4 text-sm text-gray-400 space-y-1">
            <p className="font-medium text-gray-300">How it works:</p>
            {platform === "discord" ? (
              <>
                <p>1. Connect Discord with OAuth.</p>
                <p>2. We generate a short-lived backend attestation.</p>
                <p>3. GenLayer validators fetch that attestation and link your account.</p>
              </>
            ) : (
              <>
                <p>1. We generate a unique verification code for you.</p>
                <p>2. Post that code publicly on your {PLATFORMS.find(p => p.id === platform)?.label} profile.</p>
                <p>3. GenLayer AI fetches and validates it.</p>
              </>
            )}
          </div>

          <button
            onClick={handleRequest}
            disabled={(platform !== "discord" && !username.trim()) || step === "requesting"}
            className="btn-primary w-full justify-center"
          >
            {step === "requesting" ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Generating code…</>
            ) : platform === "discord" && !discordSession ? (
              <>Connect Discord <ExternalLink className="w-4 h-4" /></>
            ) : (
              <>Generate verification code <ArrowRight className="w-4 h-4" /></>
            )}
          </button>
        </div>
      )}

      {/* Step 2 — post the code */}
      {step === "pending" && pending && (
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-6">
          <div>
            <p className="text-sm text-gray-400 mb-1">
              {platform === "discord" ? "Discord account connected as" : "Post this code publicly on your"}
            </p>
            <div className="flex items-center gap-2 mb-4">
              {PLATFORMS.find(p => p.id === platform)?.icon}
              <span className="font-semibold capitalize">{platform}</span>
              <span className="text-gray-400">
                {platform === "discord" ? "OAuth claim" : "profile as"} <strong className="text-white">@{pending.username}</strong>
              </span>
            </div>

            {/* Code box */}
            <div className="bg-gray-950 border border-brand-800/50 rounded-xl p-4 font-mono text-brand-300 text-sm flex items-center justify-between gap-3">
              <span className="break-all">{pending.verification_code}</span>
              <button
                onClick={copyCode}
                className="shrink-0 text-gray-500 hover:text-brand-400 transition-colors"
                title="Copy"
              >
                {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Platform-specific instructions */}
          {platform === "github" ? (
            <div className="bg-yellow-950/30 border border-yellow-800/40 rounded-xl p-4 text-sm text-yellow-300 space-y-1">
              <p className="font-medium">Instructions:</p>
              <p>• Open Settings → Profile and paste the code above into your <strong>Bio</strong>.</p>
              <p>• Save the change so it's <strong>publicly visible</strong>, then come back and click Verify.</p>
              <p>• Expires: <strong>{expiresAt}</strong></p>
            </div>
          ) : platform === "discord" ? (
            <div className="bg-yellow-950/30 border border-yellow-800/40 rounded-xl p-4 text-sm text-yellow-300 space-y-1">
              <p className="font-medium">Instructions:</p>
              <p>Discord is already connected. The backend will publish a short-lived OAuth attestation containing this code.</p>
              <p>Click Verify so GenLayer validators can fetch the attestation.</p>
              <p>Expires: <strong>{expiresAt}</strong></p>
            </div>
          ) : (
            <div className="bg-yellow-950/30 border border-yellow-800/40 rounded-xl p-4 text-sm text-yellow-300 space-y-2">
              <p className="font-medium">Instructions:</p>
              <p>1. <strong>Post a public tweet</strong> containing the code above.</p>
              <p>2. Open that tweet and <strong>copy its URL</strong> from the address bar.</p>
              <p>3. Paste the URL below, then click Verify.</p>
              <p className="text-yellow-400/70 text-xs pt-1">
                Why a tweet URL? X blocks anonymous profile scraping. The contract uses Twitter's
                public oEmbed endpoint to read the specific tweet you point at — works every time.
              </p>
              <p>• Expires: <strong>{expiresAt}</strong></p>
            </div>
          )}

          {platform === "twitter" ? (
            <>
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(
                  `Verifying my identity on SoulStamp 🪪\n\n${pending.verification_code}`
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-secondary w-full justify-center"
              >
                Compose tweet with code <ExternalLink className="w-4 h-4" />
              </a>

              <div>
                <label className="block text-sm font-medium mb-2">Tweet URL</label>
                <input
                  type="url"
                  value={postUrl}
                  onChange={e => setPostUrl(e.target.value)}
                  placeholder={`https://x.com/${pending.username}/status/...`}
                  className="input w-full font-mono text-xs"
                />
              </div>
            </>
          ) : (
            <a
              href={pending.profile_url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-secondary w-full justify-center"
            >
              Open {platform} profile <ExternalLink className="w-4 h-4" />
            </a>
          )}

          {platform === "discord" && !discordSession && (
            <button
              onClick={startDiscordOAuth}
              className="btn-secondary w-full justify-center"
            >
              Reconnect Discord <ExternalLink className="w-4 h-4" />
            </button>
          )}

          <button
            onClick={handleComplete}
            disabled={(platform === "twitter" && !postUrl.trim()) || (platform === "discord" && !discordSession)}
            className="btn-primary w-full justify-center"
          >
            {platform === "twitter" ? "Verify this tweet" : platform === "discord" ? "Verify Discord account" : "I've posted the code - Verify now"}
            <ArrowRight className="w-4 h-4" />
          </button>

          <button onClick={handleCancel} className="text-xs text-gray-600 hover:text-gray-400 w-full text-center transition-colors">
            Cancel and start over
          </button>
        </div>
      )}

      {/* Step 3 — completing */}
      {step === "completing" && (
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-10 text-center space-y-4">
          <div className="relative w-16 h-16 mx-auto">
            <Loader2 className="w-16 h-16 animate-spin text-brand-500 absolute inset-0" />
            <div className="absolute inset-0 flex items-center justify-center">
              <Github className="w-6 h-6 text-gray-300" />
            </div>
          </div>
          <h3 className="text-lg font-semibold">AI is verifying your profile…</h3>
          <p className="text-sm text-gray-400 max-w-sm mx-auto">
            GenLayer validators are independently fetching your profile and running LLM analysis.
            This may take 30–90 seconds.
          </p>
        </div>
      )}

      {/* Done */}
      {step === "done" && (
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-10 text-center space-y-4">
          <CheckCircle2 className="w-16 h-16 text-success mx-auto" />
          <h3 className="text-xl font-bold">Identity Verified!</h3>
          <p className="text-sm text-gray-400">
            Your social media account has been cryptographically linked to your wallet on GenLayer.
          </p>
          <button
            onClick={() => { setStep("idle"); setUsername(""); setError(null); }}
            className="btn-secondary"
          >
            <RotateCcw className="w-4 h-4" /> Verify another account
          </button>
        </div>
      )}
    </div>
  );
}
