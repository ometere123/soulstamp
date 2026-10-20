import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import { TransactionStatus } from "genlayer-js/types";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  parseAbi,
  parseEventLogs,
  publicActions,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { classifyReceipt, executionFailureDescription } from "./receipt_semantics.mjs";
import { config, requireSecret } from "./env_secrets.mjs";

const [requestId, requestKey] = process.argv.slice(2);
if (!requestId || !/^0x[0-9a-fA-F]{64}$/.test(requestKey || "")) {
  throw new Error("usage: node scripts/refund-v4-payment.mjs <request-id> <bytes32-request-key>");
}
const V4 = config("V4_TRUSTPASS_CONTRACT_ADDRESS");
const ESCROW = config("ARC_ESCROW_ADDRESS");
if (!/^0x[0-9a-fA-F]{40}$/.test(V4) || !/^0x[0-9a-fA-F]{40}$/.test(ESCROW)) {
  throw new Error("V4_TRUSTPASS_CONTRACT_ADDRESS and ARC_ESCROW_ADDRESS are required");
}

const chainId = 5_042_002;
const rpc = config("ARC_RPC_URL", "https://rpc.testnet.arc.io");
const chain = defineChain({ id: chainId, name: "Arc Testnet", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } });
const account = privateKeyToAccount(requireSecret("ARC_REFUND_PRIVATE_KEY", ["ARC_PRIVATE_KEY", "DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY"]));
const genlayerAccount = createAccount(requireSecret("GENLAYER_PRIVATE_KEY", ["DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY"]));
const publicClient = createPublicClient({ chain, transport: http(rpc) });
const walletClient = createWalletClient({ account, chain, transport: http(rpc) }).extend(publicActions);
if (await publicClient.getChainId() !== chainId) throw new Error("Refusing a non-Arc network");

const escrowAbi = parseAbi([
  "function getPayment(bytes32) view returns ((bytes32 requestId,address payer,address subject,bytes32 policyHash,uint256 amount,uint256 nonce,uint256 intentExpiry,uint256 depositedAt,uint8 status))",
  "function refund(bytes32 requestId)",
  "event PaymentRefunded(bytes32 indexed requestId,address indexed payer,address indexed subject,uint256 amount)",
]);
const payment = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getPayment", args: [requestKey] });
if (Number(payment.status) !== 1) throw new Error(`Payment is not escrowed; status ${payment.status}`);
if (account.address.toLowerCase() !== String(payment.payer).toLowerCase()) throw new Error("Refund signer must be the original payer stored in the escrow record");
const refundAvailableAt = Number(payment.depositedAt) + 72 * 60 * 60;
if (!Number.isSafeInteger(refundAvailableAt)) throw new Error("Escrow depositedAt is outside the safe timestamp range");
if (Math.floor(Date.now() / 1000) < refundAvailableAt) throw new Error(`Refund is not eligible until ${new Date(refundAvailableAt * 1000).toISOString()}`);
const hash = await walletClient.writeContract({ address: ESCROW, abi: escrowAbi, functionName: "refund", args: [requestKey], account, chain });
const receipt = await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 });
if (receipt.status !== "success") throw new Error(`Refund reverted: ${hash}`);
const events = parseEventLogs({ abi: escrowAbi, logs: receipt.logs, eventName: "PaymentRefunded", strict: false });
if (events.length !== 1) throw new Error("Refund receipt did not contain exactly one PaymentRefunded event");
const logIndex = Number(events[0].logIndex ?? 0);
const after = await publicClient.readContract({ address: ESCROW, abi: escrowAbi, functionName: "getPayment", args: [requestKey] });
if (Number(after.status) !== 3) throw new Error("Refund post-state is not PAYMENT_REFUNDED");

const genlayer = createClient({ chain: studionet, endpoint: "https://studio.genlayer.com/api", account: genlayerAccount });
const v4Hash = await genlayer.writeContract({
  account: genlayerAccount,
  address: V4,
  functionName: "confirm_arc_refund",
  args: [requestId, hash, logIndex],
  value: 0n,
});
const v4Receipt = await genlayer.waitForTransactionReceipt({ hash: v4Hash, status: TransactionStatus.FINALIZED, interval: 2500, retries: 120 });
const classification = classifyReceipt(v4Receipt);
if (!classification.successful) throw new Error(`V4 refund consumption failed: ${executionFailureDescription(v4Receipt)}`);
const postState = await genlayer.readContract({ address: V4, functionName: "get_request", args: [requestId] });
if (postState.payment_state !== "REFUNDED" || postState.state !== "REFUNDED") throw new Error(`V4 refund post-state mismatch: ${JSON.stringify(postState)}`);
console.log(JSON.stringify({
  network: "Arc Testnet",
  chainId,
  escrow: ESCROW,
  arc: { transaction: hash, explorer: `https://explorer.testnet.arc.io/tx/${hash}`, logIndex, caller: account.address, status: Number(after.status) },
  genlayer: { transaction: v4Hash, explorer: `https://explorer-studio.genlayer.com/tx/${v4Hash}`, status: classification.statusName, consensus: classification.rawResultName, execution: classification.txExecutionResultName },
  requestId,
  postState: { state: postState.state, paymentState: postState.payment_state },
}, null, 2));
