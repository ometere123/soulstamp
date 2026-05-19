import { useState } from "react";
import { Copy, Check, LogOut, Wallet } from "lucide-react";
import { useWallet } from "../lib/useWallet";
import clsx from "clsx";

interface HeaderProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  isAdmin: boolean;
}

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "verify",    label: "Verify Identity" },
  { id: "lookup",    label: "Public Lookup" },
  { id: "audit",     label: "Audit Trail" },
  { id: "admin",     label: "Admin" },
];

export function Header({ activeTab, onTabChange, isAdmin }: HeaderProps) {
  const { address, connecting, connect, disconnect } = useWallet();
  const [copied, setCopied] = useState(false);

  function copyAddress() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const visibleTabs = TABS.filter(t => t.id !== "admin" || isAdmin);

  return (
    <header className="border-b border-gray-800 bg-gray-950/80 backdrop-blur sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4">
        {/* Top bar */}
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo */}
          <div className="flex items-center gap-2 shrink-0">
            <img
              src="/soulstamp-logo.png"
              alt="SoulStamp"
              className="h-9 w-9 rounded-lg object-contain"
            />
            <div>
              <span className="font-bold text-white text-lg tracking-tight">SoulStamp</span>
              <span className="ml-2 text-xs text-brand-400 font-mono hidden sm:inline">GenLayer · Studionet</span>
            </div>
          </div>

          {/* Wallet area */}
          {address ? (
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-2 bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse shrink-0" />
                <span className="font-mono text-xs text-gray-300 hidden sm:inline">
                  {address.slice(0, 6)}…{address.slice(-4)}
                </span>
                <button
                  onClick={copyAddress}
                  className="text-gray-500 hover:text-gray-300 transition-colors"
                  title="Copy address"
                >
                  {copied
                    ? <Check className="w-3.5 h-3.5 text-success" />
                    : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                onClick={disconnect}
                className="text-gray-600 hover:text-gray-400 transition-colors p-1.5"
                title="Disconnect wallet"
              >
                <LogOut className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <button
              onClick={connect}
              disabled={connecting}
              className="btn-primary shrink-0"
            >
              <Wallet className="w-4 h-4" />
              {connecting ? "Connecting…" : "Connect Wallet"}
            </button>
          )}
        </div>

        {/* Nav tabs — only show when wallet is connected */}
        {address && (
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {visibleTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={clsx(
                  "px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                  activeTab === tab.id
                    ? "border-brand-500 text-brand-400"
                    : "border-transparent text-gray-500 hover:text-gray-300 hover:border-gray-700"
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}
