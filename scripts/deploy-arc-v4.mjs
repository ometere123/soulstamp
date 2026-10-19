import fs from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  publicActions,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { config, requireSecret, repositoryRoot } from "./env_secrets.mjs";

const ARC_CHAIN_ID = 5_042_002;
const ARC_RPC_URL = config("ARC_RPC_URL", "https://rpc.testnet.arc.io");
const ARC_USDC_ADDRESS = config("ARC_USDC_ADDRESS", "0x3600000000000000000000000000000000000000");
const ZERO = "0x0000000000000000000000000000000000000000";

const arcTestnet = defineChain({
  id: ARC_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
  blockExplorers: { default: { name: "Arc Explorer", url: "https://explorer.testnet.arc.io" } },
});

const account = privateKeyToAccount(requireSecret("ARC_PRIVATE_KEY", ["DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY"]));
const publicClient = createPublicClient({ chain: arcTestnet, transport: http(ARC_RPC_URL) });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http(ARC_RPC_URL) }).extend(publicActions);

const admin = config("ARC_ADMIN_ADDRESS", account.address);
const treasury = config("ARC_TREASURY_ADDRESS", account.address);
const settlementOperator = config("ARC_SETTLEMENT_OPERATOR_ADDRESS", account.address);

function address(value, label) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${label} is not a 20-byte address`);
  return value;
}

address(admin, "ARC_ADMIN_ADDRESS");
address(treasury, "ARC_TREASURY_ADDRESS");
address(settlementOperator, "ARC_SETTLEMENT_OPERATOR_ADDRESS");

const chainId = await publicClient.getChainId();
if (chainId !== ARC_CHAIN_ID) throw new Error(`Refusing non-Arc network ${chainId}; expected ${ARC_CHAIN_ID}`);
const usdcCode = await publicClient.getBytecode({ address: address(ARC_USDC_ADDRESS, "ARC_USDC_ADDRESS") });
if (!usdcCode || usdcCode === "0x") throw new Error("Configured Arc USDC address has no contract code");
const decimals = await publicClient.readContract({
  address: ARC_USDC_ADDRESS,
  abi: parseAbi(["function decimals() view returns (uint8)"]),
  functionName: "decimals",
});
if (Number(decimals) !== 6) throw new Error(`Arc USDC decimals are ${decimals}; expected 6`);

const artifactPath = path.join(repositoryRoot(), "out", "SoulStampPaymentEscrow.sol", "SoulStampPaymentEscrow.json");
if (!fs.existsSync(artifactPath)) throw new Error("Foundry artifact is missing; run forge build first");
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
if (!artifact.bytecode?.object || artifact.bytecode.object === "0x") throw new Error("Escrow bytecode is empty");

const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode.object,
  args: [ARC_USDC_ADDRESS, ZERO, admin, treasury, settlementOperator],
  account,
  chain: arcTestnet,
});
const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error(`Arc escrow deployment failed: ${hash}`);
}

const escrow = receipt.contractAddress;
const checks = await publicClient.readContract({
  address: escrow,
  abi: parseAbi([
    "function usdc() view returns (address)",
    "function genlayerV4() view returns (address)",
    "function admin() view returns (address)",
    "function treasury() view returns (address)",
    "function settlementOperator() view returns (address)",
    "function price() view returns (uint256)",
  ]),
  functionName: "usdc",
}).then(async (configuredUsdc) => ({
  usdc: configuredUsdc,
  genlayerV4: await publicClient.readContract({ address: escrow, abi: parseAbi(["function genlayerV4() view returns (address)"]), functionName: "genlayerV4" }),
  admin: await publicClient.readContract({ address: escrow, abi: parseAbi(["function admin() view returns (address)"]), functionName: "admin" }),
  treasury: await publicClient.readContract({ address: escrow, abi: parseAbi(["function treasury() view returns (address)"]), functionName: "treasury" }),
  settlementOperator: await publicClient.readContract({ address: escrow, abi: parseAbi(["function settlementOperator() view returns (address)"]), functionName: "settlementOperator" }),
  price: (await publicClient.readContract({ address: escrow, abi: parseAbi(["function price() view returns (uint256)"]), functionName: "price" })).toString(),
}));

if (checks.usdc.toLowerCase() !== ARC_USDC_ADDRESS.toLowerCase() || checks.genlayerV4 !== ZERO) {
  throw new Error("Arc escrow constructor state does not match the deployment binding plan");
}
if (checks.admin.toLowerCase() !== admin.toLowerCase() || checks.treasury.toLowerCase() !== treasury.toLowerCase() || checks.settlementOperator.toLowerCase() !== settlementOperator.toLowerCase()) {
  throw new Error("Arc escrow role configuration does not match the requested deployment");
}
if (checks.price !== "1000000") throw new Error("Arc escrow price is not exactly 1 USDC");

console.log(JSON.stringify({
  network: "Arc Testnet",
  chainId,
  deployer: account.address,
  contractAddress: escrow,
  deploymentTransaction: hash,
  explorer: `https://explorer.testnet.arc.io/tx/${hash}`,
  usdc: ARC_USDC_ADDRESS,
  usdcDecimals: Number(decimals),
  roles: { admin, treasury, settlementOperator },
  initialGenLayerV4: checks.genlayerV4,
  priceBaseUnits: checks.price,
}, null, 2));

