import { useContext } from "react";
import { WalletContext } from "./WalletContext";

export function useWallet() {
  return useContext(WalletContext);
}
