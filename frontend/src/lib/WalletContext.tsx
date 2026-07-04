import { createContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { connectWallet, disconnectWallet, getConnectedAddress, restoreWalletConnection } from "./client";

export interface WalletCtx {
  address: string | null;
  connecting: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
}

export const WalletContext = createContext<WalletCtx>({
  address: null,
  connecting: false,
  connect: async () => {},
  disconnect: () => {},
});

export function WalletProvider({ children }: { children: ReactNode }) {
  const [address, setAddress]       = useState<string | null>(getConnectedAddress);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    let alive = true;
    restoreWalletConnection()
      .then(addr => {
        if (alive && addr) setAddress(addr);
      })
      .catch(() => {
        if (alive) setAddress(null);
      });

    const handleAccountsChanged = (accounts: unknown) => {
      const next = Array.isArray(accounts) && typeof accounts[0] === "string"
        ? accounts[0]
        : null;
      if (next) {
        restoreWalletConnection().then(addr => setAddress(addr ?? next));
      } else {
        disconnectWallet();
        setAddress(null);
      }
    };

    const handleChainChanged = () => {
      restoreWalletConnection().then(addr => setAddress(addr));
    };

    window.ethereum?.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum?.on?.("chainChanged", handleChainChanged);

    return () => {
      alive = false;
      window.ethereum?.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum?.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const addr = await connectWallet();
      setAddress(addr);
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    disconnectWallet();
    setAddress(null);
  }, []);

  return (
    <WalletContext.Provider value={{ address, connecting, connect, disconnect }}>
      {children}
    </WalletContext.Provider>
  );
}
