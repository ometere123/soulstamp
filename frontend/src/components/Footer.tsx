import { useEffect, useState } from "react";
import { ExternalLink, Github, X } from "lucide-react";

type LegalDocId = "terms" | "privacy" | "disclaimer";

interface FooterProps {
  onNavigate: (tab: string) => void;
}

interface LegalDoc {
  title: string;
  updated: string;
  intro: string;
  sections: Array<{
    heading: string;
    body: string;
  }>;
}

const LEGAL_DOCS: Record<LegalDocId, LegalDoc> = {
  terms: {
    title: "Terms of Use",
    updated: "May 20, 2026",
    intro:
      "These terms describe the basic rules for using SoulStamp during its testnet release.",
    sections: [
      {
        heading: "Experimental testnet software",
        body:
          "SoulStamp is built for GenLayer Studionet and is provided for testing, demonstration, and development. It is not a production identity, KYC, compliance, credit, or access-control service.",
      },
      {
        heading: "Wallet and account control",
        body:
          "You are responsible for the wallet you connect and the social accounts you choose to verify. Submitting a verification request means you want SoulStamp validators to inspect the public source or Discord attestation you provide.",
      },
      {
        heading: "Public on-chain records",
        body:
          "Verified identity records, platform handles, confidence scores, reasoning summaries, audit events, and moderation actions may be written to public chain state. Public chain data can be difficult or impossible to remove.",
      },
      {
        heading: "Moderation",
        body:
          "SoulStamp includes admin moderation tools for flagging identities, clearing flags, and revoking linked accounts where abuse, mistaken verification, or unsafe usage is detected.",
      },
      {
        heading: "No warranties",
        body:
          "SoulStamp is provided as-is. Verification may fail, be delayed, or produce incorrect confidence signals. Do not rely on it as the only basis for high-stakes decisions.",
      },
    ],
  },
  privacy: {
    title: "Privacy Notice",
    updated: "May 20, 2026",
    intro:
      "This notice explains what SoulStamp handles when you verify an account.",
    sections: [
      {
        heading: "Public wallet and identity data",
        body:
          "SoulStamp stores wallet addresses, linked platform names, account handles or identifiers, verification counts, confidence scores, reasoning summaries, and audit history in public contract state.",
      },
      {
        heading: "GitHub and X verification",
        body:
          "For GitHub and X, validators inspect public profile or post content that you intentionally expose for verification. SoulStamp does not need your GitHub or X password.",
      },
      {
        heading: "Discord verification",
        body:
          "For Discord, the attestation backend uses Discord OAuth to confirm account control. The public attestation can include your Discord ID, username, display name, avatar URL, email verification status, account age signal, and the short-lived verification code. It does not publish your Discord email address.",
      },
      {
        heading: "Temporary backend data",
        body:
          "Discord OAuth sessions and attestations are short-lived and are used so validators can fetch proof during verification. Hosting providers may keep infrastructure logs according to their own policies.",
      },
      {
        heading: "Your choices",
        body:
          "Do not verify an account if you do not want the wallet-account link to become public. Admin moderation can revoke a linked platform, but previous public chain history may remain visible.",
      },
    ],
  },
  disclaimer: {
    title: "Disclaimer",
    updated: "May 20, 2026",
    intro:
      "SoulStamp is an experimental identity reputation app. Treat its output as a signal, not a final truth.",
    sections: [
      {
        heading: "Not legal identity",
        body:
          "SoulStamp does not prove legal identity, citizenship, residence, age, sanctions status, or KYC status. It only attempts to link a wallet to controlled online accounts.",
      },
      {
        heading: "AI and public data limits",
        body:
          "GenLayer validators and AI reasoning can misread public pages, miss context, or disagree. Scores are confidence signals based on available evidence, not guarantees that an account is safe, human, or trustworthy.",
      },
      {
        heading: "Testnet risk",
        body:
          "Studionet behavior, validator availability, RPC responses, and contract interfaces can change. Transactions may time out, fail, or require redeployment during development.",
      },
      {
        heading: "No financial advice",
        body:
          "SoulStamp is not financial, legal, security, or compliance advice. Projects using SoulStamp should apply their own risk checks before granting privileges or value.",
      },
    ],
  },
};

export function Footer({ onNavigate }: FooterProps) {
  const [openDoc, setOpenDoc] = useState<LegalDocId | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenDoc(null);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function goTo(tab: string) {
    onNavigate(tab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const doc = openDoc ? LEGAL_DOCS[openDoc] : null;

  return (
    <>
      <footer className="border-t border-gray-800 bg-gray-950">
        <div className="max-w-7xl mx-auto px-4 py-7">
          <div className="grid gap-7 sm:grid-cols-2 lg:grid-cols-[1.25fr_0.8fr_0.9fr_0.65fr]">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <img
                  src="/soulstamp-logo.png"
                  alt="SoulStamp"
                  className="h-8 w-8 rounded-md object-contain"
                />
                <div>
                  <p className="text-base font-bold text-white tracking-tight">SoulStamp</p>
                  <p className="text-[11px] font-mono text-brand-400">GenLayer Studionet</p>
                </div>
              </div>
              <p className="max-w-xs text-xs leading-5 text-gray-500">
                AI-assisted on-chain identity reputation for wallets linked to GitHub, X,
                and Discord accounts.
              </p>
            </div>

            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-300">Product</h2>
              <div className="mt-3 flex flex-col items-start gap-2">
                <button className="footer-link" onClick={() => goTo("verify")}>Verify Identity</button>
                <button className="footer-link" onClick={() => goTo("dashboard")}>Dashboard</button>
                <button className="footer-link" onClick={() => goTo("lookup")}>Public Lookup</button>
                <button className="footer-link" onClick={() => goTo("audit")}>Audit Trail</button>
              </div>
            </div>

            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-300">Resources</h2>
              <div className="mt-3 flex flex-col items-start gap-2">
                <a
                  className="footer-link inline-flex items-center gap-1.5"
                  href="https://github.com/ometere123/soulstamp"
                  target="_blank"
                  rel="noreferrer"
                >
                  <Github className="h-4 w-4" />
                  GitHub
                </a>
                <a
                  className="footer-link inline-flex items-center gap-1.5"
                  href="https://docs.genlayer.com/"
                  target="_blank"
                  rel="noreferrer"
                >
                  GenLayer Docs
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <span className="text-xs text-gray-600">GitHub, X, Discord</span>
              </div>
            </div>

            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-300">Legal</h2>
              <div className="mt-3 flex flex-col items-start gap-2">
                <button className="footer-link" onClick={() => setOpenDoc("terms")}>Terms</button>
                <button className="footer-link" onClick={() => setOpenDoc("privacy")}>Privacy</button>
                <button className="footer-link" onClick={() => setOpenDoc("disclaimer")}>Disclaimer</button>
              </div>
            </div>
          </div>

          <div className="mt-7 border-t border-gray-800 pt-4 text-center text-xs text-gray-600">
            (c) 2026 SoulStamp. Built for transparent testnet identity verification.
          </div>
        </div>
      </footer>

      {doc && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-950/80 px-4 py-6 backdrop-blur"
          role="dialog"
          aria-modal="true"
          aria-labelledby="legal-title"
        >
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
            <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-gray-800 bg-gray-900 px-5 py-4">
              <div>
                <h2 id="legal-title" className="text-lg font-semibold text-white">{doc.title}</h2>
                <p className="mt-1 text-xs text-gray-500">Last updated: {doc.updated}</p>
              </div>
              <button
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-800 hover:text-gray-200"
                onClick={() => setOpenDoc(null)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-6 px-5 py-5">
              <p className="text-sm leading-6 text-gray-300">{doc.intro}</p>
              {doc.sections.map(section => (
                <section key={section.heading}>
                  <h3 className="text-sm font-semibold text-white">{section.heading}</h3>
                  <p className="mt-2 text-sm leading-6 text-gray-400">{section.body}</p>
                </section>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
