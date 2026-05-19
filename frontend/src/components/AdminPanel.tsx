import { useEffect, useState } from "react";
import {
  ShieldAlert, ShieldOff, Loader2, RefreshCw,
  Users, Activity, AlertTriangle, Search, Trash2
} from "lucide-react";
import clsx from "clsx";
import {
  getStats,
  getAllAddresses,
  getIdentity,
  flagIdentity,
  unflagIdentity,
  revokePlatform,
  setDiscordAttestationBaseUrl,
} from "../lib/contract";
import type { PlatformStats, IdentityRecord } from "../types";

interface IdentityRow {
  address: string;
  identity: IdentityRecord;
}

export function AdminPanel() {
  const [stats, setStats]           = useState<PlatformStats | null>(null);
  const [rows, setRows]             = useState<IdentityRow[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [listError, setListError]   = useState<string | null>(null);
  const [actionId, setActionId]     = useState<string | null>(null);
  const [flagReason, setFlagReason] = useState<Record<string, string>>({});
  const [searchAddr, setSearchAddr] = useState("");
  const [searching, setSearching]   = useState(false);
  const [discordBaseUrl, setDiscordBaseUrl] = useState("");
  const [savingDiscordBase, setSavingDiscordBase] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    setStatsError(null);
    setListError(null);

    try {
      const s = await getStats(60_000);
      setStats(s);
      setDiscordBaseUrl(s.discord_attestation_base_url ?? "");
    } catch (e: any) {
      setStatsError(e?.message ?? "Failed to load platform stats");
    }

    try {
      const addrs = await getAllAddresses(0, 10, 60_000);
      const rowData: IdentityRow[] = [];
      for (const addr of addrs) {
        try {
          const id = await getIdentity(addr, 60_000);
          if (id.found) rowData.push({ address: addr, identity: id });
        } catch (e: any) {
          console.log(`[soulstamp] skipped admin identity row ${addr}:`, e?.message ?? e);
        }
      }
      setRows(rowData);
    } catch (e: any) {
      setListError(e?.message ?? "Failed to load identity list");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSearch() {
    if (!searchAddr.trim()) return;
    setSearching(true);
    try {
      const id = await getIdentity(searchAddr.trim(), 60_000);
      if (id.found) {
        const exists = rows.find(r => r.address === searchAddr.trim());
        if (!exists) setRows(prev => [{ address: searchAddr.trim(), identity: id }, ...prev]);
      } else {
        alert("No identity found for that address");
      }
    } catch (e: any) {
      alert(e?.message ?? "Search failed");
    } finally {
      setSearching(false);
    }
  }

  async function handleFlag(address: string) {
    const reason = flagReason[address]?.trim();
    if (!reason) { alert("Enter a flag reason first"); return; }
    setActionId(address);
    try {
      await flagIdentity(address, reason);
      await load();
    } catch (e: any) {
      alert(e?.message ?? "Flag failed");
    } finally {
      setActionId(null);
    }
  }

  async function handleUnflag(address: string) {
    setActionId(address);
    try {
      await unflagIdentity(address);
      await load();
    } catch (e: any) {
      alert(e?.message ?? "Unflag failed");
    } finally {
      setActionId(null);
    }
  }

  async function handleRevoke(platform: string, username: string) {
    if (!confirm(`Revoke @${username} on ${platform}?`)) return;
    const key = `revoke:${platform}:${username}`;
    setActionId(key);
    try {
      await revokePlatform(platform, username);
      await load();
    } catch (e: any) {
      alert(e?.message ?? "Revoke failed");
    } finally {
      setActionId(null);
    }
  }

  async function handleSaveDiscordBaseUrl() {
    const clean = discordBaseUrl.trim().replace(/\/$/, "");
    if (!clean) { alert("Enter the public Discord backend URL first"); return; }
    setSavingDiscordBase(true);
    try {
      await setDiscordAttestationBaseUrl(clean);
      await load();
    } catch (e: any) {
      alert(e?.message ?? "Failed to save Discord backend URL");
    } finally {
      setSavingDiscordBase(false);
    }
  }

  if (loading && !stats && rows.length === 0) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
      </div>
    );
  }

  const flaggedCount = rows.filter(r => r.identity.is_flagged).length;

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold mb-1">Admin Panel</h2>
          <p className="text-gray-400 text-sm">Moderate identities and view platform-wide statistics.</p>
        </div>
        <button onClick={load} className="btn-secondary">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {(error || statsError || listError) && (
        <div className="bg-red-950/40 border border-red-800 rounded-xl p-4 text-red-300 text-sm mb-6 space-y-1">
          {error && <p>{error}</p>}
          {statsError && <p>{statsError}</p>}
          {listError && <p>{listError}</p>}
        </div>
      )}

      {/* Stats row */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {[
            { label: "Total Identities",    value: stats.total_identities,    icon: <Users className="w-5 h-5 text-brand-400" /> },
            { label: "Total Verifications", value: stats.total_verifications,  icon: <Activity className="w-5 h-5 text-success" /> },
            { label: "Flagged",             value: flaggedCount,               icon: <ShieldAlert className="w-5 h-5 text-danger" /> },
            { label: "Platforms",           value: stats.supported_platforms.join(", "), icon: <AlertTriangle className="w-5 h-5 text-yellow-400" /> },
          ].map(s => (
            <div key={s.label} className="bg-gray-900 border border-gray-700 rounded-xl p-4">
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-2">
                {s.icon} <span>{s.label}</span>
              </div>
              <div className="text-xl font-bold truncate">{s.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 mb-6">
        <label className="block text-sm font-medium mb-2">Discord attestation backend</label>
        <div className="flex gap-2">
          <input
            type="url"
            value={discordBaseUrl}
            onChange={e => setDiscordBaseUrl(e.target.value)}
            placeholder="https://your-public-discord-backend.example"
            className="input flex-1"
          />
          <button
            onClick={handleSaveDiscordBaseUrl}
            disabled={savingDiscordBase || !discordBaseUrl.trim()}
            className="btn-secondary"
          >
            {savingDiscordBase ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
          </button>
        </div>
      </div>

      {/* Address search */}
      <div className="flex gap-2 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            type="text"
            value={searchAddr}
            onChange={e => setSearchAddr(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="Search by wallet address…"
            className="input w-full pl-9"
          />
        </div>
        <button onClick={handleSearch} disabled={searching} className="btn-secondary">
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        </button>
      </div>

      {/* Identity table */}
      <div className="space-y-4">
        {rows.length === 0 && (
          <div className="text-center py-16 text-gray-500 border border-dashed border-gray-700 rounded-2xl">
            {listError ? (
              <>
                <p>Identity list is slow right now</p>
                <p className="text-xs mt-2">Search by wallet address still works.</p>
              </>
            ) : (
              "No registered identities yet"
            )}
          </div>
        )}

        {rows.map(({ address, identity }) => (
          <div
            key={address}
            className={clsx(
              "bg-gray-900 border rounded-xl p-5",
              identity.is_flagged ? "border-red-800/50" : "border-gray-700"
            )}
          >
            <div className="flex items-start gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="font-mono text-xs text-gray-300 truncate">{address}</span>
                  {identity.is_flagged && (
                    <span className="flex items-center gap-1 bg-red-950 text-red-400 text-xs px-2 py-0.5 rounded-full border border-red-800 shrink-0">
                      <ShieldAlert className="w-3 h-3" /> Flagged
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 space-x-3">
                  <span>Reputation: <span className="text-white font-medium">{identity.reputation_score}</span></span>
                  <span>Accounts: <span className="text-white font-medium">{identity.linked_accounts.length}</span></span>
                  <span>Verifications: <span className="text-white font-medium">{identity.verification_count}</span></span>
                </div>
                {identity.is_flagged && identity.flag_reason && (
                  <p className="mt-2 text-xs text-red-400 bg-red-950/30 rounded-lg px-3 py-1.5">
                    Reason: {identity.flag_reason}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 shrink-0">
                {identity.is_flagged ? (
                  <button
                    onClick={() => handleUnflag(address)}
                    disabled={actionId === address}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-success/10 border border-success/30 text-success rounded-lg hover:bg-success/20 transition-colors disabled:opacity-50"
                  >
                    {actionId === address ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldOff className="w-3.5 h-3.5" />}
                    Clear Flag
                  </button>
                ) : (
                  <button
                    onClick={() => handleFlag(address)}
                    disabled={actionId === address}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-danger/10 border border-danger/30 text-danger rounded-lg hover:bg-danger/20 transition-colors disabled:opacity-50"
                  >
                    {actionId === address ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                    Flag
                  </button>
                )}
              </div>
            </div>

            {/* Flag reason input */}
            {!identity.is_flagged && (
              <div className="mt-3">
                <input
                  type="text"
                  placeholder="Flag reason (required before flagging)…"
                  value={flagReason[address] ?? ""}
                  onChange={e => setFlagReason(prev => ({ ...prev, [address]: e.target.value }))}
                  className="input w-full text-xs py-1.5"
                />
              </div>
            )}

            {/* Linked accounts mini */}
            {identity.linked_accounts.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {identity.linked_accounts.map(acct => (
                  <span
                    key={`${acct.platform}:${acct.username}`}
                    className="inline-flex items-center gap-2 text-xs bg-gray-800 text-gray-400 px-2 py-1 rounded-lg"
                  >
                    <span className="capitalize">{acct.platform}: @{acct.username} ({acct.confidence_score}%)</span>
                    <button
                      onClick={() => handleRevoke(acct.platform, acct.username)}
                      disabled={actionId === `revoke:${acct.platform}:${acct.username}`}
                      className="text-gray-500 hover:text-danger transition-colors disabled:opacity-50"
                      title="Revoke verified link"
                    >
                      {actionId === `revoke:${acct.platform}:${acct.username}`
                        ? <Loader2 className="w-3 h-3 animate-spin" />
                        : <Trash2 className="w-3 h-3" />}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
