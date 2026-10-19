import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  publicActions,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config, requireSecret } from "./env_secrets.mjs";

const ARC_CHAIN_ID = 5_042_002;
const ARC_RPC_URL = config("ARC_RPC_URL", "https://rpc.testnet.arc.io");
const escrowAddress = config("ARC_ESCROW_ADDRESS");
const v4Address = config("V4_TRUSTPASS_CONTRACT_ADDRESS");
if (!/^0x[0-9a-fA-F]{40}$/.test(escrowAddress)) throw new Error("ARC_ESCROW_ADDRESS is required");
if (!/^0x[0-9a-fA-F]{40}$/.test(v4Address)) throw new Error("V4_TRUSTPASS_CONTRACT_ADDRESS is required");

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
});
const account = privateKeyToAccount(requireSecret("ARC_PRIVATE_KEY", ["DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY"]));
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC_URL) });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC_URL) }).extend(publicActions);
if (await publicClient.getChainId() !== ARC_CHAIN_ID) throw new Error("Refusing to configure a non-Arc network");

const abi = parseAbi([
  "function admin() view returns (address)",
  "function genlayerV4() view returns (address)",
  "function configureGenLayerV4(address v4Contract)",
]);
const currentAdmin = await publicClient.readContract({ address: escrowAddress, abi, functionName: "admin" });
const currentV4 = await publicClient.readContract({ address: escrowAddress, abi, functionName: "genlayerV4" });
if (currentAdmin.toLowerCase() !== account.address.toLowerCase()) throw new Error("Configured signer is not the escrow admin");
if (currentV4 !== "0x0000000000000000000000000000000000000000") throw new Error(`Escrow is already bound to ${currentV4}; refusing to change it`);

const hash = await walletClient.writeContract({ address: escrowAddress, abi, functionName: "configureGenLayerV4", args: [v4Address], account, chain: arcTestnet });
const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
if (receipt.status !== "success") throw new Error(`Arc V4 binding transaction failed: ${hash}`);
const configured = await publicClient.readContract({ address: escrowAddress, abi, functionName: "genlayerV4" });
if (configured.toLowerCase() !== v4Address.toLowerCase()) throw new Error("Arc V4 binding post-state mismatch");
console.log(JSON.stringify({
  network: "Arc Testnet",
  chainId: ARC_CHAIN_ID,
  escrow: escrowAddress,
  v4Contract: configured,
  transaction: hash,
  explorer: `https://explorer.testnet.arc.io/tx/${hash}`,
  status: receipt.status,
  signer: account.address,
}, null, 2));

