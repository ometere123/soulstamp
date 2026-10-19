import { useEffect, useState } from "react";
import { ExternalLink, ShieldCheck } from "lucide-react";
import { getTrustPasses, type TrustPassRecord } from "../lib/trustpass";
import { TrustPassPurchase } from "./TrustPassPurchase";

export function TrustPassDashboard({ wallet }: { wallet: string }) {
  const [passes, setPasses] = useState<TrustPassRecord[]>([]);
  const [error, setError] = useState("");

  async function refresh() {
    try { setPasses(await getTrustPasses(wallet)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  useEffect(() => { void refresh(); }, [wallet]);

  return <div className="space-y-6">
    <div className="rounded-2xl border border-brand-800/60 bg-gradient-to-br from-brand-950/50 to-gray-900 p-6"><div className="flex items-start gap-3"><ShieldCheck className="w-7 h-7 text-brand-400 mt-1" /><div><p className="text-xs uppercase tracking-widest text-brand-300">SoulStamp V4 · TrustPass & Sybil Gate</p><h1 className="text-3xl font-bold text-white mt-1">Evidence-backed access decisions</h1><p className="text-gray-300 mt-3 max-w-3xl">V4 combines your existing V3 identity state, optional Google account commitment, and real Human Passport on-chain evidence under a versioned policy. It exposes a reusable eligibility check without claiming that social accounts prove one human.</p></div></div></div>
    <TrustPassPurchase wallet={wallet} />
    <section className="space-y-3"><h2 className="text-lg font-semibold text-white">Your assessment history</h2>{error && <p className="text-sm text-red-300">{error}</p>}{passes.length === 0 ? <p className="text-sm text-gray-500">No settled TrustPass records for this wallet yet.</p> : <div className="grid md:grid-cols-2 gap-3">{passes.map((pass) => <article key={pass.assessment_id} className="rounded-xl border border-gray-800 bg-gray-900/60 p-4"><div className="flex justify-between gap-3"><div><p className="text-xs text-gray-500">{pass.policy_id}</p><h3 className="font-semibold text-white">{pass.outcome}</h3></div><span className={pass.state === "ACTIVE" ? "text-emerald-300 text-sm" : "text-amber-300 text-sm"}>{pass.state}</span></div><p className="text-xs text-gray-400 mt-2">{pass.reason_code}</p><p className="text-[11px] text-gray-500 mt-2 break-all">Assessment {pass.assessment_id}</p>{pass.arc_settlement_tx_hash && <a className="footer-link inline-flex items-center gap-1 text-xs mt-3" href={`https://explorer.testnet.arc.io/tx/${pass.arc_settlement_tx_hash}`} target="_blank" rel="noreferrer">Settlement evidence <ExternalLink className="w-3 h-3" /></a>}</article>)}</div>}</section>
  </div>;
}
