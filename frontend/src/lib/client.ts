import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as `0x${string}` | undefined;

// ── Studionet chain params ────────────────────────────────────────────────────
export const STUDIONET_CHAIN_ID = "0xF22F"; // 61999
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

/** Read the currently authorised injected account without changing networks. */
export async function getInjectedWalletAddress(): Promise<string | null> {
  if (typeof window === "undefined" || !window.ethereum) return null;
  const accounts = await window.ethereum.request({ method: "eth_accounts" }) as string[];
  return Array.isArray(accounts) && typeof accounts[0] === "string" ? accounts[0] : null;
}

/** Verify the wallet immediately before a chain-specific transaction. */
export async function assertInjectedWallet(
  expectedChainId: string,
  expectedAddress?: string,
): Promise<string> {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error("No injected wallet found.");
  }
  const chainId = String(await window.ethereum.request({ method: "eth_chainId" })).toLowerCase();
  if (chainId !== expectedChainId.toLowerCase()) {
    throw new Error(`Wallet is on ${chainId}; expected ${expectedChainId}.`);
  }
  const active = await getInjectedWalletAddress();
  if (!active) throw new Error("No wallet account is connected.");
  if (expectedAddress && active.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new Error("The connected wallet account changed. Reconnect the original account before continuing.");
  }
  return active;
}

/** Prepare a GenLayer write without allowing a stale event handler to switch
 * the wallet back during an Arc operation. Restoration is account-only; this
 * is the sole helper used by V3/V4 write paths to select Studionet. */
export async function prepareStudionetWrite(): Promise<string> {
  const requested = await getInjectedWalletAddress();
  if (!requested) throw new Error("Connect a wallet before submitting a GenLayer transaction.");
  await ensureStudionet();
  const active = await assertInjectedWallet(STUDIONET_CHAIN_ID, requested);
  buildWriteClient(active as `0x${string}`);
  return active;
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
  if (typeof window === "undefined" || !window.ethereum) return null;
  const remembered = getConnectedAddress();

  const accounts = await window.ethereum.request({
    method: "eth_accounts",
  }) as string[];

  const address = (remembered && accounts.find(a => a.toLowerCase() === remembered.toLowerCase())) ?? accounts[0];
  if (!address) {
    disconnectWallet();
    return null;
  }

  // Restoration is deliberately account-only.  A chainChanged event can be
  // emitted while an Arc approval/deposit is being prepared; switching here
  // would race that transaction back to Studionet. Network selection belongs
  // to the specific write path (prepareStudionetWrite/ensureArcNetwork).
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
