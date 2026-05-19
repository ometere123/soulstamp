import { useState } from "react";
import { Search, Github, Twitter, MessageCircle, Shield, ShieldAlert, Loader2, AlertCircle } from "lucide-react";
import clsx from "clsx";
import { getIdentity, lookupByPlatform } from "../lib/contract";
import type { IdentityRecord, PlatformLookupResult, Platform } from "../types";

type SearchMode = "address" | "platform";

const PLATFORMS: { id: Platform; label: string; icon: React.ReactNode }[] = [
  { id: "github",  label: "GitHub",  icon: <Github className="w-4 h-4" /> },
  { id: "twitter", label: "Twitter", icon: <Twitter className="w-4 h-4" /> },
  { id: "discord", label: "Discord", icon: <MessageCircle className="w-4 h-4" /> },
];

function PlatformIcon({ platform }: { platform: Platform }) {
  if (platform === "github") return <Github className="w-4 h-4 text-gray-300" />;
  if (platform === "twitter") return <Twitter className="w-4 h-4 text-sky-400" />;
  return <MessageCircle className="w-4 h-4 text-indigo-300" />;
}

function ReputationBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? "text-success border-success/30 bg-success/10" :
    score >= 50 ? "text-yellow-400 border-yellow-400/30 bg-yellow-400/10" :
                  "text-danger border-danger/30 bg-danger/10";
  const label =
    score >= 80 ? "Trusted" :
    score >= 50 ? "Moderate" :
                  "Low";
  return (
    <span className={clsx("px-2 py-0.5 rounded-full text-xs font-medium border", color)}>
      {label} ({score})
    </span>
  );
}

export function PublicLookup() {
  const [mode, setMode]         = useState<SearchMode>("address");
  const [platform, setPlatform] = useState<Platform>("github");
  const [query, setQuery]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const [identityResult, setIdentityResult] = useState<IdentityRecord | null>(null);
  const [platformResult, setPlatformResult] = useState<PlatformLookupResult | null>(null);

  function reset() {
    setIdentityResult(null);
    setPlatformResult(null);
    setError(null);
  }

  async function handleSearch() {
    if (!query.trim()) return;
    reset();
    setLoading(true);
    setError(null);
    try {
      if (mode === "address") {
        const r = await getIdentity(query.trim());
        setIdentityResult(r);
      } else {
        const r = await lookupByPlatform(platform, query.trim().replace(/^@/, ""));
        setPlatformResult(r);
        if (r.found && r.owner_address) {
          const id = await getIdentity(r.owner_address);
          setIdentityResult(id);
        }
      }
    } catch (e: any) {
      setError(e?.message ?? "Search failed");
    } finally {
      setLoading(false);
    }
  }

  const hasResult = identityResult !== null || platformResult !== null;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h2 className="text-2xl font-bold mb-1">Public Identity Lookup</h2>
        <p className="text-gray-400 text-sm">Search any wallet address or social media account to view its on-chain identity.</p>
      </div>

      {/* Mode toggle */}
      <div className="flex gap-2 mb-5">
        {(["address", "platform"] as SearchMode[]).map(m => (
          <button
            key={m}
            onClick={() => { setMode(m); reset(); setQuery(""); }}
            className={clsx(
              "px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              mode === m
                ? "bg-brand-600 text-white"
                : "bg-gray-800 text-gray-400 hover:bg-gray-700"
            )}
          >
            {m === "address" ? "By Wallet Address" : "By Social Account"}
          </button>
        ))}
      </div>

      {/* Search bar */}
      <div className="flex gap-2 mb-4">
        {mode === "platform" && (
          <div className="flex gap-1">
            {PLATFORMS.map(p => (
              <button
                key={p.id}
                onClick={() => setPlatform(p.id)}
                className={clsx(
                  "flex items-center gap-1 px-3 py-2.5 rounded-lg border text-sm transition-colors",
                  platform === p.id
                    ? "bg-brand-600/20 border-brand-500 text-brand-300"
                    : "bg-gray-800 border-gray-700 text-gray-400"
                )}
              >
                {p.icon}
                <span className="hidden sm:inline">{p.label}</span>
              </button>
            ))}
          </div>
        )}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder={mode === "address" ? "0x…" : `@username on ${platform}`}
            className="input w-full pl-9"
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={loading || !query.trim()}
          className="btn-primary shrink-0"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </button>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800 rounded-xl p-4 flex items-center gap-3 mb-4">
          <AlertCircle className="w-5 h-5 text-danger shrink-0" />
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* No result */}
      {hasResult && !identityResult?.found && !platformResult?.found && (
        <div className="text-center py-16 text-gray-500 border border-dashed border-gray-700 rounded-2xl">
          <Shield className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No identity found for this {mode === "address" ? "address" : "account"}</p>
        </div>
      )}

      {/* Platform result pointer */}
      {platformResult?.found && !identityResult?.found && (
        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 mb-4">
          <p className="text-sm text-gray-400">Linked to address:</p>
          <p className="font-mono text-sm text-brand-300 mt-1">{platformResult.owner_address}</p>
        </div>
      )}

      {/* Identity result */}
      {identityResult?.found && (
        <div className="bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden">
          {/* Header */}
          <div className="p-5 border-b border-gray-700">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-semibold">Verified Identity</h3>
                  {identityResult.is_flagged ? (
                    <span className="flex items-center gap-1 bg-red-950 text-red-400 text-xs px-2 py-0.5 rounded-full">
                      <ShieldAlert className="w-3 h-3" /> Flagged
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 bg-success/10 text-success text-xs px-2 py-0.5 rounded-full">
                      <Shield className="w-3 h-3" /> Verified
                    </span>
                  )}
                </div>
                <p className="font-mono text-xs text-gray-500">{identityResult.owner}</p>
              </div>
              <ReputationBadge score={identityResult.reputation_score} />
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 divide-x divide-gray-800 border-b border-gray-700">
            {[
              { label: "Reputation",    value: identityResult.reputation_score },
              { label: "Linked",        value: `${identityResult.linked_accounts.length} accounts` },
              { label: "Verifications", value: identityResult.verification_count },
            ].map(s => (
              <div key={s.label} className="p-4 text-center">
                <div className="text-xl font-bold">{s.value}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
              </div>
            ))}
          </div>

          {/* Linked accounts */}
          <div className="p-5 space-y-3">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Linked Accounts</p>
            {identityResult.linked_accounts.map(acct => (
              <div
                key={`${acct.platform}:${acct.username}`}
                className="flex items-center justify-between gap-3 bg-gray-800/50 rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <PlatformIcon platform={acct.platform} />
                  <a
                    href={acct.profile_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium hover:underline"
                  >
                    @{acct.username}
                  </a>
                  <span className="text-xs text-gray-500 capitalize hidden sm:inline">{acct.platform}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-400">Confidence</span>
                  <span className={clsx(
                    "text-xs font-mono font-medium",
                    acct.confidence_score >= 75 ? "text-success" :
                    acct.confidence_score >= 50 ? "text-yellow-400" : "text-danger"
                  )}>
                    {acct.confidence_score}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
