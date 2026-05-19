import { useEffect, useState } from "react";
import { ClipboardList, Loader2, CheckCircle2, XCircle, ShieldAlert, ShieldOff, RefreshCw } from "lucide-react";
import clsx from "clsx";
import { useWallet } from "../lib/useWallet";
import { getAuditLog } from "../lib/contract";
import type { AuditEntry } from "../types";

const ACTION_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  verification_completed: { label: "Verified",       icon: <CheckCircle2 className="w-4 h-4" />, color: "text-success" },
  revoked_by_owner:       { label: "Revoked",        icon: <XCircle className="w-4 h-4" />,      color: "text-gray-400" },
  revoked:                { label: "Revoked",        icon: <XCircle className="w-4 h-4" />,      color: "text-gray-400" },
  admin_flagged:          { label: "Admin Flagged",  icon: <ShieldAlert className="w-4 h-4" />,  color: "text-danger" },
  admin_unflagged:        { label: "Flag Cleared",   icon: <ShieldOff className="w-4 h-4" />,    color: "text-success" },
};

function getActionMeta(action: string) {
  return ACTION_META[action] ?? { label: action, icon: <ClipboardList className="w-4 h-4" />, color: "text-gray-400" };
}

export function AuditTrail() {
  const { address } = useWallet();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const log = await getAuditLog(address!);
      setEntries([...log].reverse()); // newest first
    } catch (e: any) {
      setError(e?.message ?? "Failed to load audit log");
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

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold mb-1">Audit Trail</h2>
          <p className="text-gray-400 text-sm">Full verification history for your wallet address.</p>
        </div>
        <button onClick={load} className="btn-secondary">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <div className="bg-red-950/40 border border-red-800 rounded-xl p-4 text-red-300 text-sm mb-6">
          {error}
        </div>
      )}

      {entries.length === 0 ? (
        <div className="text-center py-20 text-gray-500 border border-dashed border-gray-700 rounded-2xl">
          <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p>No audit entries yet</p>
        </div>
      ) : (
        <div className="relative space-y-0">
          {/* Timeline line */}
          <div className="absolute left-[22px] top-0 bottom-0 w-px bg-gray-800 z-0" />

          {entries.map((entry, i) => {
            const meta = getActionMeta(entry.action);
            const date = new Date(entry.timestamp * 1000);

            return (
              <div key={i} className="relative flex gap-4 pb-6 z-10">
                {/* Dot */}
                <div className={clsx(
                  "w-11 h-11 rounded-full bg-gray-900 border-2 flex items-center justify-center shrink-0",
                  entry.action === "verification_completed" ? "border-success/50" :
                  entry.action.startsWith("admin") ? "border-danger/50" :
                  "border-gray-700"
                )}>
                  <span className={meta.color}>{meta.icon}</span>
                </div>

                {/* Content */}
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <span className={clsx("text-sm font-semibold", meta.color)}>{meta.label}</span>
                      {entry.platform && (
                        <span className="ml-2 text-xs text-gray-500 capitalize">
                          {entry.platform} {entry.username && `· @${entry.username}`}
                        </span>
                      )}
                    </div>
                    <time className="text-xs text-gray-500 shrink-0" title={date.toISOString()}>
                      {date.toLocaleDateString()} {date.toLocaleTimeString()}
                    </time>
                  </div>

                  {entry.result && entry.result !== "approved" && entry.result !== "revoked" && entry.result !== "revoked_by_owner" && entry.result !== "cleared_by_admin" && (
                    <p className="text-xs text-gray-400 mb-2 italic">"{entry.result}"</p>
                  )}

                  {entry.confidence > 0 && (
                    <div className="flex gap-4 text-xs text-gray-500">
                      <span>Identity confidence: <span className={clsx(
                        "font-mono font-medium",
                        entry.confidence >= 75 ? "text-success" :
                        entry.confidence >= 50 ? "text-yellow-400" : "text-danger"
                      )}>{entry.confidence}%</span></span>
                      {entry.bot_score > 0 && (
                        <span>Bot score: <span className={clsx(
                          "font-mono font-medium",
                          entry.bot_score < 30 ? "text-success" :
                          entry.bot_score < 60 ? "text-yellow-400" : "text-danger"
                        )}>{entry.bot_score}%</span></span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
