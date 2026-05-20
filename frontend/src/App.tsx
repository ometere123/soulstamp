import { useEffect, useState } from "react";
import { WalletProvider } from "./lib/WalletContext";
import { useWallet } from "./lib/useWallet";
import { Header } from "./components/Header";
import { Dashboard } from "./components/Dashboard";
import { VerificationFlow } from "./components/VerificationFlow";
import { PublicLookup } from "./components/PublicLookup";
import { AuditTrail } from "./components/AuditTrail";
import { AdminPanel } from "./components/AdminPanel";
import { Footer } from "./components/Footer";
import { LandingPage } from "./components/LandingPage";
import { getStats } from "./lib/contract";

function AppInner() {
  const { address } = useWallet();
  const [tab, setTab] = useState("dashboard");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (!address) {
      setIsAdmin(false);
      return;
    }

    (async () => {
      try {
        const stats = await getStats();
        setIsAdmin(stats.admin.toLowerCase() === address.toLowerCase());
      } catch {
        setIsAdmin(false);
      }
    })();
  }, [address]);

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col">
      <Header activeTab={tab} onTabChange={setTab} isAdmin={isAdmin} />

      <main className="max-w-7xl mx-auto px-4 py-10 flex-1 w-full">
        {!address ? (
          <LandingPage />
        ) : (
          <>
            {tab === "dashboard" && <Dashboard onStartVerify={() => setTab("verify")} />}
            {tab === "verify" && <VerificationFlow />}
            {tab === "lookup" && <PublicLookup />}
            {tab === "audit" && <AuditTrail />}
            {tab === "admin" && isAdmin && <AdminPanel />}
          </>
        )}
      </main>

      <Footer onNavigate={setTab} />
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
