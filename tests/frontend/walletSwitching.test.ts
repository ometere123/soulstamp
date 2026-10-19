import { afterEach, describe, expect, it } from "vitest";
import {
  ARC_CHAIN_HEX,
  ensureArcNetwork,
} from "../../frontend/src/lib/arc";
import {
  disconnectWallet,
  getInjectedWalletAddress,
  prepareStudionetWrite,
  restoreWalletConnection,
  STUDIONET_CHAIN_ID,
} from "../../frontend/src/lib/client";

const ACCOUNT = "0x1111111111111111111111111111111111111111";

function installProvider(initialChain = STUDIONET_CHAIN_ID) {
  let chainId = initialChain;
  const calls: string[] = [];
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  };
  const provider = {
    request: async ({ method, params }: { method: string; params?: unknown[] }) => {
      calls.push(method);
      if (method === "eth_accounts") return [ACCOUNT];
      if (method === "eth_chainId") return chainId;
      if (method === "wallet_switchEthereumChain") {
        chainId = String((params?.[0] as { chainId: string }).chainId);
        return null;
      }
      if (method === "wallet_addEthereumChain") return null;
      throw new Error(`Unexpected provider method ${method}`);
    },
  };
  (globalThis as { window?: unknown }).window = { ethereum: provider, localStorage };
  return { calls, provider, getChain: () => chainId };
}

afterEach(() => {
  disconnectWallet();
  delete (globalThis as { window?: unknown }).window;
});

describe("cross-chain wallet switching", () => {
  it("restores the account without switching the current network", async () => {
    const { calls, getChain } = installProvider(ARC_CHAIN_HEX);

    await restoreWalletConnection();

    expect(getChain()).toBe(ARC_CHAIN_HEX);
    expect(calls).toEqual(["eth_accounts"]);
    expect(calls).not.toContain("wallet_switchEthereumChain");
    expect(await getInjectedWalletAddress()).toBe(ACCOUNT);
  });

  it("uses the requested network only for a GenLayer write preparation", async () => {
    const { calls, getChain } = installProvider(ARC_CHAIN_HEX);

    await prepareStudionetWrite();

    expect(getChain()).toBe(STUDIONET_CHAIN_ID);
    expect(calls).toContain("wallet_switchEthereumChain");
    expect(calls).not.toContain("wallet_addEthereumChain");
  });

  it("switches an Arc payment operation to Arc and never back to Studionet", async () => {
    const { calls, getChain } = installProvider(STUDIONET_CHAIN_ID);

    await ensureArcNetwork();
    // Simulate the browser's chainChanged listener running during payment
    // preparation. Account restoration remains read-only and cannot undo the
    // Arc selection.
    await restoreWalletConnection();

    expect(getChain()).toBe(ARC_CHAIN_HEX);
    expect(calls.filter((method) => method === "wallet_switchEthereumChain")).toHaveLength(1);
  });
});
