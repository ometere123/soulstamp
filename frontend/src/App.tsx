import { useEffect, useState } from "react";
import { WalletProvider } from "./lib/WalletContext";
import { useWallet } from "./lib/useWallet";
import { Header } from "./components/Header";
import { Dashboard } from "./components/Dashboard";
import { VerificationFlow } from "./components/VerificationFlow";
import { PublicLookup } from "./components/PublicLookup";
import { AuditTrail } from "./components/AuditTrail";
import { AdminPanel } from "./components/AdminPanel";
import { ChallengePanel } from "./components/ChallengePanel";
import { Footer } from "./components/Footer";
import { LandingPage } from "./components/LandingPage";
import { TrustPassDashboard } from "./components/TrustPassDashboard";
import { OrganisationPortal } from "./components/OrganisationPortal";
import { getStats } from "./lib/contract";
import { authCallbackTab, captureGoogleCallback, type GoogleCallback } from "./lib/google";

function readInitialGoogleCallback(): GoogleCallback {
  return typeof window === "undefined" ? { status: "none" } : captureGoogleCallback();
}

function AppInner() {
  const { address } = useWallet();
  const [googleCallback, setGoogleCallback] = useState<GoogleCallback>(readInitialGoogleCallback);
  const [tab, setTab] = useState(authCallbackTab(googleCallback, typeof window === "undefined" ? "" : window.location.search) || "dashboard");
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const callback = captureGoogleCallback();
    if (callback.status !== "none") {
      setGoogleCallback(callback);
      setTab("trustpass");
    }
  }, []);

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
        {!address && tab !== "verify" && tab !== "lookup" && !(tab === "trustpass" && googleCallback.status !== "none") ? (
          <LandingPage />
        ) : (
          <>
            {tab === "dashboard" && <Dashboard onStartVerify={() => setTab("verify")} />}
            {tab === "trustpass" && address && <TrustPassDashboard wallet={address} googleCallback={googleCallback} />}
            {tab === "trustpass" && !address && googleCallback.status !== "none" && <section className="rounded-xl border border-brand-800/60 bg-gray-900/60 p-6"><h1 className="text-xl font-semibold text-white">Google authenticated — reconnect your wallet</h1><p className="text-sm text-gray-300 mt-2">The signed Google evidence is held only in this browser session and is bound to the wallet that started the request. Reconnect that wallet to complete on-chain linking.</p></section>}
            {tab === "organisation" && address && <OrganisationPortal wallet={address} />}
            {tab === "verify" && <VerificationFlow />}
            {tab === "challenges" && address && <ChallengePanel />}
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
