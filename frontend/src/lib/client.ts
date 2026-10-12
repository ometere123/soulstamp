import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}` | undefined;

// ── Studionet chain params ────────────────────────────────────────────────────
const STUDIONET_CHAIN_ID     = "0xF22F"; // 61999
const STUDIONET_CHAIN_PARAMS = {
  chainId:           STUDIONET_CHAIN_ID,
  chainName:         "GenLayer Studionet",
  nativeCurrency:    { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls:           ["https://studio.genlayer.com/api"],
  blockExplorerUrls: ["https://explorer-studio.genlayer.com"],
};
const CONNECTED_ADDRESS_KEY = "soulstamp.connectedAddress";

// ── Add + switch to Studionet ─────────────────────────────────────────────────
// Runs before account request so the wallet is already on the right chain
// by the time the user approves the connection.
export async function ensureStudionet(): Promise<void> {
  if (!window.ethereum) return;
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_CHAIN_ID }],
    });
  } catch (err: any) {
    // 4902 = chain unknown — register it, then switch
    if (err?.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [STUDIONET_CHAIN_PARAMS],
      });
    } else {
      throw err;
    }
  }

  const chainId = String(await window.ethereum.request({ method: "eth_chainId" })).toLowerCase();
  if (chainId !== STUDIONET_CHAIN_ID.toLowerCase()) {
    throw new Error(`Wrong network selected (${chainId}). SoulStamp only accepts Studionet 61999.`);
  }
}

// ── Read-only client (no wallet needed) ──────────────────────────────────────
export const readClient = createClient({ chain: studionet });

// ── Write client (created after wallet connects) ──────────────────────────────
let _writeClient: ReturnType<typeof createClient> | null = null;
let _connectedAddress: string | null = typeof window !== "undefined"
  ? window.localStorage.getItem(CONNECTED_ADDRESS_KEY)
  : null;

function setConnectedAddress(address: string | null) {
  _connectedAddress = address;
  if (typeof window === "undefined") return;
  if (address) {
    window.localStorage.setItem(CONNECTED_ADDRESS_KEY, address);
  } else {
    window.localStorage.removeItem(CONNECTED_ADDRESS_KEY);
  }
}

function buildWriteClient(address: `0x${string}`) {
  _writeClient = createClient({
    chain: studionet,
    account: address,
    provider: window.ethereum,
  });
  setConnectedAddress(address);
}

export function getConnectedAddress(): string | null {
  return _connectedAddress;
}

export function getWriteClient(): ReturnType<typeof createClient> {
  if (!_writeClient) throw new Error("Wallet not connected");
  return _writeClient;
}

export async function restoreWalletConnection(): Promise<string | null> {
  if (!window.ethereum) return null;
  const remembered = getConnectedAddress();
  if (!remembered) return null;

  const accounts = await window.ethereum.request({
    method: "eth_accounts",
  }) as string[];

  const address = accounts.find(a => a.toLowerCase() === remembered.toLowerCase()) ?? accounts[0];
  if (!address) {
    disconnectWallet();
    return null;
  }

  await ensureStudionet();
  buildWriteClient(address as `0x${string}`);
  return address;
}

export async function connectWallet(): Promise<string> {
  if (!window.ethereum) {
    throw new Error("No injected wallet found. Please install MetaMask.");
  }

  // 1. Auto-add / auto-switch to Studionet before anything else
  await ensureStudionet();

  // 2. Request account access
  const accounts = await window.ethereum.request({
    method: "eth_requestAccounts",
  }) as string[];

  if (!accounts.length) throw new Error("No accounts returned from wallet");
  const address = accounts[0] as `0x${string}`;

  // 3. Build write client with injected provider (already on correct chain)
  buildWriteClient(address);
  return address;
}

export function disconnectWallet() {
  _writeClient = null;
  setConnectedAddress(null);
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
    };
  }
}
