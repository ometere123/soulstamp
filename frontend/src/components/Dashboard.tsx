import { useEffect, useState } from "react";
import {
  Github, Twitter, MessageCircle, Shield, ShieldAlert, ShieldOff,
  Star, Clock, RefreshCw, Loader2
} from "lucide-react";
import clsx from "clsx";
import { useWallet } from "../lib/useWallet";
import { getIdentity, reverifyPlatform } from "../lib/contract";
import type { IdentityRecord, LinkedAccount, ProofStatus } from "../types";

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  github:  <Github className="w-5 h-5" />,
  twitter: <Twitter className="w-5 h-5" />,
  discord: <MessageCircle className="w-5 h-5" />,
};

const PLATFORM_COLORS: Record<string, string> = {
  github:  "bg-gray-800 text-gray-100",
  twitter: "bg-sky-900/40 text-sky-300",
  discord: "bg-indigo-950/40 text-indigo-200",
};

function ScoreMeter({ value, label }: { value: number; label: string }) {
  const pct = Math.min(100, Math.max(0, value));
  const color =
    pct >= 75 ? "bg-success" :
    pct >= 50 ? "bg-yellow-400" :
    "bg-danger";

  return (
    <div>
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{label}</span>
        <span className="font-mono font-medium text-white">{pct}</span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className={clsx("h-full rounded-full transition-all duration-700", color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const STATUS_STYLES: Record<ProofStatus, string> = {
  ACTIVE: "bg-success/10 text-success border-success/30",
  STALE: "bg-yellow-400/10 text-yellow-300 border-yellow-400/30",
  REVOKED: "bg-gray-700 text-gray-300 border-gray-600",
  CONFLICTED: "bg-red-950 text-red-300 border-red-700",
  FLAGGED: "bg-red-950 text-red-300 border-red-700",
};

function ProofHealthBadge({ status }: { status?: ProofStatus }) {
  const health = status ?? "ACTIVE";
  return (
    <span className={clsx("px-2 py-0.5 rounded-full text-[11px] font-semibold border", STATUS_STYLES[health])}>
      {health}
    </span>
  );
}

function AccountCard({ account, onReverified }: { account: LinkedAccount; onReverified: () => void }) {
  const [rechecking, setRechecking] = useState(false);
  const [fetchUrl, setFetchUrl] = useState("");

  async function handleReverify() {
    setRechecking(true);
    try {
      await reverifyPlatform(account.platform, account.username, fetchUrl.trim());
      setFetchUrl("");
      onReverified();
    } finally {
      setRechecking(false);
    }
  }

  const dossier = account.dossier;
  const badgeText = `SoulStamp proof: ${account.platform}/${account.username} ${account.proof_status ?? "ACTIVE"} ${account.proof_strength ?? "MEDIUM"}`;

  return (
    <div className={clsx("rounded-xl p-4 border border-gray-700/50 flex flex-col gap-3", PLATFORM_COLORS[account.platform] ?? "bg-gray-800")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {PLATFORM_ICONS[account.platform] ?? <Shield className="w-5 h-5" />}
          <div className="min-w-0">
            <a
              href={account.profile_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold hover:underline truncate block"
            >
              @{account.username}
            </a>
            <span className="text-xs text-gray-400 capitalize">{account.platform}</span>
          </div>
        </div>
        <ProofHealthBadge status={account.proof_status} />
      </div>

      <div className="space-y-2">
        <ScoreMeter value={account.confidence_score} label="Identity confidence" />
        <ScoreMeter value={100 - account.bot_score} label="Proof safety" />
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-gray-950/30 rounded-lg p-2">
          <span className="block text-gray-500">Strength</span>
          <span className="font-semibold">{account.proof_strength ?? "MEDIUM"}</span>
        </div>
        <div className="bg-gray-950/30 rounded-lg p-2">
          <span className="block text-gray-500">Risk</span>
          <span className="font-semibold capitalize">{account.risk_band ?? "low"}</span>
        </div>
        <div className="bg-gray-950/30 rounded-lg p-2">
          <span className="block text-gray-500">Last check</span>
          <span className="font-semibold">#{account.last_checked_marker ?? account.verified_at}</span>
        </div>
      </div>

      {account.reasoning && (
        <p className="text-xs text-gray-400 italic border-t border-gray-700/50 pt-2">
          "{account.reasoning}"
        </p>
      )}

      {dossier && (
        <div className="text-xs text-gray-400 border-t border-gray-700/50 pt-2 space-y-1">
          <div>Reason: <span className="font-mono text-gray-300">{dossier.reason_code}</span></div>
          {dossier.canonical_platform_id && (
            <div>Canonical ID: <span className="font-mono text-gray-300">{dossier.canonical_platform_id}</span></div>
          )}
          <div>Verifier: <span className="font-mono text-gray-300">{dossier.verifier_version}</span></div>
        </div>
      )}

      <div className="flex gap-2">
        <input
          value={fetchUrl}
          onChange={e => setFetchUrl(e.target.value)}
          placeholder={account.platform === "twitter" ? "Tweet URL for recheck" : "Optional proof URL"}
          className="input text-xs flex-1"
        />
        <button onClick={handleReverify} disabled={rechecking} className="btn-secondary text-xs shrink-0">
          {rechecking ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          Recheck
        </button>
      </div>

      <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Created marker #{account.verified_at}</span>
        <button
          className="text-brand-300 hover:text-brand-200"
          onClick={() => navigator.clipboard?.writeText(badgeText)}
        >
          Copy badge
        </button>
      </div>
    </div>
  );
}

interface DashboardProps {
  onStartVerify: () => void;
}

export function Dashboard({ onStartVerify }: DashboardProps) {
  const { address } = useWallet();
  const [identity, setIdentity]   = useState<IdentityRecord | null>(null);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await getIdentity(address!);
      setIdentity(data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load identity");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (address) load(); }, [address]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-xl mx-auto mt-12 bg-red-950/30 border border-red-800 rounded-xl p-6 text-center">
        <ShieldAlert className="w-10 h-10 text-danger mx-auto mb-3" />
        <p className="text-red-300 mb-4">{error}</p>
        <button onClick={load} className="btn-secondary">Retry</button>
      </div>
    );
  }

  if (!identity?.found) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center">
        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-10">
          <ShieldOff className="w-14 h-14 text-gray-600 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">No identity yet</h2>
          <p className="text-gray-400 text-sm mb-6">
            Verify your social media accounts to establish your on-chain identity and start building reputation.
          </p>
          <button onClick={onStartVerify} className="btn-primary">
            Verify your first account
          </button>
        </div>
      </div>
    );
  }

  const accounts = identity.linked_accounts ?? [];

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Identity header */}
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-bold">Your Identity</h2>
              {identity.is_flagged && (
                <span className="flex items-center gap-1 bg-red-950 text-red-400 text-xs px-2 py-0.5 rounded-full border border-red-800">
                  <ShieldAlert className="w-3 h-3" /> Flagged
                </span>
              )}
            </div>
            <p className="font-mono text-xs text-gray-500">{address}</p>
          </div>
          <button onClick={load} className="btn-secondary shrink-0">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {identity.is_flagged && (
          <div className="mb-6 bg-red-950/40 border border-red-800/50 rounded-lg p-3 text-sm text-red-300">
            <strong>Flag reason:</strong> {identity.flag_reason}
          </div>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Reputation",     value: identity.reputation_score, icon: <Star className="w-4 h-4 text-yellow-400" /> },
            { label: "Accounts",       value: accounts.length,            icon: <Shield className="w-4 h-4 text-brand-400" /> },
            { label: "Verifications",  value: identity.verification_count, icon: <Shield className="w-4 h-4 text-success" /> },
            { label: "Proof checks",   value: identity.last_updated,       icon: <Clock className="w-4 h-4 text-gray-400" /> },
          ].map(stat => (
            <div key={stat.label} className="bg-gray-800 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                {stat.icon}
                <span>{stat.label}</span>
              </div>
              <div className="text-2xl font-bold tabular-nums">{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Linked accounts */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-200">Linked Accounts</h3>
          <button onClick={onStartVerify} className="btn-primary text-sm">
            + Link another
          </button>
        </div>

        {accounts.length === 0 ? (
          <div className="text-center py-10 text-gray-500 border border-dashed border-gray-700 rounded-xl">
            No active linked accounts
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {accounts.map(acct => (
              <AccountCard
                key={`${acct.platform}:${acct.username}`}
                account={acct}
                onReverified={load}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
