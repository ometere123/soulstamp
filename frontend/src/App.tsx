import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { WalletProvider } from "./lib/WalletContext";
import { useWallet } from "./lib/useWallet";
import { Header } from "./components/Header";
import { Dashboard } from "./components/Dashboard";
import { VerificationFlow } from "./components/VerificationFlow";
import { PublicLookup } from "./components/PublicLookup";
import { AuditTrail } from "./components/AuditTrail";
import { AdminPanel } from "./components/AdminPanel";
import { getStats } from "./lib/contract";

function AppInner() {
  const { address, connect, connecting } = useWallet();
  const [tab, setTab]       = useState("dashboard");
  const [isAdmin, setIsAdmin] = useState(false);

  // Check admin status whenever the connected address changes
  useEffect(() => {
    if (!address) { setIsAdmin(false); return; }
    (async () => {
      try {
        const stats = await getStats();
        setIsAdmin(stats.admin.toLowerCase() === address.toLowerCase());
      } catch { /* contract not yet deployed */ }
    })();
  }, [address]);

  return (
    <div className="min-h-screen bg-gray-950">
      <Header activeTab={tab} onTabChange={setTab} isAdmin={isAdmin} />

      <main className="max-w-7xl mx-auto px-4 py-10">
        {/* Not connected — landing / connect prompt */}
        {!address ? (
          <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-8">
            <div className="bg-brand-600 p-5 rounded-2xl">
              <Shield className="w-12 h-12 text-white" />
            </div>
            <div className="space-y-3 max-w-md">
              <h1 className="text-3xl font-bold">Verify your identity on-chain</h1>
              <p className="text-gray-400">
                SoulStamp uses GenLayer AI to autonomously verify your social media accounts
                and link them to your wallet — no manual review, no trusted third parties.
              </p>
            </div>
            <div className="flex flex-col items-center gap-3">
              <button onClick={connect} disabled={connecting} className="btn-primary text-base px-8 py-3">
                {connecting ? "Connecting…" : "Connect Wallet to get started"}
              </button>
              <p className="text-xs text-gray-600">
                Uses your injected browser wallet (MetaMask, etc.) · Studionet
              </p>
            </div>

            {/* Feature cards */}
            <div className="grid sm:grid-cols-3 gap-4 mt-4 text-left max-w-2xl w-full">
              {[
                { title: "AI-Powered Verification", desc: "GenLayer LLMs autonomously fetch and validate your social media post." },
                { title: "Sybil Resistant",         desc: "One social account can only link to one wallet address, enforced on-chain." },
                { title: "Fully On-Chain",           desc: "Verification proofs and identity records are immutable and publicly auditable." },
              ].map(f => (
                <div key={f.title} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                  <h3 className="font-semibold text-sm mb-1.5">{f.title}</h3>
                  <p className="text-xs text-gray-500">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {tab === "dashboard" && <Dashboard onStartVerify={() => setTab("verify")} />}
            {tab === "verify"    && <VerificationFlow />}
            {tab === "lookup"    && <PublicLookup />}
            {tab === "audit"     && <AuditTrail />}
            {tab === "admin"     && isAdmin && <AdminPanel />}
          </>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <AppInner />
    </WalletProvider>
  );
}
